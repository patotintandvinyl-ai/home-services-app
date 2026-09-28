'use strict';
// Password hashing (bcryptjs, 10 rounds) + session/auth middleware helpers.
const bcrypt = require('bcryptjs');
const { db } = require('../db');

function hash(password) {
  return bcrypt.hashSync(password, 10);
}

function compare(password, passwordHash) {
  return bcrypt.compareSync(password, passwordHash);
}

// Logged-in user row (never includes password_hash), or null.
function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  return db.prepare(
    'SELECT id, email, role, name, phone, created_at FROM users WHERE id = ?'
  ).get(req.session.userId) || null;
}

// pro_profiles row for the logged-in pro user, or null.
function currentPro(req) {
  const user = currentUser(req);
  if (!user || user.role !== 'pro') return null;
  return db.prepare('SELECT * FROM pro_profiles WHERE user_id = ?').get(user.id) || null;
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  next();
}

function requireRole(role) {
  return function (req, res, next) {
    const user = currentUser(req);
    if (!user) return res.redirect('/login');
    if (user.role !== role) {
      return res.status(403).render('error', {
        title: 'Not allowed',
        message: 'Sorry, this page is not for you.'
      });
    }
    next();
  };
}

module.exports = { hash, compare, currentUser, currentPro, requireLogin, requireRole };
