-- Home Services App MVP schema.
-- Idempotent: CREATE TABLE IF NOT EXISTS. Run on boot from db/index.js.

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','pro')),
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pro_profiles(
  id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  business_name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  service_area TEXT DEFAULT '',
  years_experience INTEGER DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'free' CHECK(tier IN ('free','pro')),
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  plain_description TEXT NOT NULL,
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_hint TEXT DEFAULT '',
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos(
  id INTEGER PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  filename TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  service_id INTEGER REFERENCES services(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  preferred_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','estimate_sent','accepted','declined','booked','completed','cancelled')),
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estimates(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  amount_cents INTEGER NOT NULL,
  notes TEXT DEFAULT '',
  valid_days INTEGER DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','accepted','declined')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY,
  request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  scheduled_at TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled','done','cancelled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices(
  id INTEGER PRIMARY KEY,
  request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items(
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL
);

-- Fixed category ids (seed stability). Plain-language descriptions per contract.
INSERT OR IGNORE INTO categories (id, name, plain_description, icon, sort_order) VALUES
(1, 'Home Cleaning', 'Someone to clean your home', '🧹', 1),
(2, 'Handyman & Repairs', 'Someone to fix things around the house', '🔧', 2),
(3, 'Plumbing', 'Someone to fix sinks, toilets, and pipes', '🚰', 3),
(4, 'Electrical', 'Someone to fix lights and outlets', '💡', 4),
(5, 'Lawn & Yard', 'Someone to cut grass and clean the yard', '🌱', 5),
(6, 'Painting', 'Someone to paint walls and rooms', '🎨', 6),
(7, 'Automotive', 'Someone to work on your car', '🚗', 7),
(8, 'Window Tint & Wraps', 'Someone to tint windows or wrap your car', '🪟', 8),
(9, 'Beauty', 'Hair, nails, and makeup at your home', '💅', 9),
(10, 'Pets', 'Someone to care for your pets', '🐾', 10),
(11, 'Lessons', 'Someone to teach you something new', '📚', 11),
(12, 'Tech Repair', 'Someone to fix your phone or computer', '📱', 12),
(13, 'Business Help', 'Someone to help with your business', '💼', 13),
(14, 'Wellness', 'Massage and feel-good services at home', '💆', 14),
(15, 'Events', 'Help for parties and big days', '🎉', 15),
(16, 'Bartending', 'Someone to pour drinks at your party', '🍹', 16),
(17, 'Bounce Houses & Kids Parties', 'Big blow-up fun for kids parties', '🏰', 17),
(18, 'DJs & Music', 'Music for your party', '🎧', 18),
(19, 'Characters & Entertainers', 'Princesses, superheroes, and clowns', '🦸', 19),
(20, 'Party Setup & Decor', 'Someone to set up and decorate', '🎈', 20);

-- === Feature upgrade 2026-09-28: commissions, reviews, notifications, promo codes ===
-- All idempotent (IF NOT EXISTS). Plain-language comments throughout.

-- Money the pro owes the site for a booked job. Never charged silently:
-- status 'pending' waits for the pro to press confirm.
CREATE TABLE IF NOT EXISTS commissions(
  id INTEGER PRIMARY KEY,
  request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  base_amount_cents INTEGER NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0.10,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','due','charged','waived','void')),
  waived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  note TEXT DEFAULT ''
);

-- Cards on file (Stripe-shaped). Real card details NEVER stored here —
-- only Stripe's ids. is_demo=1 means the owner has not connected Stripe yet.
CREATE TABLE IF NOT EXISTS pro_payment_methods(
  id INTEGER PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  stripe_customer_id TEXT DEFAULT '',
  stripe_payment_method_id TEXT DEFAULT '',
  brand TEXT DEFAULT '',
  last4 TEXT DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- In-app notifications (the bell icon). Email/SMS try their best too.
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL
);

-- One review per finished job. Pros can read them, never change them.
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY,
  request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  text TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

-- Promo codes made by the site owner.
-- kind: 'pro_trial' (value = free Pro days), 'commission_free' (value = jobs at 0%),
--       'customer_credit' (value = cents of credit), 'partner' (lifetime Pro + 0% commission).
-- max_redemptions NULL = unlimited. expires_at NULL = never expires.
CREATE TABLE IF NOT EXISTS promo_codes(
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pro_trial','commission_free','customer_credit','partner')),
  value INTEGER NOT NULL DEFAULT 0,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Who used which code. One use per person per code.
CREATE TABLE IF NOT EXISTS promo_redemptions(
  id INTEGER PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES promo_codes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  redeemed_at TEXT NOT NULL,
  UNIQUE(code_id, user_id)
);

-- Remaining 0%-commission jobs from a 'commission_free' code.
CREATE TABLE IF NOT EXISTS promo_waivers(
  id INTEGER PRIMARY KEY,
  redemption_id INTEGER UNIQUE NOT NULL REFERENCES promo_redemptions(id),
  pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
  jobs_remaining INTEGER NOT NULL DEFAULT 0
);

-- Customer account credit from a 'customer_credit' code (display only for now).
CREATE TABLE IF NOT EXISTS customer_credits(
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  remaining_cents INTEGER NOT NULL,
  source_code_id INTEGER REFERENCES promo_codes(id),
  created_at TEXT NOT NULL
);
