const chai = require('chai');
const chaiHttp = require('chai-http');
const sinon = require('sinon');
const axios = require('axios');
const app = require('../index'); // Sua aplicação Express
const expect = chai.expect;

chai.use(require('chai-http'));

describe('WhatsApp API', () => {
  let axiosPostStub;

  beforeEach(() => {
    // Stub para axios.post para evitar chamadas reais à Evolution API
    axiosPostStub = sinon.stub(axios, 'post');
  });

  afterEach(() => {
    axiosPostStub.restore(); // Restaura o método original após cada teste
  });

  describe('POST /v1/whatsapp/criar', () => {
    it('should create a new instance with valid data', async () => {
      axiosPostStub.resolves({ status: 200, data: { message: 'Instance created successfully' } });

      const res = await chai.request(app)
        .post('/v1/whatsapp/criar')
        .set('x-api-key', process.env.API_KEY) // Use a API_KEY da sua aplicação
        .send({
          instanceName: 'test-instance',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        });

      expect(res).to.have.status(200);
      expect(res.body).to.be.an('object');
      expect(res.body).to.have.property('message', 'Instance created successfully');
      expect(axiosPostStub.calledOnce).to.be.true;
      expect(axiosPostStub.args[0][0]).to.include('/instance/create');
    });

    it('should return 400 if instanceName is missing', async () => {
      const res = await chai.request(app)
        .post('/v1/whatsapp/criar')
        .set('x-api-key', process.env.API_KEY)
        .send({
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        });

      expect(res).to.have.status(400);
      expect(res.body).to.be.an('object');
      expect(res.body).to.have.property('message', 'Validation failed');
      expect(res.body.errors).to.include('"instanceName" is required');
      expect(axiosPostStub.notCalled).to.be.true;
    });

    it('should return 401 if API key is missing', async () => {
      const res = await chai.request(app)
        .post('/v1/whatsapp/criar')
        .send({
          instanceName: 'test-instance',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        });

      expect(res).to.have.status(401);
      expect(res.body).to.be.an('object');
      expect(res.body).to.have.property('message', 'API key is missing');
      expect(axiosPostStub.notCalled).to.be.true;
    });

    it('should return 500 if Evolution API is not configured', async () => {
      // Temporariamente remove a variável de ambiente para simular o erro
      const originalEvolutionApiBaseUrl = process.env.EVOLUTION_API_BASE_URL;
      process.env.EVOLUTION_API_BASE_URL = '';

      const res = await chai.request(app)
        .post('/v1/whatsapp/criar')
        .set('x-api-key', process.env.API_KEY)
        .send({
          instanceName: 'test-instance',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        });

      expect(res).to.have.status(500);
      expect(res.body).to.be.an('object');
      expect(res.body).to.have.property('message', 'EVOLUTION_API_BASE_URL not configured.');
      expect(axiosPostStub.notCalled).to.be.true;

      // Restaura a variável de ambiente
      process.env.EVOLUTION_API_BASE_URL = originalEvolutionApiBaseUrl;
    });

    it('should return 500 if Evolution API returns an error', async () => {
      axiosPostStub.rejects({ response: { status: 500, data: { message: 'Evolution API internal error' } } });

      const res = await chai.request(app)
        .post('/v1/whatsapp/criar')
        .set('x-api-key', process.env.API_KEY)
        .send({
          instanceName: 'test-instance',
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        });

      expect(res).to.have.status(500);
      expect(res.body).to.be.an('object');
      expect(res.body).to.have.property('message', 'Evolution API internal error');
      expect(axiosPostStub.calledOnce).to.be.true;
    });
  });
});
