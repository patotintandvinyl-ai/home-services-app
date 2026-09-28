'use strict';
// npm run seed — inserts demo rows with is_seed=1.
// Seed users (password for all: demo1234):
//   customer: maria@example.com (Maria Lopez)
//   pros: pato@example.com, jumpzone@example.com, marta@example.com, sparkle@example.com
// Safe to re-run: existing seed rows are reused, not duplicated.
const { db, now } = require('../db');
const { hash } = require('../lib/auth');

const PASSWORD = 'demo1234';

function upsertUser(email, name, role, phone) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, role, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(email, hash(PASSWORD), role, name, phone || '', now());
  return Number(info.lastInsertRowid);
}

function upsertProProfile(userId, businessName, bio, serviceArea, years) {
  const existing = db.prepare('SELECT id FROM pro_profiles WHERE user_id = ?').get(userId);
  if (existing) return existing.id;
  const info = db.prepare(
    `INSERT INTO pro_profiles
       (user_id, business_name, bio, service_area, years_experience, tier, is_seed, created_at)
     VALUES (?, ?, ?, ?, ?, 'free', 1, ?)`
  ).run(userId, businessName, bio, serviceArea, years, now());
  return Number(info.lastInsertRowid);
}

function seedService(proId, categoryId, title, priceHint) {
  const existing = db.prepare(
    'SELECT id FROM services WHERE pro_id = ? AND title = ? AND is_seed = 1'
  ).get(proId, title);
  if (existing) return existing.id;
  const info = db.prepare(
    `INSERT INTO services
       (pro_id, category_id, title, description, price_hint, is_seed, created_at)
     VALUES (?, ?, ?, '', ?, 1, ?)`
  ).run(proId, categoryId, title, priceHint, now());
  return Number(info.lastInsertRowid);
}

const seedPros = [
  {
    email: 'pato@example.com', name: 'Pato', phone: '',
    business_name: 'Pato Tint & Vinyl',
    bio: 'We come to you. Clean tint, no mess, done the same day.',
    service_area: 'San Diego and nearby', years: 5,
    services: [
      { category_id: 8, title: 'Full car window tint', price_hint: '$199 from' },
      { category_id: 8, title: 'Tesla full tint', price_hint: '$249 from' }
    ]
  },
  {
    email: 'jumpzone@example.com', name: 'Jump Zone', phone: '',
    business_name: 'Jump Zone Party Rentals',
    bio: 'Fun, safe bounce houses and water slides for kids parties. We set up and take down.',
    service_area: 'San Diego County', years: 4,
    services: [
      { category_id: 17, title: 'Bounce house for a day', price_hint: '$149 from' },
      { category_id: 17, title: 'Water slide rental', price_hint: '$199 from' }
    ]
  },
  {
    email: 'marta@example.com', name: 'Marta', phone: '',
    business_name: "Marta's Mobile Bar",
    bio: 'Friendly bartender for your party. I bring the bar tools and the good vibes.',
    service_area: 'San Diego', years: 6,
    services: [
      { category_id: 16, title: 'Bartender for 4 hours', price_hint: '$300 from' }
    ]
  },
  {
    email: 'sparkle@example.com', name: 'Sparkle', phone: '',
    business_name: 'Sparkle Home Cleaning',
    bio: 'Careful, thorough home cleaning. We bring our own supplies.',
    service_area: 'San Diego', years: 3,
    services: [
      { category_id: 1, title: 'Whole home clean', price_hint: '$129 from' }
    ]
  }
];

console.log('Seeding demo data...');
const proIds = {};
seedPros.forEach((p) => {
  const userId = upsertUser(p.email, p.name, 'pro', p.phone);
  const proId = upsertProProfile(userId, p.business_name, p.bio, p.service_area, p.years);
  proIds[p.email] = proId;
  p.services.forEach((s) => seedService(proId, s.category_id, s.title, s.price_hint));
  // Demo card on file so seed pros can receive requests (clearly demo-only).
  const billing = require('../lib/billing');
  billing.saveDemoCard(proId);
  console.log('  pro: ' + p.business_name + ' (' + p.email + ')');
});

const mariaId = upsertUser('maria@example.com', 'Maria Lopez', 'customer', '');
console.log('  customer: Maria Lopez (maria@example.com)');

// One seed request: Maria -> Pato Tint, automotive/tint, "Tint my Honda Civic".
const patoId = proIds['pato@example.com'];
const existingRequest = db.prepare('SELECT id FROM requests WHERE is_seed = 1 LIMIT 1').get();
if (!existingRequest) {
  const patoService = db.prepare(
    'SELECT id FROM services WHERE pro_id = ? AND is_seed = 1 ORDER BY id LIMIT 1'
  ).get(patoId);
  db.prepare(
    `INSERT INTO requests
       (customer_id, pro_id, service_id, category_id, title, description, preferred_date, status, is_seed, created_at)
     VALUES (?, ?, ?, 8, 'Tint my Honda Civic', 'Please tint all the windows on my Honda Civic. It is parked at my home in San Diego.', '', 'new', 1, ?)`
  ).run(mariaId, patoId, patoService ? patoService.id : null, now());
  console.log('  request: "Tint my Honda Civic" (Maria -> Pato Tint)');
} else {
  console.log('  request: already seeded, skipping');
}

console.log('Done. All seed users use password: ' + PASSWORD);
