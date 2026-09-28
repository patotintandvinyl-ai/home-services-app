'use strict';
// Signup / login / logout.
const express = require('express');
const { db, now } = require('../db');
const auth = require('../lib/auth');

const router = express.Router();

router.get('/signup', (req, res) => {
  res.render('signup', { pageTitle: 'Sign up', error: null, values: {} });
});

router.post('/signup', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const role = req.body.role;
  const phone = (req.body.phone || '').trim();
  const businessName = (req.body.business_name || '').trim();
  const promoCode = (req.body.promo_code || '').trim();
  const values = { name, email, role, phone, business_name: businessName, promo_code: promoCode };

  let error = null;
  if (!name) error = 'Please tell us your name.';
  else if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error = 'Please enter a valid email address.';
  else if (!['customer', 'pro'].includes(role)) error = 'Please choose customer or pro.';
  else if (!password || password.length < 6) error = 'Your password needs at least 6 characters.';
  else if (role === 'pro' && !businessName) error = 'Please tell us your business name.';
  else if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    error = 'That email is already signed up. Try logging in instead.';
  }

  if (error) {
    return res.status(400).render('signup', { pageTitle: 'Sign up', error, values });
  }

  const info = db.prepare(
    'INSERT INTO users (email, password_hash, role, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(email, auth.hash(password), role, name, phone, now());
  const userId = Number(info.lastInsertRowid);

  if (role === 'pro') {
    db.prepare(
      'INSERT INTO pro_profiles (user_id, business_name, created_at) VALUES (?, ?, ?)'
    ).run(userId, businessName, now());
  }

  req.session.userId = userId;
  req.session.role = role;

  // Promo code at signup (customers: credit codes; pros: trial/partner codes).
  if (promoCode) {
    try {
      const promo = require('../lib/promo');
      const user = { id: userId, role, email };
      const v = promo.validate(promoCode, userId);
      const kindOk = role === 'customer' ? v.ok && v.code.kind === 'customer_credit' : v.ok;
      if (kindOk) {
        promo.redeem(promoCode, user);
        req.session.promo_ok = true;
      } else {
        req.session.promo_error = v.ok ? 'That code is for pros.' : v.reason;
      }
    } catch (e) {
      req.session.promo_error = e.message;
    }
  }

  res.redirect('/dashboard');
});

router.get('/login', (req, res) => {
  res.render('login', { pageTitle: 'Log in', error: null, values: {} });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !auth.compare(password, user.password_hash)) {
    return res.status(401).render('login', {
      pageTitle: 'Log in',
      error: 'Wrong email or password. Please try again.',
      values: { email }
    });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
