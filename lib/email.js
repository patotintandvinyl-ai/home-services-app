'use strict';
// Pluggable email sender.
//
// Which real sender to use (pick ONE):
//   RESEND_API_KEY   — send through Resend (https://resend.com)
//   EMAIL_WEBHOOK_URL — POST {to, subject, text} as JSON to your own endpoint
//   (plus optional EMAIL_WEBHOOK_SECRET sent as X-Webhook-Secret header)
//
// Until one of these is set, sendEmail() does NOT pretend to send — it
// returns { sent: false } and the app relies on in-app notifications.
// The UI says this out loud so nobody thinks emails are going out.
const { db, now } = require('../db');

function senderConfigured() {
  return !!(process.env.RESEND_API_KEY || process.env.EMAIL_WEBHOOK_URL);
}

function senderName() {
  if (process.env.RESEND_API_KEY) return 'Resend';
  if (process.env.EMAIL_WEBHOOK_URL) return 'email webhook';
  return 'none';
}

async function sendEmail(to, subject, text) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Home Services <noreply@example.com>',
          to: [to],
          subject,
          text
        })
      });
      if (!res.ok) return { sent: false, reason: 'resend_error_' + res.status };
      return { sent: true, via: 'resend' };
    } catch (e) {
      return { sent: false, reason: 'resend_exception' };
    }
  }
  if (process.env.EMAIL_WEBHOOK_URL) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.EMAIL_WEBHOOK_SECRET) headers['X-Webhook-Secret'] = process.env.EMAIL_WEBHOOK_SECRET;
      const res = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, subject, text })
      });
      if (!res.ok) return { sent: false, reason: 'webhook_error_' + res.status };
      return { sent: true, via: 'webhook' };
    } catch (e) {
      return { sent: false, reason: 'webhook_exception' };
    }
  }
  return { sent: false, reason: 'no_email_sender_configured' };
}

module.exports = { senderConfigured, senderName, sendEmail };
