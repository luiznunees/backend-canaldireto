# API de Campanhas e Instâncias WhatsApp

Esta é uma API para criar, iniciar e pausar campanhas, gerenciar arquivos de usuários e gerenciar instâncias do WhatsApp.

## Instalação

1. Clone o repositório.
2. Instale as dependências com `npm install`.
3. Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```
PORT=3000
N8N_BASE_URL=https://n8n.vps.zapbroker.dev
API_KEY=SUA_CHAVE_DE_API
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_API_KEY=SUA_CHAVE_DE_API_EVOLUTION
```

## Executando a API

Para iniciar o servidor, execute o seguinte comando:

```
npm start
```

O servidor estará rodando em `http://localhost:3000`.

## Documentação da API

A documentação da API está disponível em `http://localhost:3000/api-docs`.

## Segurança

A API é protegida por chave de API. Forneça a chave no cabeçalho `x-api-key` em todas as requisições.

## Logging

A API usa o `winston` para logs e `morgan` para logar todas as requisições no console.

## Endpoints

Todos os endpoints estão sob o prefixo `/v1`.

### Storage

#### `POST /storage/upload`

Faz upload de um arquivo para um usuário. O arquivo será deletado após 24 horas.

**Request:**

```
multipart/form-data
```

**Form data:**

- `user_id`: O ID do usuário.
- `file`: O arquivo a ser enviado.

**Response:**

```json
{
  "url": "http://localhost:3000/uploads/USER_ID/1678886400000-meuarquivo.txt"
}
```

#### `GET /storage/folders`

Lista todas as pastas de usuário no diretório de uploads.

**Response:**

```json
[
  "user1",
  "user2"
]
```

#### `GET /storage/files/:user_id`

Lista os arquivos de um usuário.

**Parâmetros:**

- `user_id`: O ID do usuário.

**Response:**

```json
[
  "1678886400000-meuarquivo.txt",
  "1678886400001-outroarquivo.jpg"
]
```

#### `GET /storage/files/:user_id/:filename`

Baixa um arquivo de um usuário.

**Parâmetros:**

- `user_id`: O ID do usuário.
- `filename`: O nome do arquivo.

### Disparos

#### `POST /disparos/criar-campanha`

Cria uma nova campanha.

**Body esperado:**

```json
{
  "user_id": "49e72cf1-ac56-463d-bc11-189907599938",
  "campanha": {
    "tipo": "imagem",
    "nome": "Teste Hoje",
    "mensagem": "Olá! Estou testando a plataforma.",
    "url_anexo": "https://exemplo.com/imagem.jpg"
  },
  "contatos": {
    "origem": "manual",
    "dados": [
      "5511987654321",
      "11987654321",
      "(11) 98765-4321"
    ]
  },
  "config_envio": {
    "lote": 50,
    "atraso_lote": 120,
    "atraso_msg": 5
  }
}
```

#### `POST /disparos/comecar-campanha`

Inicia uma campanha.

**Body esperado:**

```json
{
  "campanha_id": 9546,
  "user_id": "49e72cf1-ac56-463d-bc11-189907599938"
}
```

#### `POST /disparos/pausar-campanha`

Pausa uma campanha.

**Body esperado:**

```json
{
  "campanha_id": 9546,
  "user_id": "49e72cf1-ac56-463d-bc11-189907599938"
}
```

### WhatsApp

#### `POST /whatsapp/criar`

Cria uma nova instância no Evolution API.

**Body esperado:**

```json
{
  "instanceName": "my-new-instance",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS"
}
```

#### `GET /whatsapp/conectar/:instanceName`

Obtém o QR code para conectar uma instância do Evolution API.

**Parâmetros:**

- `instanceName`: Nome da instância.

#### `DELETE /whatsapp/sair/:instanceName`

Faz logout de uma instância do Evolution API.

**Parâmetros:**

- `instanceName`: Nome da instância.

#### `GET /whatsapp/status/:instanceName`

Obtém o status da conexão de uma instância do Evolution API.

**Parâmetros:**

- `instanceName`: Nome da instância.

#### `DELETE /whatsapp/deletar/:instanceName`

Deleta uma instância no Evolution API.

**Parâmetros:**

- `instanceName`: Nome da instância.