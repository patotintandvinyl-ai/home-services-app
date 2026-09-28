'use strict';
// Promo codes, made by the site owner on the admin page.
//
// Kinds:
//   pro_trial       — value = days of free Pro
//   commission_free — value = number of booked jobs at 0% commission
//   customer_credit — value = cents of account credit (display only for now)
//   partner         — lifetime Pro + 0% commission forever (for the owner's partner)
//
// Rules: code must exist, be active, not be expired, and have redemptions
// left (max_redemptions NULL = unlimited). One use per person per code.
const { db, now } = require('../db');

const KINDS = {
  pro_trial: 'Free Pro days',
  commission_free: 'Jobs with no fee',
  customer_credit: 'Account credit',
  partner: 'Partner (lifetime Pro, no fees)'
};

function kindWords(kind) {
  return KINDS[kind] || kind;
}

function normalizeCode(raw) {
  return (raw || '').trim().toUpperCase();
}

function findByCode(raw) {
  const code = normalizeCode(raw);
  if (!code) return null;
  return db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) || null;
}

// Returns { ok, code } or { ok:false, reason } where reason is a
// plain-language message safe to show the user.
function validate(raw, userId) {
  const code = findByCode(raw);
  if (!code) return { ok: false, reason: 'That code does not exist. Check the spelling.' };
  if (!code.active) return { ok: false, reason: 'That code is turned off.' };
  if (code.expires_at && code.expires_at < now()) {
    return { ok: false, reason: 'That code has expired.' };
  }
  if (code.max_redemptions !== null && code.redeemed_count >= code.max_redemptions) {
    return { ok: false, reason: 'That code has already been used up.' };
  }
  if (userId) {
    const used = db.prepare(
      'SELECT id FROM promo_redemptions WHERE code_id = ? AND user_id = ?'
    ).get(code.id, userId);
    if (used) return { ok: false, reason: 'You have already used that code.' };
  }
  return { ok: true, code };
}

// Applies the code's effect. Throws on invalid.
function redeem(raw, user) {
  const v = validate(raw, user.id);
  if (!v.ok) throw new Error(v.reason);
  const code = v.code;

  const rInfo = db.prepare(
    'INSERT INTO promo_redemptions (code_id, user_id, redeemed_at) VALUES (?, ?, ?)'
  ).run(code.id, user.id, now());
  const redemptionId = Number(rInfo.lastInsertRowid);
  db.prepare('UPDATE promo_codes SET redeemed_count = redeemed_count + 1 WHERE id = ?').run(code.id);

  let effect = '';
  if (user.role === 'pro') {
    const pro = db.prepare('SELECT * FROM pro_profiles WHERE user_id = ?').get(user.id);
    if (code.kind === 'pro_trial' && pro) {
      const days = Math.max(1, code.value || 7);
      const ends = new Date(Date.now() + days * 86400000).toISOString();
      db.prepare('UPDATE pro_profiles SET trial_ends_at = ? WHERE id = ?').run(ends, pro.id);
      effect = days + ' days of Pro, free.';
    } else if (code.kind === 'commission_free' && pro) {
      const jobs = Math.max(1, code.value || 1);
      db.prepare(
        'INSERT INTO promo_waivers (redemption_id, pro_id, jobs_remaining) VALUES (?, ?, ?)'
      ).run(redemptionId, pro.id, jobs);
      effect = jobs + ' booked job(s) with no fee.';
    } else if (code.kind === 'partner' && pro) {
      // Lifetime Pro, 0% commission forever.
      db.prepare("UPDATE pro_profiles SET tier = 'pro', is_partner = 1 WHERE id = ?").run(pro.id);
      effect = 'Partner access: Pro forever, no fees on any job.';
    }
  }
  if (user.role === 'customer' && code.kind === 'customer_credit') {
    const cents = Math.max(0, code.value || 0);
    db.prepare(
      `INSERT INTO customer_credits (customer_id, amount_cents, remaining_cents, source_code_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(user.id, cents, cents, code.id, now());
    effect = '$' + (cents / 100).toFixed(2) + ' of account credit.';
  }
  return { code, effect };
}

function redemptionsFor(codeId) {
  return db.prepare(
    `SELECT r.*, u.name AS user_name, u.email AS user_email FROM promo_redemptions r
     JOIN users u ON u.id = r.user_id
     WHERE r.code_id = ? ORDER BY r.redeemed_at DESC`
  ).all(codeId);
}

function allCodes() {
  return db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC, id DESC').all();
}

function waiversForPro(proId) {
  return db.prepare('SELECT * FROM promo_waivers WHERE pro_id = ?').all(proId);
}

function creditForCustomer(customerId) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(remaining_cents), 0) AS total FROM customer_credits WHERE customer_id = ?'
  ).get(customerId);
  return row ? row.total : 0;
}

function isPartner(proProfile) {
  return !!(proProfile && proProfile.is_partner);
}

module.exports = {
  KINDS,
  kindWords,
  normalizeCode,
  findByCode,
  validate,
  redeem,
  redemptionsFor,
  allCodes,
  waiversForPro,
  creditForCustomer,
  isPartner
};
