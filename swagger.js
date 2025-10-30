const swaggerJSDoc = require('swagger-jsdoc');
const path = require('path');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'API de Campanhas',
    version: '1.0.0',
    description: 'Documentação da API de Campanhas',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Servidor de desenvolvimento',
    },
  ],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
    },
  },
  security: [
    {
      apiKey: [],
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: [path.join(__dirname, './index.js'), path.join(__dirname, './instanceRoutes.js')], 
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;