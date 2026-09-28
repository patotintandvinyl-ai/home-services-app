'use strict';
// Billing tiers + Stripe-shaped stub. MVP NEVER processes real payments.
const TIER_FREE = 'free';
const TIER_PRO = 'pro';

function getTier(proProfile) {
  return proProfile && proProfile.tier === TIER_PRO ? TIER_PRO : TIER_FREE;
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

// Stripe-shaped stub: throws unless STRIPE_SECRET_KEY is set.
// Even when set, this is a stub — no real checkout is created in the MVP.
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
  canUse,
  planName,
  planPrice,
  stripeCheckoutStub
};
