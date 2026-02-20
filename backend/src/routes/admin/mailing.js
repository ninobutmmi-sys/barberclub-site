const express = require('express');
const { body, validationResult } = require('express-validator');
const config = require('../../config/env');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * POST /api/admin/mailing/send
 * Send a campaign email to selected clients via Resend
 */
router.post(
  '/send',
  [
    body('recipients').isArray({ min: 1 }).withMessage('Au moins un destinataire requis'),
    body('recipients.*.email').isEmail(),
    body('subject').notEmpty().withMessage('Sujet requis'),
    body('body').notEmpty().withMessage('Contenu requis'),
    body('from_name').optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    if (!config.resend.apiKey) {
      return res.status(500).json({ error: 'Resend API key non configuree' });
    }

    const { recipients, subject, body: emailBody, from_name } = req.body;
    const fromField = from_name
      ? `${from_name} <${config.resend.from.match(/<(.+)>/)?.[1] || 'noreply@barberclub.fr'}>`
      : config.resend.from;

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        // Replace variables in subject and body
        const personalSubject = replaceVars(subject, recipient);
        const personalBody = replaceVars(emailBody, recipient);

        const html = buildCampaignHTML(personalBody);

        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.resend.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromField,
            to: [recipient.email],
            subject: personalSubject,
            html,
          }),
        });

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

function replaceVars(text, recipient) {
  return text
    .replace(/\{prenom\}/gi, recipient.first_name || '')
    .replace(/\{nom\}/gi, recipient.last_name || '');
}

function buildCampaignHTML(bodyText) {
  // Convert line breaks to HTML paragraphs
  const paragraphs = bodyText
    .split('\n\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${p.replace(/\n/g, '<br>')}</p>`)
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
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:4px 0 0;">Meylan</p>
    </div>

    <div style="color:rgba(255,255,255,0.9);font-size:15px;">
      ${paragraphs}
    </div>

    <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
      <p>BarberClub Meylan — 26 Av. du Grésivaudan, 38700 Corenc</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;
