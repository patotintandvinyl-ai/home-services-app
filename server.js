'use strict';
// Express app wiring: sessions, parsing, static files, views, route mounting.
const path = require('path');
const express = require('express');
const session = require('express-session');
const layouts = require('express-ejs-layouts');

// Boots db/ (creates data/, data/uploads, runs schema).
const { db } = require('./db');
const auth = require('./lib/auth');
const billing = require('./lib/billing');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Sessions ---
let secret = process.env.SESSION_SECRET;
if (!secret) {
  console.warn('WARNING: SESSION_SECRET is not set — using an insecure dev fallback. Set SESSION_SECRET in production.');
  secret = 'dev-secret-change-me';
}
app.use(session({
  secret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// --- Views (express-ejs-layouts: layout.ejs wraps every view via <%- body %>) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(layouts);

// --- Parsing & static ---
app.use(express.urlencoded({ extended: true })); // form POSTs (incl. description[] arrays)
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// `user` and `proTier` available to every view AND the layout.
app.use((req, res, next) => {
  const user = auth.currentUser(req);
  res.locals.user = user;
  res.locals.proTier = null;
  res.locals.unreadCount = 0;
  res.locals.isAdmin = false;
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (user) {
    if (user.email && user.email.toLowerCase() === adminEmail && adminEmail) res.locals.isAdmin = true;
    if (user.role === 'pro') {
      res.locals.proTier = billing.getTier(auth.currentPro(req));
    }
    try {
      res.locals.unreadCount = require('./lib/notify').unreadCount(user.id);
    } catch (e) { /* notifications table not ready yet */ }
  }
  next();
});

// --- Dashboard (role-aware) ---
app.get('/dashboard', auth.requireLogin, (req, res) => {
  const user = auth.currentUser(req);
  if (user.role === 'customer') {
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
    const promo = require('./lib/promo');
    const custLocals = {
      pageTitle: 'My jobs',
      myRequests,
      credit_cents: promo.creditForCustomer(user.id),
      promo_error: req.query.promo_error || req.session.promo_error || null,
      promo_ok: req.query.promo_ok || (req.session.promo_ok ? 'Promo code applied.' : null)
    };
    delete req.session.promo_error;
    delete req.session.promo_ok;
    return res.render('dashboard', custLocals);
  }
  const pro = auth.currentPro(req);
  const inbox = db.prepare(
    `SELECT r.*, u.name AS customer_name, c.name AS category_name FROM requests r
     JOIN users u ON u.id = r.customer_id
     JOIN categories c ON c.id = r.category_id
     WHERE r.pro_id = ? ORDER BY r.created_at DESC LIMIT 20`
  ).all(pro.id);
  const dashLocals = {
    pageTitle: 'New jobs',
    inbox,
    pro,
    proTier: billing.getTier(pro),
    hasCard: billing.hasCardOnFile(pro.id),
    trialDays: billing.trialDaysLeft(pro),
    isPartner: !!pro.is_partner,
    promo_error: req.query.promo_error || req.session.promo_error || null,
    promo_ok: req.query.promo_ok || (req.session.promo_ok ? 'Promo code applied.' : null)
  };
  delete req.session.promo_error;
  delete req.session.promo_ok;
  res.render('dashboard', dashLocals);
});

// --- Notifications (the bell) ---
app.get('/notifications', auth.requireLogin, (req, res) => {
  const user = auth.currentUser(req);
  const notify = require('./lib/notify');
  const items = notify.listFor(user.id, 40);
  notify.markAllRead(user.id);
  res.render('notifications', {
    pageTitle: 'Notifications',
    items,
    emailNote: notify.emailStatusNote()
  });
});

// --- Billing: plan, card on file, promo codes, fee history ---
app.get('/billing', auth.requireLogin, (req, res) => {
  const user = auth.currentUser(req);
  const pro = user.role === 'pro' ? auth.currentPro(req) : null;
  const tier = billing.getTier(pro);
  const commission = require('./lib/commission');
  const promo = require('./lib/promo');
  res.render('billing', {
    pageTitle: 'Billing',
    tier,
    isPartner: !!pro && !!pro.is_partner,
    trialDays: pro ? billing.trialDaysLeft(pro) : 0,
    planName: billing.planName(),
    planPrice: billing.planPrice(),
    rateWords: billing.commissionRateWords(tier),
    canBook: billing.canUse('booking', tier),
    canInvoice: billing.canUse('invoicing', tier),
    hasCard: pro ? billing.hasCardOnFile(pro.id) : false,
    card: pro ? billing.cardOnFile(pro.id) : null,
    stripeReady: billing.stripeConfigured(),
    commissions: pro ? commission.historyForPro(pro.id).map((c) => Object.assign({}, c, {
      words: commission.statusWords(c)
    })) : [],
    waivers: pro ? promo.waiversForPro(pro.id) : [],
    promo_error: req.query.promo_error || null,
    promo_ok: req.query.promo_ok || null
  });
});

// Save a card on file. Demo mode (no Stripe key) saves a clearly-labeled
// DEMO card so the whole flow works without charging anyone, ever.
app.post('/billing/card', auth.requireLogin, auth.requireRole('pro'), (req, res) => {
  const pro = auth.currentPro(req);
  if (billing.stripeConfigured()) {
    billing.createSetupIntent(pro.id);
    // Real wiring would confirm the SetupIntent on the client first.
  }
  billing.saveDemoCard(pro.id);
  res.redirect('/billing');
});

// Pros redeem promo codes here (Pro trials, no-fee jobs, partner access).
app.post('/billing/promo', auth.requireLogin, auth.requireRole('pro'), (req, res) => {
  const user = auth.currentUser(req);
  const promo = require('./lib/promo');
  const notify = require('./lib/notify');
  const v = promo.validate(req.body.code, user.id);
  if (!v.ok) {
    return res.redirect('/billing?promo_error=' + encodeURIComponent(v.reason));
  }
  try {
    const result = promo.redeem(req.body.code, user);
    notify.notify(user.id, 'promo_redeemed', 'Promo code used: ' + result.code.code, result.effect, '/billing');
    res.redirect('/billing?promo_ok=' + encodeURIComponent(result.effect));
  } catch (e) {
    res.redirect('/billing?promo_error=' + encodeURIComponent(e.message));
  }
});

// --- Route mounting (pro router before public so /pro/services etc. win over /pro/:id) ---
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/pro'));
app.use('/', require('./routes/customer'));
app.use('/', require('./routes/requests'));
app.use('/', require('./routes/public'));

// --- 404 + error handlers (simple error text) ---
app.use((req, res) => {
  res.status(404).render('error', {
    pageTitle: 'Page not found',
    message: 'Sorry, that page does not exist.'
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).render('error', {
    pageTitle: 'Something went wrong',
    message: 'Sorry, something went wrong. Please try again.'
  });
});

app.listen(PORT, () => {
  console.log('Marketplace app listening on port ' + PORT);
});
