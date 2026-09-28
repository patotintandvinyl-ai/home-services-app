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
