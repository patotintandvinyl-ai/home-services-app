'use strict';
// Reviews: 1–5 stars + words from the customer, after the job is done.
// One review per job. Pros can read them, never change them.
const { db, now } = require('../db');

function canReview(requestId, customerId) {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  if (!request || request.customer_id !== customerId) return { ok: false, reason: 'not_yours' };
  if (request.status !== 'completed') return { ok: false, reason: 'not_done' };
  const existing = db.prepare('SELECT id FROM reviews WHERE request_id = ?').get(requestId);
  if (existing) return { ok: false, reason: 'already' };
  return { ok: true, request };
}

function addReview(requestId, proId, customerId, rating, text) {
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw new Error('Rating must be 1 to 5 stars.');
  const info = db.prepare(
    'INSERT INTO reviews (request_id, pro_id, customer_id, rating, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(requestId, proId, customerId, r, (text || '').trim(), now());
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(info.lastInsertRowid));
}

function forRequest(requestId) {
  return db.prepare('SELECT * FROM reviews WHERE request_id = ?').get(requestId) || null;
}

function forPro(proId) {
  return db.prepare(
    `SELECT rv.*, u.name AS customer_name FROM reviews rv
     JOIN users u ON u.id = rv.customer_id
     WHERE rv.pro_id = ? ORDER BY rv.created_at DESC, rv.id DESC`
  ).all(proId);
}

// Average stars + how many reviews. Attached to pro cards everywhere.
function ratingSummary(proId) {
  const row = db.prepare(
    'SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE pro_id = ?'
  ).get(proId);
  return {
    count: row.n || 0,
    average: row.n ? Math.round(row.avg * 10) / 10 : 0
  };
}

function starsText(average) {
  const full = Math.round(average);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

module.exports = { canReview, addReview, forRequest, forPro, ratingSummary, starsText };
