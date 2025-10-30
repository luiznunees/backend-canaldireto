const express = require('express');
const router = express.Router();
const axios = require('axios');
const { validate, whatsappCreateSchema } = require('./validationMiddleware');
const logger = require('./logger');

const EVOLUTION_API_BASE_URL = process.env.EVOLUTION_API_BASE_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY; // New environment variable for the Evolution API apikey

// Middleware to add the apikey to the request header for the Evolution API
router.use((req, res, next) => {
    if (!EVOLUTION_API_BASE_URL) {
        return res.status(500).json({ message: 'EVOLUTION_API_BASE_URL not configured.' });
    }
    if (!EVOLUTION_API_KEY) {
        return res.status(500).json({ message: 'EVOLUTION_API_KEY not configured.' });
    }
    next();
});

/**
 * @swagger
 * /v1/whatsapp/criar:
 *   post:
 *     summary: "Creates a new instance in the Evolution API"
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceName:
 *                 type: string
 *                 description: "Name of the instance to be created."
 *               qrcode:
 *                 type: boolean
 *                 description: "Indicates whether a QR code should be generated."
 *               integration:
 *                 type: string
 *                 description: "Type of integration (e.g., WHATSAPP-BAILEYS)."
 *             example:
 *               instanceName: my-new-instance
 *               qrcode: true
 *               integration: WHATSAPP-BAILEYS
 *     responses:
 *       200:
 *         description: "Instance created successfully by the Evolution API."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       401:
 *         description: "Invalid or missing API key for the Evolution API."
 *       500:
 *         description: "Internal server error or error from the Evolution API."
 */
router.post('/criar', validate(whatsappCreateSchema), async (req, res, next) => {
    try {
        const evolutionResponse = await axios.post(`${EVOLUTION_API_BASE_URL}/instance/create`, req.body, {
            headers: {
                'apikey': EVOLUTION_API_KEY // Uses the internal apikey for the Evolution API
            }
        });
        logger.info('Evolution API response:', evolutionResponse.data);
        res.status(evolutionResponse.status).json(evolutionResponse.data);
    } catch (error) {
        next(error); // Pass the error to the centralized error handler
    }
});

/**
 * @swagger
 * /v1/whatsapp/conectar/{instanceName}:
 *   get:
 *     summary: "Gets the QR code to connect an instance from the Evolution API"
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: instanceName
 *         required: true
 *         schema:
 *           type: string
 *         description: "Name of the instance."
 *     responses:
 *       200:
 *         description: "QR code obtained successfully from the Evolution API."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 instance:
 *                   type: string
 *       401:
 *         description: "Invalid or missing API key for the Evolution API."
 *       404:
 *         description: "Instance not found in the Evolution API."
 *       500:
 *         description: "Internal server error or error from the Evolution API."
 */
router.get('/conectar/:instanceName', async (req, res) => {
    const { instanceName } = req.params;
    try {
        const evolutionResponse = await axios.get(`${EVOLUTION_API_BASE_URL}/instance/connect/${instanceName}`, {
            headers: {
                'apikey': EVOLUTION_API_KEY // Uses the internal apikey for the Evolution API
            }
        });
        res.status(evolutionResponse.status).json(evolutionResponse.data);
    } catch (error) {
        console.error(`Error getting QR for instance ${instanceName} in Evolution API:`, error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { message: 'Error communicating with Evolution API.' });
    }
});

/**
 * @swagger
 * /v1/whatsapp/sair/{instanceName}:
 *   delete:
 *     summary: "Logs out an instance from the Evolution API"
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: instanceName
 *         required: true
 *         schema:
 *           type: string
 *         description: "Name of the instance."
 *     responses:
 *       200:
 *         description: "Logout performed successfully in the Evolution API."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 instance:
 *                   type: string
 *       401:
 *         description: "Invalid or missing API key for the Evolution API."
 *       404:
 *         description: "Instance not found in the Evolution API."
 *       500:
 *         description: "Internal server error or error from the Evolution API."
 */
router.delete('/sair/:instanceName', async (req, res) => {
    const { instanceName } = req.params;
    try {
        const evolutionResponse = await axios.delete(`${EVOLUTION_API_BASE_URL}/instance/logout/${instanceName}`, {
            headers: {
                'apikey': EVOLUTION_API_KEY // Uses the internal apikey for the Evolution API
            }
        });
        res.status(evolutionResponse.status).json(evolutionResponse.data);
    } catch (error) {
        console.error(`Error logging out instance ${instanceName} in Evolution API:`, error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { message: 'Error communicating with Evolution API.' });
    }
});

/**
 * @swagger
 * /v1/whatsapp/status/{instanceName}:
 *   get:
 *     summary: "Gets the connection status of an instance from the Evolution API"
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: instanceName
 *         required: true
 *         schema:
 *           type: string
 *         description: "Name of the instance."
 *     responses:
 *       200:
 *         description: "Connection status obtained successfully from the Evolution API."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 instance:
 *                   type: string
 *       401:
 *         description: "Invalid or missing API key for the Evolution API."
 *       404:
 *         description: "Instance not found in the Evolution API."
 *       500:
 *         description: "Internal server error or error from the Evolution API."
 */
router.get('/status/:instanceName', async (req, res) => {
    const { instanceName } = req.params;
    try {
        const evolutionResponse = await axios.get(`${EVOLUTION_API_BASE_URL}/instance/connectionState/${instanceName}`, {
            headers: {
                'apikey': EVOLUTION_API_KEY // Uses the internal apikey for the Evolution API
            }
        });
        res.status(evolutionResponse.status).json(evolutionResponse.data);
    } catch (error) {
        console.error(`Error getting connection status for instance ${instanceName} in Evolution API:`, error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { message: 'Error communicating with Evolution API.' });
    }
});

/**
 * @swagger
 * /v1/whatsapp/deletar/{instanceName}:
 *   delete:
 *     summary: "Deletes an instance in the Evolution API"
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: instanceName
 *         required: true
 *         schema:
 *           type: string
 *         description: "Name of the instance to be deleted."
 *     responses:
 *       200:
 *         description: "Instance deleted successfully from the Evolution API."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 instance:
 *                   type: string
 *       401:
 *         description: "Invalid or missing API key for the Evolution API."
 *       404:
 *         description: "Instance not found in the Evolution API."
 *       500:
 *         description: "Internal server error or error from the Evolution API."
 */
router.delete('/deletar/:instanceName', async (req, res) => {
    const { instanceName } = req.params;
    try {
        const evolutionResponse = await axios.delete(`${EVOLUTION_API_BASE_URL}/instance/delete/${instanceName}`, {
            headers: {
                'apikey': EVOLUTION_API_KEY // Uses the internal apikey for the Evolution API
            }
        });
        res.status(evolutionResponse.status).json(evolutionResponse.data);
    } catch (error) {
        console.error(`Error deleting instance ${instanceName} in Evolution API:`, error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { message: 'Error communicating with Evolution API.' });
    }
});

module.exports = router;

