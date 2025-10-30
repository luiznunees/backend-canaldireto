const Joi = require('joi');
const logger = require('./logger');

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    const errors = error.details.map((err) => err.message);
    logger.warn(`Validation error for ${req.path}: ${errors.join(', ')}`);
    return res.status(400).json({ message: 'Validation failed', errors });
  }
  next();
};

// Schemas de validação
const whatsappCreateSchema = Joi.object({
  instanceName: Joi.string().required().description('Name of the instance to be created.'),
  qrcode: Joi.boolean().required().description('Indicates whether a QR code should be generated.'),
  integration: Joi.string().valid('WHATSAPP-BAILEYS').required().description('Type of integration (e.g., WHATSAPP-BAILEYS).'),
});

module.exports = {
  validate,
  whatsappCreateSchema,
};
