'use strict';
// Billing tiers + Stripe-shaped payment module.
//
// Tiers: 'free' (list services, get requests, 10% per booked job) and
// 'pro' ($39/month: scheduling, estimates, invoicing, 5% per booked job).
// A promo code can also grant Pro free for a number of days (trial).
//
// STRIPE: this module is Stripe-SHAPED, not Stripe-connected. Nothing here
// touches the real Stripe network. When STRIPE_SECRET_KEY is set, the owner
// can wire these stubs to the real Stripe SDK; until then every card action
// is an honest no-op and commissions are tracked as "due".
const { db, now } = require('../db');

const TIER_FREE = 'free';
const TIER_PRO = 'pro';

function getTier(proProfile) {
  if (!proProfile) return TIER_FREE;
  if (proProfile.tier === TIER_PRO) return TIER_PRO;
  // Promo trial: free Pro until the trial runs out.
  if (proProfile.trial_ends_at && proProfile.trial_ends_at > now()) return TIER_PRO;
  return TIER_FREE;
}

function trialDaysLeft(proProfile) {
  if (!proProfile || !proProfile.trial_ends_at) return 0;
  const ms = new Date(proProfile.trial_ends_at).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

// Features 'booking' ("Pick a day and time") and 'invoicing' ("Your bill")
// require the Pro tier. Everything else is free.
function canUse(feature, tier) {
  if (feature === 'booking' || feature === 'invoicing') {
    return tier === TIER_PRO;
  }
  return true;
}

function planName() {
  return 'Pro';
}

function planPrice() {
  return '$39/month';
}

function commissionRate(tier) {
  return tier === TIER_PRO ? 0.05 : 0.10;
}

function commissionRateWords(tier) {
  return tier === TIER_PRO ? '5%' : '10%';
}

// --- Card on file ---
// A pro must have a card on file before they can receive customer requests.
// In demo mode (no STRIPE_SECRET_KEY) the pro can save a clearly-labeled
// DEMO card so the flow works end to end; it can never charge anyone.
function hasCardOnFile(proId) {
  const row = db.prepare(
    'SELECT id FROM pro_payment_methods WHERE pro_id = ? ORDER BY id DESC LIMIT 1'
  ).get(proId);
  return !!row;
}

function cardOnFile(proId) {
  return db.prepare(
    'SELECT * FROM pro_payment_methods WHERE pro_id = ? ORDER BY id DESC LIMIT 1'
  ).get(proId) || null;
}

function saveDemoCard(proId) {
  if (hasCardOnFile(proId)) return cardOnFile(proId);
  const info = db.prepare(
    `INSERT INTO pro_payment_methods
       (pro_id, stripe_customer_id, stripe_payment_method_id, brand, last4, is_demo, created_at)
     VALUES (?, '', '', 'Demo', '0000', 1, ?)`
  ).run(proId, now());
  return db.prepare('SELECT * FROM pro_payment_methods WHERE id = ?').get(Number(info.lastInsertRowid));
}

// --- Stripe-shaped stubs ---
function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

// Shape of a Stripe SetupIntent for saving a card. Without a key this is
// only a demo placeholder — the billing page says so out loud.
function createSetupIntent(proId) {
  if (!stripeConfigured()) {
    return {
      stub: true,
      client_secret: 'demo_setup_secret_for_pro_' + proId,
      note: 'Demo only — set STRIPE_SECRET_KEY to save real cards with Stripe.'
    };
  }
  // Real wiring point: stripe.setupIntents.create({ customer, usage: 'off_session' })
  return { stub: false, note: 'Wire to stripe.setupIntents.create here.' };
}

// Shape of an off-session Stripe charge for a commission. Returns
// { charged: true } only when Stripe is actually configured; otherwise the
// caller records the commission as "due".
function chargeCard(proId, amountCents, description) {
  if (!stripeConfigured()) {
    return {
      charged: false,
      note: 'Card charging is not set up yet — the owner needs to add STRIPE_SECRET_KEY. Amount tracked as due.',
      amount_cents: amountCents,
      description
    };
  }
  const pm = cardOnFile(proId);
  if (!pm || pm.is_demo) {
    return { charged: false, note: 'No real card on file.', amount_cents: amountCents, description };
  }
  // Real wiring point: stripe.paymentIntents.create({
  //   amount: amountCents, currency: 'usd', customer: pm.stripe_customer_id,
  //   payment_method: pm.stripe_payment_method_id, off_session: true,
  //   confirm: true, description })
  return { charged: false, note: 'Stripe SDK not wired in this build.', amount_cents: amountCents, description };
}

// Old stub kept for compatibility.
function stripeCheckoutStub() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Billing not configured — set STRIPE_SECRET_KEY');
  }
  return { stub: true, note: 'Checkout stub only; no real payment is processed.' };
}

module.exports = {
  TIER_FREE,
  TIER_PRO,
  getTier,
  trialDaysLeft,
  canUse,
  planName,
  planPrice,
  commissionRate,
  commissionRateWords,
  hasCardOnFile,
  cardOnFile,
  saveDemoCard,
  stripeConfigured,
  createSetupIntent,
  chargeCard,
  stripeCheckoutStub
};
