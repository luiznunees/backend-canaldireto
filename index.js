require('dotenv').config();
const express = require('express');
const axios = require('axios');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger.js');
const authenticate = require('./auth.js');
const multer = require('multer');
const cron = require('node-cron');
const fs = require('fs').promises; // Usar fs.promises para async/await
const path = require('path');
const morgan = require('morgan');
const instanceRoutes = require('./instanceRoutes');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const errorHandler = require('./errorMiddleware');
const cors = require('cors');
const supabase = require('./config/supabase'); // Importar Supabase

const app = express();

// Configuração do Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10000, // Limite de 10000 requisições por IP a cada 15 minutos
  message: 'Muitas requisições a partir deste IP, por favor, tente novamente após 15 minutos',
});

app.use(cors());
app.use(express.json());

// Pipe morgan output to winston
const morganStream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

app.use(morgan('combined', { stream: morganStream }));

app.use(helmet()); // Usar Helmet para segurança
app.use(apiLimiter); // Aplicar rate limiting a todas as requisições

// Rotas versionadas com /v1
app.use('/v1/whatsapp', authenticate, instanceRoutes);

const PORT = process.env.PORT || 3000;
const N8N_BASE_URL = process.env.N8N_BASE_URL;

// Servir arquivos estáticos da pasta 'uploads'
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const userId = req.body.user_id;
    if (!userId) {
      return cb(new Error('user_id não fornecido'));
    }
    const userDir = path.join('uploads', userId);
    try {
      await fs.mkdir(userDir, { recursive: true });
      cb(null, userDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ storage: storage });

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


// Cron job para deletar arquivos com mais de 24 horas
cron.schedule('0 0 * * *', async () => {
  const directory = 'uploads';
  try {
    const userFolders = await fs.readdir(directory, { withFileTypes: true });
    for (const userFolder of userFolders) {
      if (userFolder.isDirectory()) {
        const userFolderPath = path.join(directory, userFolder.name);
        const files = await fs.readdir(userFolderPath);

        if (files.length === 0) {
          await fs.rmdir(userFolderPath);
          logger.info(`Pasta ${userFolder.name} deletada.`);
          continue;
        }

        for (const file of files) {
          const filePath = path.join(userFolderPath, file);
          const stats = await fs.stat(filePath);

          const now = new Date().getTime();
          const fileTime = new Date(stats.mtime).getTime();
          const diff = now - fileTime;

          if (diff > 24 * 60 * 60 * 1000) {
            await fs.unlink(filePath);
            logger.info(`Arquivo ${file} deletado.`);
          }
        }
      }
    }
  } catch (err) {
    logger.error('Erro no cron job de limpeza de arquivos:', err);
  }
});

/**
 * @swagger
 * /v1/storage/upload:
 *   post:
 *     summary: Faz upload de um arquivo
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload bem-sucedido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *       400:
 *         description: user_id não fornecido
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       500:
 *         description: Erro interno no servidor
 */
app.post('/v1/storage/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  const url = `${req.protocol}://${req.get('host')}/uploads/${req.body.user_id}/${req.file.filename}`;
  res.status(200).send({ url });
});

/**
 * @swagger
 * /v1/storage/folders:
 *   get:
 *     summary: Lista todas as pastas de usuário no diretório de uploads
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Lista de pastas de usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       500:
 *         description: Erro interno no servidor
 */
app.get('/v1/storage/folders', authenticate, async (req, res, next) => {
  const directory = 'uploads';
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const folders = entries.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);
    res.status(200).send(folders);
  } catch (err) {
    next(err); // Passa o erro para o middleware de tratamento de erros
  }
});

/**
 * @swagger
 * /v1/storage/files/{user_id}:
 *   get:
 *     summary: Lista os arquivos de um usuário específico no diretório de uploads
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do usuário para listar os arquivos.
 *     responses:
 *       200:
 *         description: Lista de arquivos do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       404:
 *         description: Usuário não encontrado ou diretório vazio
 *       500:
 *         description: Erro interno no servidor
 */
app.get('/v1/storage/files/:user_id', authenticate, async (req, res, next) => {
  const userId = req.params.user_id;
  const userDir = path.join('uploads', userId);

  try {
    // Verifica se o diretório existe
    await fs.access(userDir); // fs.access lança um erro se o diretório não existe
    const files = await fs.readdir(userDir);
    res.status(200).send(files);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).send('Usuário não encontrado ou diretório vazio.');
    }
    next(err); // Passa outros erros para o middleware de tratamento de erros
  }
});

/**
 * @swagger
 * /v1/storage/files/{user_id}/{filename}:
 *   get:
 *     summary: Baixa um arquivo de um usuário
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Arquivo
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       404:
 *         description: Arquivo não encontrado
 *       500:
 *         description: Erro interno no servidor
 */
app.get('/v1/storage/files/:user_id/:filename', authenticate, async (req, res, next) => {
  const userId = req.params.user_id;
  const filename = req.params.filename;
  const filePath = path.join('uploads', userId, filename);

  try {
    await fs.access(filePath); // Verifica se o arquivo existe
    res.download(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).send('Arquivo não encontrado.');
    }
    next(err); // Passa outros erros para o middleware de tratamento de erros
  }
});


/**
 * @swagger
 * /v1/disparos/criar-campanha:
 *   post:
 *     summary: Cria uma nova campanha
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
 *               campanha:
 *                 type: object
 *                 properties:
 *                   tipo:
 *                     type: string
 *                   nome:
 *                     type: string
 *                   mensagem:
 *                     type: string
 *                   url_anexo:
 *                     type: string
 *               contatos:
 *                 type: object
 *                 properties:
 *                   origem:
 *                     type: string
 *                   dados:
 *                     type: array
 *                     items:
 *                       type: string
 *               config_envio:
 *                 type: object
 *                 properties:
 *                   lote:
 *                     type: integer
 *                   atraso_lote:
 *                     type: integer
 *                   atraso_msg:
 *                     type: integer
 *     responses:
 *       200:
 *         description: Campanha criada com sucesso
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       500:
 *         description: Erro interno no servidor
 */
app.post('/v1/disparos/criar-campanha', authenticate, async (req, res, next) => {
  const { user_id } = req.body;

  try {
    // Verificar se WhatsApp está conectado
    const { data: whatsappInstance, error: dbError } = await supabase
      .from('whatsapp')
      .select('status')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    if (dbError) {
        logger.error(`Erro ao verificar status do whatsapp para user_id ${user_id}:`, dbError);
        throw new Error(dbError.message);
    }

    if (!whatsappInstance || whatsappInstance.status !== 'connected') {
      logger.warn(`Tentativa de criar campanha sem WhatsApp conectado para user_id: ${user_id}`);
      return res.status(403).json({
        success: false,
        error: 'WhatsApp não conectado',
        message: 'Conecte seu WhatsApp antes de criar campanhas.',
        code: 'WHATSAPP_NOT_CONNECTED'
      });
    }

    // Se conectado, prossegue para o n8n
    const response = await axios.post(`${N8N_BASE_URL}/webhook/criar-campanha`, req.body);
    res.status(response.status).send(response.data);
  } catch (error) {
    logger.error(`Erro ao criar campanha para user_id ${user_id}:`, error);
    next(error); // Passa o erro para o middleware de tratamento de erros
  }
});

/**
 * @swagger
 * /v1/disparos/comecar-campanha:
 *   post:
 *     summary: Inicia uma campanha
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campanha_id:
 *                 type: integer
 *               user_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Campanha iniciada com sucesso
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       500:
 *         description: Erro interno no servidor
 */
app.post('/v1/disparos/comecar-campanha', authenticate, async (req, res, next) => {
  try {
    const response = await axios.post(`${N8N_BASE_URL}/webhook/comecar-campanha`, req.body);
    res.status(response.status).send(response.data);
  } catch (error) {
    next(error); // Passa o erro para o middleware de tratamento de erros
  }
});

/**
 * @swagger
 * /v1/disparos/pausar-campanha:
 *   post:
 *     summary: Pausa uma campanha
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campanha_id:
 *                 type: integer
 *               user_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Campanha pausada com sucesso
 *       401:
 *         description: Chave de API inválida ou não fornecida
 *       500:
 *         description: Erro interno no servidor
 */
app.post('/v1/disparos/pausar-campanha', authenticate, async (req, res, next) => {
  try {
    const response = await axios.post(`${N8N_BASE_URL}/webhook/pausar-campanha`, req.body);
    res.status(response.status).send(response.data);
  } catch (error) {
    next(error); // Passa o erro para o middleware de tratamento de erros
  }
});

// Webhook para receber atualizações da Evolution API (sem autenticação de API Key)
app.post('/v1/webhooks/whatsapp', async (req, res) => {
  const { event, instance, data } = req.body;

  logger.info(`[WEBHOOK] Recebido evento '${event}' para a instância '${instance}'`);

  try {
    const { data: whatsappInstance, error: findError } = await supabase
      .from('whatsapp')
      .select('id, status')
      .eq('nome_instancia', instance)
      .single();

    if (findError || !whatsappInstance) {
      logger.warn(`[WEBHOOK] Instância '${instance}' não encontrada no Supabase.`);
      return res.status(404).json({ success: false, error: 'Instância não encontrada' });
    }

    let updateData = {};
    let logMessage = '';

    switch (event) {
      case 'connection.update':
        const newStatus = data.state === 'open' ? 'connected'
                        : data.state === 'connecting' ? 'connecting'
                        : 'disconnected';
        
        if (whatsappInstance.status !== newStatus) {
            updateData = {
                status: newStatus,
                atualizado_em: new Date().toISOString(),
                ...(newStatus === 'connected' && { last_connection_at: new Date().toISOString(), connection_attempts: 0 })
            };
            logMessage = `Status atualizado para: ${newStatus}`;
        }
        break;

      case 'qrcode.updated':
        if (data.qrcode) {
          updateData = {
            qr_code: data.qrcode,
            atualizado_em: new Date().toISOString()
          };
          logMessage = 'QR Code atualizado no banco de dados.';
        }
        break;

      default:
        logger.info(`[WEBHOOK] Evento não tratado: ${event}`);
        return res.json({ success: true, message: 'Evento não tratado' });
    }

    if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
            .from('whatsapp')
            .update(updateData)
            .eq('id', whatsappInstance.id);

        if (updateError) {
            logger.error(`[WEBHOOK] Erro ao atualizar Supabase para instância ${instance}:`, updateError);
            return res.status(500).json({ success: false, error: 'Erro ao atualizar dados' });
        }
        logger.info(`[WEBHOOK] ${logMessage}`);
    }

    res.json({ success: true, message: 'Webhook processado com sucesso' });

  } catch (error) {
    logger.error(`[WEBHOOK] Erro fatal no processamento do webhook para instância ${instance}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Middleware de tratamento de erros centralizado (DEVE SER O ÚLTIMO app.use)
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
});