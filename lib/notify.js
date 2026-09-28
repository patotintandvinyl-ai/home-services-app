'use strict';
// In-app notifications (the bell icon) + best-effort email.
//
// Every notify() ALWAYS writes an in-app notification — that is the channel
// that works today. It then tries email, but only if the owner configured a
// sender (see lib/email.js). We never pretend an email went out when it did not.
const { db, now } = require('../db');
const email = require('./email');

const KINDS = {
  request_new: 'New job request',
  message_new: 'New message',
  estimate_sent: 'Price received',
  estimate_accepted: 'Price accepted',
  booking_scheduled: 'Day and time picked',
  commission_pending: 'Fee waiting for your OK',
  commission_confirmed: 'Fee confirmed',
  commission_void: 'Fee cancelled',
  review_received: 'New review',
  review_request: 'Please leave a review',
  promo_redeemed: 'Promo code used',
  card_needed: 'Add a card to get jobs'
};

function notify(userId, kind, title, body, link) {
  if (!userId) return null;
  const info = db.prepare(
    'INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, kind, title, body || '', link || '', now());
  // Best-effort email (async, never blocks, never throws).
  try {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (user && user.email) {
      email.sendEmail(user.email, title, (body || '') + (link ? '\n\nSee it here: ' + link : ''))
        .catch(() => {});
    }
  } catch (e) { /* in-app notification already saved */ }
  return Number(info.lastInsertRowid);
}

function unreadCount(userId) {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL'
  ).get(userId);
  return row ? row.n : 0;
}

function listFor(userId, limit) {
  return db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
  ).all(userId, limit || 30);
}

function markAllRead(userId) {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), userId);
}

function emailStatusNote() {
  return email.senderConfigured()
    ? 'Email alerts are on (via ' + email.senderName() + ').'
    : 'Email alerts are off — the owner has not connected an email sender yet. Your bell notifications always work.';
}

module.exports = { KINDS, notify, unreadCount, listFor, markAllRead, emailStatusNote };
