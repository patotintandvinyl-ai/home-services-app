'use strict';
// Marketplace test suite: plain node assertions, isolated throwaway database.
// Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-test-'));
process.env.DATA_DIR = tmpDir;

const { db, now } = require('../db');
const auth = require('../lib/auth');
const billing = require('../lib/billing');
const commission = require('../lib/commission');
const notify = require('../lib/notify');
const promo = require('../lib/promo');
const reviews = require('../lib/reviews');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// --- fixtures ---
function makeUser(email, role, name) {
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(email, auth.hash('secret123'), role, name || email, now());
  return Number(info.lastInsertRowid);
}
function makePro(userId, business) {
  const info = db.prepare(
    'INSERT INTO pro_profiles (user_id, business_name, created_at) VALUES (?, ?, ?)'
  ).run(userId, business, now());
  return db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(Number(info.lastInsertRowid));
}
function makeRequest(customerId, proId, status) {
  const info = db.prepare(
    `INSERT INTO requests (customer_id, pro_id, category_id, title, description, status, created_at)
     VALUES (?, ?, 1, 'Test job', 'Do the thing', ?, ?)`
  ).run(customerId, proId, status || 'new', now());
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(info.lastInsertRowid));
}
function makeCode(code, kind, value, max, expiresAt, active) {
  db.prepare(
    `INSERT INTO promo_codes (code, kind, value, max_redemptions, expires_at, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(code, kind, value, max === undefined ? null : max, expiresAt || null, active === undefined ? 1 : active, now());
  return promo.findByCode(code);
}

const custId = makeUser('cust@test.com', 'customer', 'Cathy');
const proId = makeUser('pro@test.com', 'pro', 'Pete');
const pro = makePro(proId, 'Pete Plumbing');
const cust = db.prepare('SELECT * FROM users WHERE id = ?').get(custId);
const proUser = db.prepare('SELECT * FROM users WHERE id = ?').get(proId);

// --- 1. commission math ---
eq(commission.rateForTier('free'), 0.10, 'free rate is 10%');
eq(commission.rateForTier('pro'), 0.05, 'pro rate is 5%');
eq(commission.commissionFor(20000, 'free'), 2000, '10% of $200 = $20');
eq(commission.commissionFor(20000, 'pro'), 1000, '5% of $200 = $10');
eq(commission.commissionFor(3000, 'free'), 500, '$5 minimum beats 10% of $30');
eq(commission.commissionFor(0, 'free'), 0, 'no price, no fee');

// --- 2. agreement detection ---
ok(commission.detectAgreement('Tuesday at 2 works for me'), 'detects "Tuesday at 2 works"');
ok(commission.detectAgreement('See you tomorrow at 3pm!'), 'detects "tomorrow at 3pm" + see you');
ok(!commission.detectAgreement('are you free tuesday?'), 'mere day mention is not agreement');
ok(!commission.detectAgreement('let us talk about scheduling sometime'), 'vague scheduling talk is not agreement');
ok(!commission.detectAgreement('the price works for me'), '"works" without day+time is not agreement');

// --- 3. pending commission lifecycle ---
const r1 = makeRequest(custId, pro.id);
db.prepare(
  "INSERT INTO estimates (request_id, pro_id, amount_cents, status, created_at) VALUES (?, ?, 20000, 'accepted', ?)"
).run(r1.id, pro.id, now());
const p1 = commission.maybeCreatePending(r1, 'free');
ok(p1 && p1.status === 'pending', 'pending commission created');
eq(p1.amount_cents, 2000, 'pending amount is 10% of $200');
ok(commission.maybeCreatePending(r1, 'free') === null, 'only one commission per request');
const confirmed = commission.confirmCommission(p1, (pid, cents) => billing.chargeCard(pid, cents, 'test'));
eq(confirmed.status, 'due', 'without Stripe keys the fee is tracked as due, not charged');
const r2 = makeRequest(custId, pro.id);
const p2 = commission.maybeCreatePending(r2, 'pro');
commission.voidCommission(r2.id, 'cancelled in test');
eq(commission.existingCommission(r2.id).status, 'void', 'cancelled job voids the fee');

// --- 4. base amount fallback: invoice total when no estimate ---
const r3 = makeRequest(custId, pro.id);
db.prepare("INSERT INTO invoices (request_id, pro_id, customer_id, status, created_at) VALUES (?, ?, ?, 'sent', ?)")
  .run(r3.id, pro.id, custId, now());
const invId = Number(db.prepare('SELECT id FROM invoices WHERE request_id = ?').get(r3.id).id);
db.prepare('INSERT INTO invoice_items (invoice_id, description, qty, unit_price_cents) VALUES (?, ?, ?, ?)')
  .run(invId, 'Labor', 2, 7500);
eq(commission.baseAmountCents(r3.id), 15000, 'falls back to invoice total ($150)');

// --- 5. promo codes: validation ---
makeCode('GOOD10', 'commission_free', 2, 5, null, 1);
makeCode('OLD', 'pro_trial', 7, 5, new Date(Date.now() - 86400000).toISOString(), 1);
makeCode('USEDUP', 'pro_trial', 7, 1, null, 1);
makeCode('OFF', 'pro_trial', 7, 5, null, 0);
ok(!promo.validate('NOPE', custId).ok, 'unknown code rejected');
eq(promo.validate('OLD', custId).ok, false, 'expired code rejected');
eq(promo.validate('OFF', custId).ok, false, 'inactive code rejected');
// max out USEDUP with another user
const otherId = makeUser('other@test.com', 'customer');
promo.redeem('USEDUP', db.prepare('SELECT * FROM users WHERE id = ?').get(otherId));
eq(promo.validate('USEDUP', custId).ok, false, 'max redemptions enforced');
const first = promo.redeem('GOOD10', proUser);
ok(first.code.code === 'GOOD10', 'valid redemption works');
eq(promo.validate('GOOD10', proId).ok, false, 'same user cannot redeem twice');
eq(promo.waiversForPro(pro.id).length, 1, 'commission_free creates a waiver');
eq(promo.waiversForPro(pro.id)[0].jobs_remaining, 2, 'waiver has 2 jobs');

// --- 6. commission_free waives the fee ---
const r4 = makeRequest(custId, pro.id);
db.prepare("INSERT INTO estimates (request_id, pro_id, amount_cents, status, created_at) VALUES (?, ?, 10000, 'accepted', ?)")
  .run(r4.id, pro.id, now());
const p4 = commission.maybeCreatePending(r4, 'free');
ok(p4 && p4.status === 'pending', 'pending created before waiver check');
ok(commission.applyWaiverIfAvailable(pro.id, p4), 'waiver applied');
const p4f = commission.existingCommission(r4.id);
eq(p4f.status, 'waived', 'waived job skips the fee');
eq(p4f.amount_cents, 0, 'waived fee is $0');
eq(promo.waiversForPro(pro.id)[0].jobs_remaining, 1, 'waiver decremented');

// --- 7. partner code: lifetime Pro + 0% forever ---
const partnerProId = makeUser('partner@test.com', 'pro', 'Polly');
const partnerPro = makePro(partnerProId, 'Polly Parties');
const partnerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(partnerProId);
makeCode('PARTNER1', 'partner', 0, null, null, 1); // unlimited, never expires
const pr = promo.redeem('PARTNER1', partnerUser);
ok(pr.effect.indexOf('Partner') === 0, 'partner redemption effect is clear');
const partnerFresh = db.prepare('SELECT * FROM pro_profiles WHERE id = ?').get(partnerPro.id);
eq(billing.getTier(partnerFresh), 'pro', 'partner code grants Pro tier');
eq(partnerFresh.is_partner, 1, 'partner flag set');
const r5 = makeRequest(custId, partnerPro.id);
db.prepare("INSERT INTO estimates (request_id, pro_id, amount_cents, status, created_at) VALUES (?, ?, 50000, 'accepted', ?)")
  .run(r5.id, partnerPro.id, now());
const p5 = commission.maybeCreatePending(r5, 'pro');
eq(p5.status, 'waived', 'partner job skips commission entirely');
eq(p5.amount_cents, 0, 'partner commission is $0');
eq(commission.statusWords(p5), 'Partner — 0% commission', 'history shows "partner"');
eq(promo.validate('PARTNER1', proId).ok, true, 'unlimited partner code still works for others');
// regular codes unaffected by partner logic
eq(commission.statusWords(p4f), 'Waived (promo code)', 'regular waivers still show promo wording');

// --- 8. pro_trial grants Pro without $39 ---
makeCode('TRIAL7', 'pro_trial', 7, null, null, 1);
const trialProId = makeUser('trial@test.com', 'pro', 'Tina');
makePro(trialProId, 'Tina Tint');
const trialUser = db.prepare('SELECT * FROM users WHERE id = ?').get(trialProId);
promo.redeem('TRIAL7', trialUser);
const trialPro = db.prepare('SELECT * FROM pro_profiles WHERE user_id = ?').get(trialProId);
eq(billing.getTier(trialPro), 'pro', 'trial grants Pro tier');
ok(billing.trialDaysLeft(trialPro) >= 6, 'trial has ~7 days left');

// --- 9. customer credit ---
makeCode('CREDIT10', 'customer_credit', 1000, null, null, 1);
promo.redeem('CREDIT10', cust);
eq(promo.creditForCustomer(custId), 1000, 'customer gets $10 credit recorded');

// --- 10. reviews: only after done, one per job ---
const r6 = makeRequest(custId, pro.id, 'completed');
ok(reviews.canReview(r6.id, custId).ok, 'can review a completed job');
const r7 = makeRequest(custId, pro.id, 'booked');
ok(!reviews.canReview(r7.id, custId).ok, 'cannot review before the job is done');
const rv = reviews.addReview(r6.id, pro.id, custId, 5, 'Great work!');
eq(rv.rating, 5, 'review saved with 5 stars');
ok(!reviews.canReview(r6.id, custId).ok, 'one review per job');
const r8 = makeRequest(custId, pro.id, 'completed');
reviews.addReview(r8.id, pro.id, custId, 3, 'Okay.');
const summary = reviews.ratingSummary(pro.id);
eq(summary.count, 2, 'two reviews counted');
eq(summary.average, 4, 'average is 4 stars');
eq(reviews.starsText(4), '★★★★☆', 'stars render correctly');

// --- 11. card on file + billing honesty ---
ok(!billing.hasCardOnFile(999999), 'no card on file initially');
billing.saveDemoCard(pro.id);
ok(billing.hasCardOnFile(pro.id), 'demo card counts as on file');
eq(billing.cardOnFile(pro.id).is_demo, 1, 'demo card is honestly labeled');
eq(billing.stripeConfigured(), false, 'Stripe not configured without key');
const ch = billing.chargeCard(pro.id, 2000, 'test');
eq(ch.charged, false, 'no real charge without Stripe');
ok(ch.note.indexOf('STRIPE_SECRET_KEY') !== -1, 'charge failure says what is missing');

// --- 12. notifications ---
const nid = notify.notify(custId, 'request_new', 'Test title', 'Test body', '/x');
ok(nid > 0, 'notification created');
eq(notify.unreadCount(custId), 1, 'one unread notification');
notify.markAllRead(custId);
eq(notify.unreadCount(custId), 0, 'mark all read works');
ok(!require('../lib/email').senderConfigured(), 'no email sender configured in test env');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
