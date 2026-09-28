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
  if (user && user.role === 'pro') {
    res.locals.proTier = billing.getTier(auth.currentPro(req));
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
    return res.render('dashboard', { pageTitle: 'My jobs', myRequests });
  }
  const pro = auth.currentPro(req);
  const inbox = db.prepare(
    `SELECT r.*, u.name AS customer_name, c.name AS category_name FROM requests r
     JOIN users u ON u.id = r.customer_id
     JOIN categories c ON c.id = r.category_id
     WHERE r.pro_id = ? ORDER BY r.created_at DESC LIMIT 20`
  ).all(pro.id);
  res.render('dashboard', {
    pageTitle: 'New jobs',
    inbox,
    pro,
    proTier: billing.getTier(pro)
  });
});

// --- Billing stub page ---
app.get('/billing', auth.requireLogin, (req, res) => {
  const user = auth.currentUser(req);
  const pro = user.role === 'pro' ? auth.currentPro(req) : null;
  const tier = billing.getTier(pro);
  res.render('billing', {
    pageTitle: 'Billing',
    tier,
    planName: billing.planName(),
    planPrice: billing.planPrice(),
    canBook: billing.canUse('booking', tier),
    canInvoice: billing.canUse('invoicing', tier)
  });
});

// --- Route mounting (pro router before public so /pro/services etc. win over /pro/:id) ---
app.use('/', require('./routes/auth'));
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
