
const API_KEY = process.env.API_KEY;

function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).send('Chave de API inválida ou não fornecida.');
  }

  next();
}

module.exports = authenticate;
