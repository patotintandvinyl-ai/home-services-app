'use strict';
// Pro routes: profile, services, photos, inbox, estimates, booking, invoices.
// Booking ("Pick a day and time") and invoicing ("Your bill") require the Pro tier.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, now } = require('../db');
const auth = require('../lib/auth');
const billing = require('../lib/billing');
const commission = require('../lib/commission');
const notify = require('../lib/notify');
const shared = require('./requests');

const router = express.Router();
const requirePro = auth.requireRole('pro');

const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpeg, png, webp, gif).'));
  }
});

function proPhotos(proId) {
  return db.prepare('SELECT * FROM photos WHERE pro_id = ? ORDER BY id').all(proId);
}

// --- Profile ---
router.get('/pro/profile/edit', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  res.render('pro-profile-edit', {
    pageTitle: 'Edit your profile',
    profile: pro,
    photos: proPhotos(pro.id),
    error: null
  });
});

router.post('/pro/profile', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  const businessName = (req.body.business_name || '').trim();
  const bio = (req.body.bio || '').trim();
  const serviceArea = (req.body.service_area || '').trim();
  const years = parseInt(req.body.years_experience, 10);
  if (!businessName) {
    return res.status(400).render('pro-profile-edit', {
      pageTitle: 'Edit your profile',
      profile: pro,
      photos: proPhotos(pro.id),
      error: 'Please tell us your business name.'
    });
  }
  db.prepare(
    'UPDATE pro_profiles SET business_name = ?, bio = ?, service_area = ?, years_experience = ? WHERE id = ?'
  ).run(businessName, bio, serviceArea, isNaN(years) ? 0 : years, pro.id);
  res.redirect('/dashboard');
});

// --- Photos ---
router.post('/pro/photos', requirePro, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    const pro = auth.currentPro(req);
    if (err || !req.file) {
      return res.status(400).render('pro-profile-edit', {
        pageTitle: 'Edit your profile',
        profile: pro,
        photos: proPhotos(pro.id),
        error: err ? err.message : 'Please choose a photo to upload.'
      });
    }
    db.prepare(
      'INSERT INTO photos (pro_id, filename, caption, created_at) VALUES (?, ?, ?, ?)'
    ).run(pro.id, req.file.filename, (req.body.caption || '').trim(), now());
    res.redirect('/pro/profile/edit');
  });
});

router.post('/pro/photos/:id/delete', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND pro_id = ?').get(req.params.id, pro.id);
  if (photo) {
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    try { fs.unlinkSync(path.join(uploadDir, photo.filename)); } catch (e) { /* already gone */ }
  }
  res.redirect('/pro/profile/edit');
});

// --- Services ---
router.get('/pro/services', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  const services = db.prepare(
    `SELECT s.*, c.name AS category_name FROM services s
     JOIN categories c ON c.id = s.category_id
     WHERE s.pro_id = ? ORDER BY s.id`
  ).all(pro.id);
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  res.render('pro-services', {
    pageTitle: 'Your services',
    services,
    categories,
    error: null
  });
});

router.post('/pro/services', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  const categoryId = req.body.category_id;
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const priceHint = (req.body.price_hint || '').trim();
  const category = categoryId ? db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) : null;

  const fail = (error) => {
    const services = db.prepare(
      `SELECT s.*, c.name AS category_name FROM services s
       JOIN categories c ON c.id = s.category_id
       WHERE s.pro_id = ? ORDER BY s.id`
    ).all(pro.id);
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    return res.status(400).render('pro-services', { pageTitle: 'Your services', services, categories, error });
  };

  if (!category) return fail('Please choose a category.');
  if (!title) return fail('Please give your service a name.');
  db.prepare(
    'INSERT INTO services (pro_id, category_id, title, description, price_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(pro.id, category.id, title, description, priceHint, now());
  res.redirect('/pro/services');
});

router.post('/pro/services/:id/delete', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  db.prepare('DELETE FROM services WHERE id = ? AND pro_id = ?').run(req.params.id, pro.id);
  res.redirect('/pro/services');
});

// --- Inbox ("New jobs") ---
router.get('/pro/inbox', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  const requests = db.prepare(
    `SELECT r.*, u.name AS customer_name, c.name AS category_name FROM requests r
     JOIN users u ON u.id = r.customer_id
     JOIN categories c ON c.id = r.category_id
     WHERE r.pro_id = ? ORDER BY r.created_at DESC`
  ).all(pro.id);
  res.render('pro-inbox', { pageTitle: 'New jobs', requests });
});

// --- Request actions (pro must own the request) ---
function ownRequest(req, res) {
  const pro = auth.currentPro(req);
  const request = shared.loadRequest(req.params.id);
  if (!request || request.pro_id !== pro.id) {
    res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, this is not your job.'
    });
    return null;
  }
  return { pro, request };
}

// "Make a price"
router.post('/requests/:id/estimate', requirePro, (req, res) => {
  const found = ownRequest(req, res);
  if (!found) return;
  const dollars = parseFloat(req.body.amount);
  const notes = (req.body.notes || '').trim();
  const validDays = parseInt(req.body.valid_days, 10);
  if (isNaN(dollars) || dollars <= 0) {
    return shared.renderThread(res, found.request.id, {
      viewer: auth.currentUser(req),
      error: 'Please enter a price above zero.'
    });
  }
  db.prepare(
    `INSERT INTO estimates (request_id, pro_id, amount_cents, notes, valid_days, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'sent', ?)`
  ).run(found.request.id, found.pro.id, Math.round(dollars * 100), notes, isNaN(validDays) ? 7 : validDays, now());
  db.prepare("UPDATE requests SET status = 'estimate_sent' WHERE id = ?").run(found.request.id);
  notify.notify(found.request.customer_id, 'estimate_sent',
    'You got a price: $' + dollars.toFixed(2),
    found.pro.business_name + ' sent a price for "' + found.request.title + '".',
    '/requests/' + found.request.id);
  res.redirect('/requests/' + found.request.id);
});

router.post('/requests/:id/decline', requirePro, (req, res) => {
  const found = ownRequest(req, res);
  if (!found) return;
  db.prepare("UPDATE requests SET status = 'declined' WHERE id = ?").run(found.request.id);
  res.redirect('/pro/inbox');
});

// "Pick a day and time" — Pro tier only.
router.post('/requests/:id/book', requirePro, (req, res) => {
  const found = ownRequest(req, res);
  if (!found) return;
  if (!billing.canUse('booking', billing.getTier(found.pro))) {
    return res.render('upgrade', { pageTitle: 'Go Pro', feature: 'booking' });
  }
  const scheduledAt = (req.body.scheduled_at || '').trim();
  const notes = (req.body.notes || '').trim();
  if (!scheduledAt) {
    return shared.renderThread(res, found.request.id, {
      viewer: auth.currentUser(req),
      error: 'Please pick a day and time.'
    });
  }
  const existing = db.prepare('SELECT id FROM bookings WHERE request_id = ?').get(found.request.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO bookings (request_id, pro_id, customer_id, scheduled_at, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`
    ).run(found.request.id, found.pro.id, found.request.customer_id, scheduledAt, notes, now());
  }
  db.prepare("UPDATE requests SET status = 'booked' WHERE id = ?").run(found.request.id);
  notify.notify(found.request.customer_id, 'booking_scheduled',
    'Day and time picked for "' + found.request.title + '"',
    found.pro.business_name + ' booked it for ' + scheduledAt + '.',
    '/requests/' + found.request.id);
  res.redirect('/requests/' + found.request.id);
});

// "Your bill" — Pro tier only.
router.post('/requests/:id/invoice', requirePro, (req, res) => {
  const found = ownRequest(req, res);
  if (!found) return;
  if (!billing.canUse('invoicing', billing.getTier(found.pro))) {
    return res.render('upgrade', { pageTitle: 'Go Pro', feature: 'invoicing' });
  }
  const existing = db.prepare('SELECT id FROM invoices WHERE request_id = ?').get(found.request.id);
  if (existing) return res.redirect('/pro/invoices/' + existing.id);

  const asArray = (v) => (Array.isArray(v) ? v : (v === undefined ? [] : [v]));
  const descriptions = asArray(req.body.description);
  const qtys = asArray(req.body.qty);
  const prices = asArray(req.body.unit_price);
  const items = [];
  descriptions.forEach((d, i) => {
    const desc = (d || '').trim();
    if (!desc) return;
    const qty = parseInt(qtys[i], 10);
    const dollars = parseFloat(prices[i]);
    items.push({
      description: desc,
      qty: isNaN(qty) || qty < 1 ? 1 : qty,
      unit_price_cents: isNaN(dollars) || dollars < 0 ? 0 : Math.round(dollars * 100)
    });
  });
  if (!items.length) {
    return shared.renderThread(res, found.request.id, {
      viewer: auth.currentUser(req),
      error: 'Please add at least one line to the bill.'
    });
  }
  const info = db.prepare(
    "INSERT INTO invoices (request_id, pro_id, customer_id, status, created_at) VALUES (?, ?, ?, 'draft', ?)"
  ).run(found.request.id, found.pro.id, found.request.customer_id, now());
  const invoiceId = Number(info.lastInsertRowid);
  const insertItem = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, qty, unit_price_cents) VALUES (?, ?, ?, ?)'
  );
  items.forEach((it) => insertItem.run(invoiceId, it.description, it.qty, it.unit_price_cents));
  res.redirect('/pro/invoices/' + invoiceId);
});

function ownInvoice(req, res) {
  const pro = auth.currentPro(req);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice || invoice.pro_id !== pro.id) {
    res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, this bill is not yours.'
    });
    return null;
  }
  return invoice;
}

router.get('/pro/invoices/:id', requirePro, (req, res) => {
  const invoice = ownInvoice(req, res);
  if (!invoice) return;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoice.id);
  const total = items.reduce((sum, it) => sum + it.qty * it.unit_price_cents, 0);
  const request = shared.loadRequest(invoice.request_id);
  const pro = auth.currentPro(req);
  res.render('invoice', {
    pageTitle: 'Your bill',
    invoice,
    items,
    total_cents: total,
    request_title: request ? request.title : '',
    isPro: true
  });
});

router.post('/pro/invoices/:id/send', requirePro, (req, res) => {
  const invoice = ownInvoice(req, res);
  if (!invoice) return;
  if (invoice.status === 'draft') {
    db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(invoice.id);
    const request = shared.loadRequest(invoice.request_id);
    if (request) {
      notify.notify(request.customer_id, 'estimate_sent',
        'You got a bill for "' + request.title + '"',
        'Open the job to see it.', '/requests/' + request.id);
    }
  }
  res.redirect('/pro/invoices/' + invoice.id);
});

router.post('/pro/invoices/:id/paid', requirePro, (req, res) => {
  const invoice = ownInvoice(req, res);
  if (!invoice) return;
  db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(invoice.id);
  res.redirect('/pro/invoices/' + invoice.id);
});

// "The job is done" — marks the job completed so the customer can review it.
router.post('/requests/:id/complete', requirePro, (req, res) => {
  const found = ownRequest(req, res);
  if (!found) return;
  db.prepare("UPDATE requests SET status = 'completed' WHERE id = ?").run(found.request.id);
  db.prepare("UPDATE bookings SET status = 'done' WHERE request_id = ?").run(found.request.id);
  notify.notify(found.request.customer_id, 'review_request',
    'How was "' + found.request.title + '"?',
    'The job is done. Leave a quick star rating for ' + found.pro.business_name + '.',
    '/requests/' + found.request.id);
  res.redirect('/requests/' + found.request.id);
});

// Cancel a job — either side can. A pending/due fee is voided: no job, no fee.
router.post('/requests/:id/cancel', auth.requireLogin, (req, res) => {
  const request = shared.loadRequest(req.params.id);
  const user = auth.currentUser(req);
  if (!request || !shared.isParty(req, request)) {
    return res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, this is not your job.'
    });
  }
  db.prepare("UPDATE requests SET status = 'cancelled' WHERE id = ?").run(request.id);
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE request_id = ?").run(request.id);
  const voided = commission.voidCommission(request.id, 'Job cancelled — no fee');
  const otherId = user.id === request.customer_id ? request.pro_user_id : request.customer_id;
  notify.notify(otherId, 'commission_void',
    'Job cancelled: "' + request.title + '"',
    user.name + ' cancelled the job.' + (voided ? ' Any fee was cancelled too.' : ''),
    '/requests/' + request.id);
  res.redirect(user.role === 'pro' ? '/pro/inbox' : '/customer/requests');
});

// The pro confirms a pending fee. Tries a real card charge only when Stripe
// is connected; otherwise the fee is honestly tracked as "due".
router.post('/commissions/:id/confirm', requirePro, (req, res) => {
  const pro = auth.currentPro(req);
  const row = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!row || row.pro_id !== pro.id || row.status !== 'pending') {
    return res.status(403).render('error', {
      pageTitle: 'Not allowed',
      message: 'Sorry, that fee cannot be confirmed.'
    });
  }
  const done = commission.confirmCommission(row, (proId, cents, desc) => billing.chargeCard(proId, cents, desc));
  notify.notify(pro.user_id, 'commission_confirmed',
    done.status === 'charged' ? 'Fee charged: $' + (done.amount_cents / 100).toFixed(2)
                              : 'Fee tracked as due: $' + (done.amount_cents / 100).toFixed(2),
    done.status === 'charged'
      ? 'Thanks — the fee for "' + done.request_id + '" is paid.'
      : 'Card charging is not set up yet, so this fee is tracked as an amount you owe. It will charge automatically once the owner connects payments.',
    '/billing');
  res.redirect('/requests/' + row.request_id);
});

module.exports = router;
