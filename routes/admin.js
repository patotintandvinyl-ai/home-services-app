'use strict';
// Owner-only promo code management. The owner is whoever's email matches
// the ADMIN_EMAIL environment variable.
const express = require('express');
const { db, now } = require('../db');
const auth = require('../lib/auth');
const promo = require('../lib/promo');

const router = express.Router();

function requireAdmin(req, res, next) {
  const user = auth.currentUser(req);
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!user || !adminEmail || user.email.toLowerCase() !== adminEmail) {
    return res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, this page is for the site owner only.'
    });
  }
  next();
}

router.get('/admin/promos', auth.requireLogin, requireAdmin, (req, res) => {
  const codes = promo.allCodes().map((c) => Object.assign({}, c, {
    kind_words: promo.kindWords(c.kind),
    redemptions: promo.redemptionsFor(c.id)
  }));
  res.render('admin-promos', {
    pageTitle: 'Promo codes',
    codes,
    kinds: promo.KINDS,
    error: null
  });
});

router.post('/admin/promos', auth.requireLogin, requireAdmin, (req, res) => {
  const code = promo.normalizeCode(req.body.code);
  const kind = req.body.kind;
  const value = parseInt(req.body.value, 10) || 0;
  // Blank max = unlimited, blank expiry = never expires.
  const maxRaw = (req.body.max_redemptions || '').trim();
  const maxRedemptions = maxRaw === '' ? null : Math.max(1, parseInt(maxRaw, 10) || 1);
  const expiryRaw = (req.body.expires_at || '').trim();
  const expiresAt = expiryRaw ? new Date(expiryRaw + 'T23:59:59').toISOString() : null;

  const fail = (error) => {
    const codes = promo.allCodes().map((c) => Object.assign({}, c, {
      kind_words: promo.kindWords(c.kind),
      redemptions: promo.redemptionsFor(c.id)
    }));
    return res.status(400).render('admin-promos', {
      pageTitle: 'Promo codes', codes, kinds: promo.KINDS, error
    });
  };

  if (!code) return fail('Please type a code, like WELCOME10.');
  if (!promo.KINDS[kind]) return fail('Please pick what the code does.');
  if (kind === 'customer_credit' && value <= 0) return fail('For credit, enter an amount in cents (for example 1000 = $10).');
  if (promo.findByCode(code)) return fail('That code already exists.');

  db.prepare(
    `INSERT INTO promo_codes (code, kind, value, max_redemptions, expires_at, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(code, kind, value, maxRedemptions, expiresAt, now());
  res.redirect('/admin/promos');
});

router.post('/admin/promos/:id/toggle', auth.requireLogin, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id);
  if (row) {
    db.prepare('UPDATE promo_codes SET active = ? WHERE id = ?').run(row.active ? 0 : 1, row.id);
  }
  res.redirect('/admin/promos');
});

module.exports = router;
module.exports.requireAdmin = requireAdmin;
