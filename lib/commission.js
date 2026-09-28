'use strict';
// Commission system: plain-language money rules.
//
// - Free pros pay 10% of the job price. Pro ($39/month) pros pay 5%.
// - We only charge when the pro and customer AGREE on a day and time
//   (for example "Tuesday at 2 works") — not when they just talk about it.
// - The charge is never silent: a pending commission is created and the pro
//   must press confirm. If the job is cancelled, the commission is voided.
// - Amount base: accepted price first, bill total second. Smallest fee is $5.
// - Real card charging only happens when STRIPE_SECRET_KEY is set. Until
//   then, confirmed commissions are tracked as "due" ledger entries.
const { db, now } = require('../db');

const RATE_FREE = 0.10;
const RATE_PRO = 0.05;
const MIN_COMMISSION_CENTS = 500; // $5

function rateForTier(tier) {
  return tier === 'pro' ? RATE_PRO : RATE_FREE;
}

// Detects a concrete agreement on a day and time, e.g. "Tuesday at 2 works".
// Needs all three: a day word, a clock time, and an agreement word.
// This is intentionally strict to avoid charging by accident.
const DAY_WORDS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'today', 'tomorrow'
];
const TIME_RE = /(\bat\s+\d{1,2}(:\d{2})?\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}\s*o'clock\b)/i;
const AGREE_RE = /\b(works|perfect|great|sounds good|see you|confirmed|confirm|deal|locked in|all set|yes|ok|okay|booked)\b/i;

function detectAgreement(text) {
  const t = (text || '').toLowerCase();
  const hasDay = DAY_WORDS.some((d) => t.includes(d));
  if (!hasDay) return false;
  if (!TIME_RE.test(t)) return false;
  return AGREE_RE.test(t);
}

// The job price we take the percent from: accepted price first, bill second.
function baseAmountCents(requestId) {
  const est = db.prepare(
    "SELECT amount_cents FROM estimates WHERE request_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1"
  ).get(requestId);
  if (est) return est.amount_cents;
  const inv = db.prepare(
    `SELECT COALESCE(SUM(qty * unit_price_cents), 0) AS total FROM invoice_items
     WHERE invoice_id = (SELECT id FROM invoices WHERE request_id = ?)`
  ).get(requestId);
  return inv ? inv.total : 0;
}

function commissionFor(baseCents, tier) {
  if (!baseCents || baseCents <= 0) return 0;
  const amount = Math.round(baseCents * rateForTier(tier));
  return Math.max(MIN_COMMISSION_CENTS, amount);
}

function existingCommission(requestId) {
  return db.prepare('SELECT * FROM commissions WHERE request_id = ?').get(requestId) || null;
}

// Called after every new message. Creates a PENDING commission (never a
// charge) when a real day-and-time agreement is spotted. Partners skip the
// fee entirely — recorded as waived with a "Partner" note.
function maybeCreatePending(request, tier) {
  if (!request || request.status === 'cancelled' || request.status === 'completed') return null;
  if (existingCommission(request.id)) return null;
  const pro = db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(request.pro_id);
  const base = baseAmountCents(request.id);
  const info = db.prepare(
    `INSERT INTO commissions
       (request_id, pro_id, customer_id, base_amount_cents, rate, amount_cents, status, created_at, waived, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  if (pro && pro.is_partner) {
    const r = info.run(request.id, request.pro_id, request.customer_id, base, 0, 0, 'waived', now(), 1, 'Partner — 0% commission forever');
    return db.prepare('SELECT * FROM commissions WHERE id = ?').get(Number(r.lastInsertRowid));
  }
  const amount = commissionFor(base, tier);
  const r = info.run(request.id, request.pro_id, request.customer_id, base, rateForTier(tier), amount, 'pending', now(), 0, '');
  return db.prepare('SELECT * FROM commissions WHERE id = ?').get(Number(r.lastInsertRowid));
}

// The pro pressed "confirm". If Stripe is ready we try a real charge,
// otherwise we honestly record it as "due".
function confirmCommission(commission, chargeFn) {
  const fresh = db.prepare('SELECT * FROM commissions WHERE id = ?').get(commission.id);
  if (!fresh || fresh.status !== 'pending') return fresh;
  // Recompute: the price may have changed since the pending record was made.
  const pro = db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(fresh.pro_id);
  const tier = pro && pro.tier === 'pro' ? 'pro' : 'free';
  const base = baseAmountCents(fresh.request_id);
  const amount = commissionFor(base, tier);
  const attempt = chargeFn ? chargeFn(fresh.pro_id, amount, 'Commission for job #' + fresh.request_id) : { charged: false };
  const status = attempt && attempt.charged ? 'charged' : 'due';
  db.prepare(
    "UPDATE commissions SET base_amount_cents = ?, amount_cents = ?, status = ?, confirmed_at = ?, note = ? WHERE id = ?"
  ).run(base, amount, status, now(), (attempt && attempt.note) || '', fresh.id);
  return db.prepare('SELECT * FROM commissions WHERE id = ?').get(fresh.id);
}

function voidCommission(requestId, reason) {
  const c = existingCommission(requestId);
  if (!c || c.status === 'void' || c.status === 'waived') return c;
  db.prepare("UPDATE commissions SET status = 'void', note = ? WHERE id = ?").run(reason || 'Job cancelled', c.id);
  return db.prepare('SELECT * FROM commissions WHERE id = ?').get(c.id);
}

// A 'commission_free' promo code lets jobs skip the fee entirely.
function applyWaiverIfAvailable(proId, commission) {
  const waiver = db.prepare(
    `SELECT w.* FROM promo_waivers w
     JOIN promo_redemptions r ON r.id = w.redemption_id
     WHERE w.pro_id = ? AND w.jobs_remaining > 0
     ORDER BY w.id LIMIT 1`
  ).get(proId);
  if (!waiver) return false;
  db.prepare('UPDATE promo_waivers SET jobs_remaining = jobs_remaining - 1 WHERE id = ?').run(waiver.id);
  db.prepare("UPDATE commissions SET status = 'waived', waived = 1, amount_cents = 0, note = 'Free with promo code' WHERE id = ?").run(commission.id);
  return true;
}

function historyForPro(proId) {
  return db.prepare(
    `SELECT c.*, r.title AS job_title FROM commissions c
     JOIN requests r ON r.id = c.request_id
     WHERE c.pro_id = ? ORDER BY c.created_at DESC`
  ).all(proId);
}

const STATUS_WORDS = {
  pending: 'Waiting for you to confirm',
  confirmed: 'Confirmed',
  due: 'Due (no card charging set up yet)',
  charged: 'Charged',
  waived: 'Waived (promo code)',
  void: 'Cancelled — no charge'
};

// Partners see "Partner — 0% commission" instead of the generic waived words.
function statusWords(commission) {
  if (commission && commission.status === 'waived' && (commission.note || '').indexOf('Partner') === 0) {
    return 'Partner — 0% commission';
  }
  return STATUS_WORDS[(commission && commission.status)] || (commission && commission.status);
}

module.exports = {
  RATE_FREE,
  RATE_PRO,
  MIN_COMMISSION_CENTS,
  rateForTier,
  detectAgreement,
  baseAmountCents,
  commissionFor,
  maybeCreatePending,
  confirmCommission,
  voidCommission,
  applyWaiverIfAvailable,
  historyForPro,
  existingCommission,
  STATUS_WORDS,
  statusWords
};
