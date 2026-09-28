'use strict';
// Shared job thread: view + messages. Only the request's customer or pro may
// view or post here — anyone else gets a 403.
const express = require('express');
const { db, now } = require('../db');
const auth = require('../lib/auth');
const billing = require('../lib/billing');

const router = express.Router();

function loadRequest(id) {
  return db.prepare(
    `SELECT r.*,
            pp.user_id AS pro_user_id,
            pp.business_name,
            pp.service_area AS pro_area,
            u.name AS customer_name,
            c.name AS category_name
     FROM requests r
     JOIN pro_profiles pp ON pp.id = r.pro_id
     JOIN users u ON u.id = r.customer_id
     JOIN categories c ON c.id = r.category_id
     WHERE r.id = ?`
  ).get(id);
}

function isParty(req, request) {
  const user = auth.currentUser(req);
  return !!user && (request.customer_id === user.id || request.pro_user_id === user.id);
}

function renderThread(res, requestId, extra) {
  const request = loadRequest(requestId);
  if (!request) {
    return res.status(404).render('error', {
      pageTitle: 'Not found',
      message: 'Sorry, that job was not found.'
    });
  }
  extra = extra || {};
  const viewer = extra.viewer || null;
  const isCustomerOwner = !!viewer && viewer.id === request.customer_id;
  const isProOwner = !!viewer && viewer.role === 'pro' && viewer.id === request.pro_user_id;

  const rawMessages = db.prepare(
    `SELECT m.*, u.name AS sender_name FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.request_id = ? ORDER BY m.created_at, m.id`
  ).all(requestId);
  const messages = rawMessages.map((m) => Object.assign({}, m, {
    mine: !!viewer && m.sender_id === viewer.id
  }));

  const estimates = db.prepare(
    'SELECT * FROM estimates WHERE request_id = ? ORDER BY created_at, id'
  ).all(requestId);

  const booking = db.prepare('SELECT * FROM bookings WHERE request_id = ?').get(requestId) || null;

  let invoice = db.prepare('SELECT * FROM invoices WHERE request_id = ?').get(requestId) || null;
  if (invoice) {
    const items = db.prepare(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id'
    ).all(invoice.id);
    invoice = Object.assign({}, invoice, {
      total_cents: items.reduce((sum, it) => sum + it.qty * it.unit_price_cents, 0)
    });
  }

  let proTier = null;
  if (isProOwner) {
    const pro = db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(request.pro_id);
    proTier = billing.getTier(pro);
  }

  // The person on the other side of this conversation.
  let otherParty = null;
  if (isCustomerOwner) otherParty = { name: request.business_name };
  else if (isProOwner) otherParty = { name: request.customer_name };

  res.render('thread', {
    pageTitle: 'Job: ' + request.title,
    request,
    messages,
    estimates,
    booking,
    invoice,
    isCustomerOwner,
    isProOwner,
    proTier,
    otherParty,
    error: extra.error || null
  });
}

router.get('/requests/:id', auth.requireLogin, (req, res) => {
  const request = loadRequest(req.params.id);
  if (!request) {
    return res.status(404).render('error', {
      pageTitle: 'Not found',
      message: 'Sorry, that job was not found.'
    });
  }
  if (!isParty(req, request)) {
    return res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, you are not part of this job.'
    });
  }
  renderThread(res, request.id, { viewer: auth.currentUser(req) });
});

router.post('/requests/:id/message', auth.requireLogin, (req, res) => {
  const request = loadRequest(req.params.id);
  if (!request || !isParty(req, request)) {
    return res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, you are not part of this job.'
    });
  }
  const body = (req.body.body || '').trim();
  if (!body) {
    return renderThread(res, request.id, {
      viewer: auth.currentUser(req),
      error: 'Please write a message first.'
    });
  }
  const user = auth.currentUser(req);
  db.prepare(
    'INSERT INTO messages (request_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(request.id, user.id, body, now());
  res.redirect('/requests/' + request.id);
});

module.exports = router;
module.exports.loadRequest = loadRequest;
module.exports.isParty = isParty;
module.exports.renderThread = renderThread;
