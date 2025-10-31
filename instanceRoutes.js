const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('./config/supabase');
const logger = require('./logger');

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// Middleware para verificar configuração da Evolution API
router.use((req, res, next) => {
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
        logger.error('EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurado.');
        return res.status(500).json({ 
            success: false,
            error: 'Configuração da API de evolução incompleta.' 
        });
    }
    next();
});

/**
 * @swagger
 * /v1/whatsapp/setup:
 *   post:
 *     summary: "Cria ou conecta uma instância WhatsApp para um usuário"
 *     description: "Verifica se uma instância já existe para o user_id. Se não, cria uma na Evolution API e no Supabase. Se sim, sincroniza o status e retorna os dados existentes, incluindo um novo QR code se estiver desconectado."
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: string
 *                 description: "ID do usuário do Supabase."
 *             example:
 *               user_id: "49e72cf1-ac56-463d-bc11-189907599938"
 *     responses:
 *       200:
 *         description: "Operação bem-sucedida. Retorna a instância e o QR code se aplicável."
 *       400:
 *         description: "Requisição inválida, como user_id faltando ou usuário sem telefone."
 *       404:
 *         description: "Usuário não encontrado no banco de dados."
 *       500:
 *         description: "Erro interno no servidor."
 */
router.post('/setup', async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ 
      success: false,
      error: 'user_id é obrigatório' 
    });
  }

  try {
    // 1. Buscar telefone do usuário no Supabase
    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('telefone')
      .eq('id', user_id)
      .single();

    if (userError || !usuario) {
        logger.error(`Usuário não encontrado para user_id: ${user_id}`, userError);
        return res.status(404).json({ 
            success: false,
            error: 'Usuário não encontrado no banco de dados' 
        });
    }

    if (!usuario.telefone) {
        logger.warn(`Usuário ${user_id} não possui telefone cadastrado.`);
        return res.status(400).json({ 
            success: false,
            error: 'Usuário não possui telefone cadastrado' 
        });
    }

    // 2. Verificar se já existe instância ativa
    const { data: existingInstance, error: checkError } = await supabase
      .from('whatsapp')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    if (checkError) {
        logger.error('Erro ao verificar instância existente no Supabase', checkError);
        throw new Error(checkError.message);
    }

    if (existingInstance) {
      logger.info(`Instância já existe para o usuário ${user_id}. Sincronizando status.`);
      
      try {
        const statusResponse = await axios.get(
          `${EVOLUTION_API_URL}/instance/connectionState/${existingInstance.nome_instancia}`,
          { headers: { 'apikey': EVOLUTION_API_KEY } }
        );

        const evolutionStatus = statusResponse.data?.instance?.state || 'close';
        const mappedStatus = evolutionStatus === 'open' ? 'connected'
                           : evolutionStatus === 'connecting' ? 'connecting'
                           : 'disconnected';

        await supabase
          .from('whatsapp')
          .update({ 
            status: mappedStatus,
            atualizado_em: new Date().toISOString()
          })
          .eq('id', existingInstance.id);

        existingInstance.status = mappedStatus;

        let qrCode = null;
        if (mappedStatus === 'disconnected') {
          logger.info(`Instância ${existingInstance.nome_instancia} está desconectada. Obtendo novo QR Code.`);
          const qrResponse = await axios.get(
            `${EVOLUTION_API_URL}/instance/connect/${existingInstance.nome_instancia}`,
            { headers: { 'apikey': EVOLUTION_API_KEY } }
          );
          qrCode = qrResponse.data?.base64 || qrResponse.data?.qrcode?.base64;
        }

        return res.json({
          success: true,
          instance: existingInstance,
          qrcode: qrCode,
          message: mappedStatus === 'connected' 
            ? 'Instância já existe e está conectada'
            : 'Instância já existe. Escaneie o QR Code para conectar.'
        });

      } catch (syncError) {
        logger.error(`Erro ao sincronizar status da instância existente ${existingInstance.nome_instancia}:`, syncError.message);
        return res.json({
          success: true,
          instance: existingInstance,
          qrcode: null,
          message: 'Instância já existe. Status da Evolution API indisponível no momento.'
        });
      }
    }

    // 3. Gerar instanceName único
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const instanceName = `${usuario.telefone}_${randomDigits}`;

    logger.info(`Criando nova instância: ${instanceName} para o usuário ${user_id}`);

    // 4. Criar instância na Evolution API
    await axios.post(
      `${EVOLUTION_API_URL}/instance/create`,
      {
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
      },
      {
        headers: { 'apikey': EVOLUTION_API_KEY }
      }
    );

    logger.info(`Instância ${instanceName} criada na Evolution API com sucesso.`);

    // 5. Salvar no Supabase
    const { data: newInstance, error: insertError } = await supabase
      .from('whatsapp')
      .insert({
        user_id: user_id,
        nome_instancia: instanceName,
        numero: usuario.telefone,
        status: 'disconnected',
        tipo_integracao: 'WHATSAPP-BAILEYS',
        is_active: true,
        connection_attempts: 1 // Inicia com 1 tentativa
      })
      .select()
      .single();

    if (insertError) {
      logger.error('Erro ao salvar nova instância no Supabase:', insertError);
      throw new Error(`Erro ao salvar no banco: ${insertError.message}`);
    }

    logger.info(`Instância ${instanceName} salva no Supabase com ID: ${newInstance.id}`);

    // 6. Obter QR Code
    let qrCodeBase64 = null;
    try {
      const qrResponse = await axios.get(
        `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
        {
          headers: { 'apikey': EVOLUTION_API_KEY },
          timeout: 10000
        }
      );

      qrCodeBase64 = qrResponse.data?.base64 || qrResponse.data?.qrcode?.base64;

      if (qrCodeBase64) {
        await supabase
          .from('whatsapp')
          .update({ qr_code: qrCodeBase64 })
          .eq('id', newInstance.id);
        logger.info(`QR Code para ${instanceName} salvo no Supabase.`);
      }

    } catch (qrError) {
      logger.error(`Erro ao obter QR Code para ${instanceName}:`, qrError.message);
    }

    res.status(201).json({
      success: true,
      instance: newInstance,
      qrcode: qrCodeBase64,
      message: 'Instância criada com sucesso. Escaneie o QR Code no WhatsApp.'
    });

  } catch (error) {
    logger.error(`Erro no endpoint /setup para user_id ${user_id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Erro ao configurar WhatsApp',
      details: error.response?.data?.message || error.message
    });
  }
});


/**
 * @swagger
 * /v1/whatsapp/sync-status/{user_id}:
 *   get:
 *     summary: "Sincroniza e retorna o status da instância de um usuário"
 *     description: "Busca a instância do usuário, consulta o status real na Evolution API, atualiza o Supabase e retorna os dados consolidados."
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: "ID do usuário."
 *     responses:
 *       200:
 *         description: "Status sincronizado. Retorna os dados da instância e um novo QR code se aplicável."
 *       404:
 *         description: "Nenhuma instância ativa encontrada para o usuário."
 *       500:
 *         description: "Erro interno no servidor."
 */
router.get('/sync-status/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        const { data: instance, error } = await supabase
            .from('whatsapp')
            .select('*')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .maybeSingle();

        if (error || !instance) {
            return res.status(404).json({
                success: false,
                hasInstance: false,
                message: 'Nenhuma instância encontrada para este usuário'
            });
        }

        let evolutionStatus = 'close';
        let profileData = null;
        let mappedStatus = 'disconnected';

        // Polling para verificar o status da conexão
        for (let i = 0; i < 5; i++) { // Tenta 5 vezes
            try {
                const statusResponse = await axios.get(
                    `${EVOLUTION_API_URL}/instance/connectionState/${instance.nome_instancia}`,
                    { headers: { 'apikey': EVOLUTION_API_KEY }, timeout: 8000 }
                );
                evolutionStatus = statusResponse.data?.instance?.state || 'close';

                if (evolutionStatus === 'open') {
                    const profileResponse = await axios.get(
                        `${EVOLUTION_API_URL}/instance/fetchProfile/${instance.nome_instancia}`,
                        { headers: { 'apikey': EVOLUTION_API_KEY }, timeout: 8000 }
                    );
                    profileData = profileResponse.data;
                    mappedStatus = 'connected';
                    break; // Sai do loop se conectado
                }
            } catch (apiError) {
                logger.error(`Erro ao consultar Evolution API para ${instance.nome_instancia}:`, apiError.message);
                evolutionStatus = 'close';
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos
        }

        const oldStatus = instance.status;
        mappedStatus = evolutionStatus === 'open' ? 'connected'
            : evolutionStatus === 'connecting' ? 'connecting'
                : 'disconnected';

        const updateData = {
            status: mappedStatus,
            atualizado_em: new Date().toISOString(),
            connection_attempts: mappedStatus === 'disconnected' ? (instance.connection_attempts || 0) + 1 : 0,
            last_connection_at: mappedStatus === 'connected' ? new Date().toISOString() : instance.last_connection_at,
            profile_name: profileData?.name || null,
            profile_picture_url: profileData?.profilePictureUrl || null,
        };

        const { data: updatedInstance, error: updateError } = await supabase
            .from('whatsapp')
            .update(updateData)
            .eq('id', instance.id)
            .select()
            .single();

        if (updateError) {
            logger.error(`Erro ao atualizar Supabase para instância ${instance.id}:`, updateError);
        }

        let qrCode = null;
        if (mappedStatus === 'disconnected') {
            try {
                const qrResponse = await axios.get(
                    `${EVOLUTION_API_URL}/instance/connect/${instance.nome_instancia}`,
                    { headers: { 'apikey': EVOLUTION_API_KEY } }
                );
                qrCode = qrResponse.data?.base64 || qrResponse.data?.qrcode?.base64;
                if (qrCode) {
                    await supabase.from('whatsapp').update({ qr_code: qrCode }).eq('id', instance.id);
                }
            } catch (qrError) {
                logger.error(`Erro ao obter novo QR Code para ${instance.nome_instancia}:`, qrError.message);
            }
        }

        res.json({
            success: true,
            hasInstance: true,
            instance: updatedInstance || { ...instance, ...updateData },
            qrcode: qrCode,
            statusChanged: oldStatus !== mappedStatus
        });

    } catch (error) {
        logger.error(`Erro em /sync-status para user_id ${user_id}:`, error);
        res.status(500).json({
            success: false,
            error: 'Erro ao sincronizar status',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /v1/whatsapp/disconnect/{user_id}:
 *   delete:
 *     summary: "Desconecta a instância de um usuário"
 *     description: "Faz o logout da instância na Evolution API e atualiza o status no Supabase para 'disconnected'."
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: "ID do usuário."
 *     responses:
 *       200:
 *         description: "Instância desconectada com sucesso."
 *       404:
 *         description: "Instância não encontrada."
 *       500:
 *         description: "Erro interno no servidor."
 */
router.delete('/disconnect/:user_id', async (req, res) => {
    const { user_id } = req.params;
  
    try {
      const { data: instance, error } = await supabase
        .from('whatsapp')
        .select('id, nome_instancia')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .single();
  
      if (error || !instance) {
        return res.status(404).json({ success: false, error: 'Instância não encontrada' });
      }
  
      await axios.delete(
        `${EVOLUTION_API_URL}/instance/logout/${instance.nome_instancia}`,
        { headers: { 'apikey': EVOLUTION_API_KEY } }
      );
  
      await supabase
        .from('whatsapp')
        .update({
          status: 'disconnected',
          profile_name: null,
          profile_picture_url: null,
          qr_code: null,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', instance.id);
  
      logger.info(`Instância ${instance.nome_instancia} desconectada para o usuário ${user_id}.`);
      res.json({ success: true, message: 'WhatsApp desconectado com sucesso' });
  
    } catch (error) {
      logger.error(`Erro ao desconectar instância para user_id ${user_id}:`, error.response?.data || error.message);
      res.status(500).json({
        success: false,
        error: 'Erro ao desconectar WhatsApp',
        details: error.response?.data?.message || error.message
      });
    }
});

/**
 * @swagger
 * /v1/whatsapp/delete/{user_id}:
 *   delete:
 *     summary: "Deleta a instância de um usuário"
 *     description: "Deleta a instância na Evolution API e a marca como inativa no Supabase (soft delete)."
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: "ID do usuário."
 *     responses:
 *       200:
 *         description: "Instância deletada com sucesso."
 *       404:
 *         description: "Instância não encontrada."
 *       500:
 *         description: "Erro interno no servidor."
 */
router.delete('/delete/:user_id', async (req, res) => {
    const { user_id } = req.params;
  
    try {
      const { data: instance, error } = await supabase
        .from('whatsapp')
        .select('id, nome_instancia')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .single();
  
      if (error || !instance) {
        return res.status(404).json({ success: false, error: 'Instância não encontrada' });
      }
  
      try {
        await axios.delete(
          `${EVOLUTION_API_URL}/instance/delete/${instance.nome_instancia}`,
          { headers: { 'apikey': EVOLUTION_API_KEY } }
        );
        logger.info(`Instância ${instance.nome_instancia} deletada da Evolution API.`);
      } catch (evolutionError) {
        if (evolutionError.response?.status !== 404) {
            logger.warn(`Erro não crítico ao deletar instância ${instance.nome_instancia} da Evolution (pode já ter sido removida):`, evolutionError.message);
        }
      }
  
      await supabase
        .from('whatsapp')
        .update({
          is_active: false,
          status: 'disconnected',
          atualizado_em: new Date().toISOString()
        })
        .eq('id', instance.id);
  
      logger.info(`Instância ${instance.nome_instancia} marcada como inativa no Supabase para o usuário ${user_id}.`);
      res.json({ success: true, message: 'Instância deletada com sucesso' });
  
    } catch (error) {
      logger.error(`Erro ao deletar instância para user_id ${user_id}:`, error.message);
      res.status(500).json({
        success: false,
        error: 'Erro ao deletar instância',
        details: error.message
      });
    }
});

module.exports = router;