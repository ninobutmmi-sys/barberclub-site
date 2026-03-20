const express = require('express');
const { body, validationResult } = require('express-validator');
const { brevoSMS, formatPhoneInternational, toGSM } = require('../../services/notification');
const { getSalonConfig } = require('../../config/env');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * POST /api/admin/sms/send
 * Send SMS to selected recipients via Brevo (server-side)
 */
router.post(
  '/send',
  [
    body('recipients').isArray({ min: 1, max: 500 }).withMessage('Entre 1 et 500 destinataires'),
    body('recipients.*.phone').customSanitizer((v) => v ? v.replace(/[\s.\-]/g, '') : v).matches(/^(\+33|0)[1-9]\d{8}$/).withMessage('Numero de telephone invalide'),
    body('recipients.*.first_name').optional().trim().isLength({ max: 100 }),
    body('recipients.*.last_name').optional().trim().isLength({ max: 100 }),
    body('message').notEmpty().isLength({ max: 1600 }).withMessage('Message requis (max 1600 car.)'),
    body('sender').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const salonId = req.user.salon_id;
      const salon = getSalonConfig(salonId);
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { recipients, message, sender } = req.body;

      let sent = 0;
      let failed = 0;
      const sendErrors = [];

      for (const recipient of recipients) {
        try {
          let personalMessage = message;
          if (recipient.first_name) {
            personalMessage = personalMessage.replace(/\{prenom\}/gi, recipient.first_name);
          }
          if (recipient.last_name) {
            personalMessage = personalMessage.replace(/\{nom\}/gi, recipient.last_name);
          }

          await brevoSMS(recipient.phone, toGSM(personalMessage), salonId);
          sent++;
        } catch (err) {
          failed++;
          sendErrors.push({ phone: recipient.phone, error: err.message });
          logger.error('SMS send failed', { phone: recipient.phone, error: err.message });
        }
      }

      logger.info('Manual SMS campaign sent', { sent, failed, total: recipients.length });
      res.json({ sent, failed, errors: sendErrors });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
