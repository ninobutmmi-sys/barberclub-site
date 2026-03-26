const express = require('express');
const { body, validationResult } = require('express-validator');
const config = require('../../config/env');
const { getSalonConfig } = require('../../config/env');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * POST /api/admin/mailing/send
 * Send a campaign email to selected clients via Brevo
 */
router.post(
  '/send',
  [
    body('recipients').isArray({ min: 1, max: 500 }).withMessage('Entre 1 et 500 destinataires'),
    body('recipients.*.email').isEmail().withMessage('Email invalide'),
    body('recipients.*.first_name').optional().trim().isLength({ max: 100 }),
    body('recipients.*.last_name').optional().trim().isLength({ max: 100 }),
    body('subject').notEmpty().isLength({ max: 200 }).withMessage('Sujet requis (max 200 car.)'),
    body('body').notEmpty().isLength({ max: 10000 }).withMessage('Contenu requis (max 10000 car.)'),
    body('from_name').optional().isString().isLength({ max: 100 }),
  ],
  async (req, res) => {
    const salonId = req.user.salon_id;
    const salon = getSalonConfig(salonId);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const brevoConfig = salon.brevo || config.brevo;
    if (!brevoConfig.apiKey) {
      return res.status(500).json({ error: 'Brevo API key non configuree' });
    }

    const { recipients, subject, body: emailBody, from_name } = req.body;
    const senderName = from_name || brevoConfig.senderName;

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        // Replace variables in subject and body
        const personalSubject = replaceVars(subject, recipient);
        const personalBody = replaceVars(emailBody, recipient);

        const html = buildCampaignHTML(personalBody, salon);

        const controller = new AbortController();
        const mailTimeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoConfig.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sender: { email: brevoConfig.senderEmail, name: senderName },
            to: [{ email: recipient.email }],
            subject: personalSubject,
            htmlContent: html,
          }),
          signal: controller.signal,
        });
        clearTimeout(mailTimeout);

        if (response.ok) {
          sent++;
        } else {
          const errorBody = await response.text();
          logger.error('Mailing send failed', { email: recipient.email, error: errorBody });
          failed++;
        }
      } catch (err) {
        logger.error('Mailing send error', { email: recipient.email, error: err.message });
        failed++;
      }
    }

    logger.info('Mailing campaign sent', { sent, failed, total: recipients.length });
    res.json({ sent, failed });
  }
);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceVars(text, recipient) {
  return text
    .replace(/\{prenom\}/gi, escapeHtml(recipient.first_name || ''))
    .replace(/\{nom\}/gi, escapeHtml(recipient.last_name || ''));
}

function buildCampaignHTML(bodyText, salon) {
  const salonName = salon ? salon.name : 'BarberClub Meylan';
  const salonAddress = salon ? salon.address : '26 Av. du Grésivaudan, 38700 Corenc';
  // Extract short location name from full salon name (e.g. "BarberClub Meylan" -> "Meylan")
  const shortLocation = salonName.replace(/^BarberClub\s*/i, '') || 'Meylan';

  // Convert line breaks to HTML paragraphs (escape each paragraph to prevent XSS)
  const paragraphs = bodyText
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#000;color:#fff;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-family:'Orbitron',monospace;font-size:24px;font-weight:800;margin:0;letter-spacing:0.05em;">
        BARBERCLUB
      </h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:4px 0 0;">${escapeHtml(shortLocation)}</p>
    </div>

    <div style="color:rgba(255,255,255,0.9);font-size:15px;">
      ${paragraphs}
    </div>

    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
      <p>${escapeHtml(salonName)} — ${escapeHtml(salonAddress)}</p>
      <p style="font-size:10px;opacity:0.6;margin-top:8px;">Si vous ne souhaitez plus recevoir ces emails, répondez « STOP » à cet email.</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;
