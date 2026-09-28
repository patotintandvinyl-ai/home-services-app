'use strict';
// Customer routes: new job request, my jobs, accept/decline estimates.
const express = require('express');
const { db, now } = require('../db');
const auth = require('../lib/auth');
const billing = require('../lib/billing');
const notify = require('../lib/notify');
const reviews = require('../lib/reviews');
const promo = require('../lib/promo');
const shared = require('./requests');

const router = express.Router();

function requestNewLocals(overrides) {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  return Object.assign({
    pageTitle: 'What do you need done?',
    proId: null,
    serviceId: null,
    selectedCategory: null,
    categories,
    values: {},
    error: null
  }, overrides || {});
}

// "What do you need done?" form. Query params: ?pro=<proId>&service=<serviceId?>
// The form POSTs hidden fields pro_id and service_id (integration note 2).
router.get('/request/new', auth.requireLogin, (req, res) => {
  const pro = db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(req.query.pro);
  if (!pro) {
    return res.status(404).render('error', {
      pageTitle: 'Not found',
      message: 'Sorry, that pro was not found.'
    });
  }
  let serviceId = null;
  let selectedCategory = null;
  if (req.query.service) {
    const service = db.prepare(
      'SELECT * FROM services WHERE id = ? AND pro_id = ?'
    ).get(req.query.service, pro.id) || null;
    if (service) {
      serviceId = service.id;
      selectedCategory = service.category_id;
    }
  }
  res.render('request-new', requestNewLocals({
    proId: pro.id,
    serviceId,
    selectedCategory
  }));
});

router.post('/request', auth.requireLogin, (req, res) => {
  const user = auth.currentUser(req);
  const proId = req.body.pro_id;
  const serviceId = req.body.service_id || null;
  const categoryId = req.body.category_id;
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const preferredDate = (req.body.preferred_date || '').trim();

  const pro = proId ? db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(proId) : null;
  const category = categoryId ? db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) : null;
  let service = null;
  if (serviceId && pro) {
    service = db.prepare('SELECT * FROM services WHERE id = ? AND pro_id = ?').get(serviceId, pro.id) || null;
  }

  let error = null;
  if (!pro) error = 'Please choose a pro for this job.';
  else if (!category) error = 'Please choose a category.';
  else if (!title) error = 'Please give your job a short title.';
  else if (!description) error = 'Please tell us in your own words what you need.';
  else if (!billing.hasCardOnFile(pro.id)) {
    error = 'This pro has not finished setting up payments yet, so they cannot take new jobs right now. Please pick another pro.';
  }

  if (error) {
    return res.status(400).render('request-new', requestNewLocals({
      proId: pro ? pro.id : proId,
      serviceId: service ? service.id : (serviceId || null),
      selectedCategory: category ? category.id : (categoryId || null),
      error,
      values: { title, description, preferred_date: preferredDate }
    }));
  }

  const info = db.prepare(
    `INSERT INTO requests
       (customer_id, pro_id, service_id, category_id, title, description, preferred_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`
  ).run(user.id, pro.id, serviceId, category.id, title, description, preferredDate, now());
  const requestId = Number(info.lastInsertRowid);
  notify.notify(pro.user_id, 'request_new',
    'New job request: ' + title,
    user.name + ' needs help: ' + (description.length > 140 ? description.slice(0, 140) + '…' : description),
    '/requests/' + requestId);
  res.redirect('/requests/' + requestId);
});

// "My jobs" list.
router.get('/customer/requests', auth.requireRole('customer'), (req, res) => {
  const user = auth.currentUser(req);
  const rows = db.prepare(
    `SELECT r.*, pp.business_name, c.name AS category_name FROM requests r
     JOIN pro_profiles pp ON pp.id = r.pro_id
     JOIN categories c ON c.id = r.category_id
     WHERE r.customer_id = ? ORDER BY r.created_at DESC`
  ).all(user.id);
  const myRequests = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    pro_name: r.business_name
  }));
  res.render('customer-requests', { pageTitle: 'My jobs', myRequests });
});

function loadCustomerEstimate(req, res) {
  const request = shared.loadRequest(req.params.id);
  const user = auth.currentUser(req);
  if (!request || request.customer_id !== user.id) {
    res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, this is not your job.'
    });
    return null;
  }
  const estimate = db.prepare(
    'SELECT * FROM estimates WHERE id = ? AND request_id = ?'
  ).get(req.params.eid, request.id);
  if (!estimate || estimate.status !== 'sent') {
    res.redirect('/requests/' + request.id);
    return null;
  }
  return { request, estimate };
}

router.post('/requests/:id/estimates/:eid/accept', auth.requireRole('customer'), (req, res) => {
  const found = loadCustomerEstimate(req, res);
  if (!found) return;
  db.prepare("UPDATE estimates SET status = 'accepted' WHERE id = ?").run(found.estimate.id);
  db.prepare("UPDATE requests SET status = 'accepted' WHERE id = ?").run(found.request.id);
  const proUser = db.prepare('SELECT user_id FROM pro_profiles WHERE id = ?').get(found.request.pro_id);
  if (proUser) {
    notify.notify(proUser.user_id, 'estimate_accepted',
      'Your price was accepted: $' + (found.estimate.amount_cents / 100).toFixed(2),
      'The customer accepted your price for "' + found.request.title + '". Time to pick a day.',
      '/requests/' + found.request.id);
  }
  res.redirect('/requests/' + found.request.id);
});

router.post('/requests/:id/estimates/:eid/decline', auth.requireRole('customer'), (req, res) => {
  const found = loadCustomerEstimate(req, res);
  if (!found) return;
  db.prepare("UPDATE estimates SET status = 'declined' WHERE id = ?").run(found.estimate.id);
  // Back to "new" so the pro can make another price.
  db.prepare("UPDATE requests SET status = 'new' WHERE id = ?").run(found.request.id);
  res.redirect('/requests/' + found.request.id);
});

// Leave a star rating + words after the job is done. One per job.
router.post('/requests/:id/review', auth.requireRole('customer'), (req, res) => {
  const user = auth.currentUser(req);
  const check = reviews.canReview(req.params.id, user.id);
  if (!check.ok) {
    return shared.renderThread(res, req.params.id, {
      viewer: user,
      error: check.reason === 'already'
        ? 'You already left a review for this job.'
        : 'You can leave a review after the job is done.'
    });
  }
  const request = check.request;
  const review = reviews.addReview(request.id, request.pro_id, user.id, req.body.rating, req.body.text);
  const proUser = db.prepare('SELECT user_id FROM pro_profiles WHERE id = ?').get(request.pro_id);
  if (proUser) {
    notify.notify(proUser.user_id, 'review_received',
      'New ' + review.rating + '-star review',
      user.name + ' reviewed "' + request.title + '".',
      '/pro/' + request.pro_id);
  }
  res.redirect('/requests/' + request.id);
});

// Redeem a promo code (customers: account credit codes).
router.post('/account/promo', auth.requireRole('customer'), (req, res) => {
  const user = auth.currentUser(req);
  const v = promo.validate(req.body.code, user.id);
  if (!v.ok || v.code.kind !== 'customer_credit') {
    return res.redirect('/dashboard?promo_error=' + encodeURIComponent(v.ok ? 'That code is for pros.' : v.reason));
  }
  const result = promo.redeem(req.body.code, user);
  notify.notify(user.id, 'promo_redeemed', 'Promo code used', result.effect, '/dashboard');
  res.redirect('/dashboard?promo_ok=' + encodeURIComponent(result.effect));
});

module.exports = router;
