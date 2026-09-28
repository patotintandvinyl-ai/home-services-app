'use strict';
// SMS sender — STUBBED interface for later.
//
// Nothing is sent today. When the owner picks an SMS provider (e.g. Twilio),
// wire it here using TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM.
// The shape below mirrors lib/email.js so the rest of the app does not care.

function senderConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

async function sendSms(to, text) {
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (!senderConfigured()) return { sent: false, reason: 'sms_not_configured' };
  // Real wiring point: Twilio messages.create({ to, from: process.env.TWILIO_FROM, body: text })
  return { sent: false, reason: 'sms_provider_not_wired' };
}

module.exports = { senderConfigured, sendSms };
