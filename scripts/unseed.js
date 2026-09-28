'use strict';
// npm run unseed — removes everything npm run seed created:
// all rows with is_seed=1 plus dependent rows (requests/estimates/messages/
// bookings/invoices/items tied to seed requests, seed services, seed pro
// photos, seed pro_profiles, and the seed users themselves).
const { db } = require('../db');

console.log('Removing seed data...');

// 1. Dependents of seed requests.
const seedRequestIds = db.prepare('SELECT id FROM requests WHERE is_seed = 1').all().map((r) => r.id);
if (seedRequestIds.length) {
  const list = seedRequestIds.join(',');
  db.exec('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE request_id IN (' + list + '))');
  db.exec('DELETE FROM invoices WHERE request_id IN (' + list + ')');
  db.exec('DELETE FROM bookings WHERE request_id IN (' + list + ')');
  db.exec('DELETE FROM estimates WHERE request_id IN (' + list + ')');
  db.exec('DELETE FROM messages WHERE request_id IN (' + list + ')');
  db.exec('DELETE FROM requests WHERE is_seed = 1');
  console.log('  removed ' + seedRequestIds.length + ' seed request(s) and their messages/estimates/bookings/invoices');
}

// 2. Seed services + photos of seed pros.
const seedProIds = db.prepare('SELECT id FROM pro_profiles WHERE is_seed = 1').all().map((r) => r.id);
if (seedProIds.length) {
  const list = seedProIds.join(',');
  const nSvc = db.prepare('SELECT COUNT(*) AS n FROM services WHERE is_seed = 1').get().n;
  db.exec('DELETE FROM services WHERE is_seed = 1');
  const nPhotos = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE pro_id IN (' + list + ')').get().n;
  db.exec('DELETE FROM photos WHERE pro_id IN (' + list + ')');
  console.log('  removed ' + nSvc + ' seed service(s), ' + nPhotos + ' seed photo(s)');
}

// 3. Seed pro_profiles and their users.
const seedUserIds = db.prepare('SELECT user_id FROM pro_profiles WHERE is_seed = 1').all().map((r) => r.user_id);
if (seedUserIds.length) {
  db.exec('DELETE FROM pro_profiles WHERE is_seed = 1');
  const list = seedUserIds.join(',');
  db.exec('DELETE FROM users WHERE id IN (' + list + ')');
  console.log('  removed ' + seedUserIds.length + ' seed pro user(s)');
}

// 4. Seed customer (maria@example.com).
const del = db.prepare("DELETE FROM users WHERE email = 'maria@example.com'").run();
if (del.changes) console.log('  removed seed customer maria@example.com');

console.log('Done.');
