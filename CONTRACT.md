# CONTRACT.md — Data model & route contract for Home Services App (MVP)

Owner: coordinator. Every builder MUST read this file first and build exactly to it.
Do not invent new tables, routes, or field names without coordinator approval.

## Stack
- Node 18+ + Express 4 + better-sqlite3 + bcryptjs + express-session + multer + ejs
- Single service. SQLite file at `data/marketplace.db` (relative to project root).
  Schema is created on boot from `db/schema.sql` (idempotent: CREATE TABLE IF NOT EXISTS).
- Sessions: express-session, signed cookie, secret from `SESSION_SECRET` env (dev fallback allowed with console warning).
- Passwords: bcryptjs, 10 rounds.
- Photos: multer disk storage to `data/uploads/`, max 5 MB per file, image mime types only (jpeg/png/webp/gif).
- No external API keys. Billing is a stub module `lib/billing.js` (Stripe-shaped functions, inactive without env keys).

## Plain-language rule
All user-facing copy must be simple enough for a 5-year-old to understand.
Use these exact labels where applicable:
- Job request = "What do you need done?"
- Estimate = "Make a price"
- Booking = "Pick a day and time"
- Invoice = "Your bill"
- Request inbox for pros = "New jobs"

## Data model (SQLite)

```sql
users(id INTEGER PK, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('customer','pro')),
      name TEXT NOT NULL, phone TEXT DEFAULT '', created_at TEXT NOT NULL)

pro_profiles(id INTEGER PK, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      business_name TEXT NOT NULL, bio TEXT DEFAULT '',
      service_area TEXT DEFAULT '', years_experience INTEGER DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'free' CHECK(tier IN ('free','pro')),
      is_seed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)

categories(id INTEGER PK, name TEXT NOT NULL, plain_description TEXT NOT NULL,
      icon TEXT DEFAULT '', sort_order INTEGER DEFAULT 0)

services(id INTEGER PK, pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      title TEXT NOT NULL, description TEXT DEFAULT '',
      price_hint TEXT DEFAULT '', is_seed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL)

photos(id INTEGER PK, pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
      filename TEXT NOT NULL, caption TEXT DEFAULT '', created_at TEXT NOT NULL)

requests(id INTEGER PK, customer_id INTEGER NOT NULL REFERENCES users(id),
      pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
      service_id INTEGER REFERENCES services(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      title TEXT NOT NULL, description TEXT NOT NULL,
      preferred_date TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new','estimate_sent','accepted','declined','booked','completed','cancelled')),
      is_seed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)

estimates(id INTEGER PK, request_id INTEGER NOT NULL REFERENCES requests(id),
      pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
      amount_cents INTEGER NOT NULL, notes TEXT DEFAULT '',
      valid_days INTEGER DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','accepted','declined')),
      created_at TEXT NOT NULL)

messages(id INTEGER PK, request_id INTEGER NOT NULL REFERENCES requests(id),
      sender_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL, created_at TEXT NOT NULL)

bookings(id INTEGER PK, request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),
      pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      scheduled_at TEXT NOT NULL, notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK(status IN ('scheduled','done','cancelled')),
      created_at TEXT NOT NULL)

invoices(id INTEGER PK, request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id),
      pro_id INTEGER NOT NULL REFERENCES pro_profiles(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid')),
      created_at TEXT NOT NULL)

invoice_items(id INTEGER PK, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      description TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
      unit_price_cents INTEGER NOT NULL)
```

Timestamps: ISO strings (`new Date().toISOString()`).

## Access rules
- Only the request's customer or the request's pro (via their user_id) may view/post to a request thread.
- Only the owning pro may estimate/accept/decline/book/invoice on their requests.
- Only the customer may accept/decline an estimate on their requests.
- Pro-only gates: booking creation and invoice creation require `tier='pro'`.
  Free-tier pros hitting those routes see an upgrade nudge page naming the **$39/month Pro plan** (no checkout, no real billing).

## Routes (server-rendered, form POSTs; PRG pattern — POST then redirect)

Public:
- `GET /` — home: category grid + a few featured pros (seed pros fine).
- `GET /c/:id` — category page: pros offering services in this category.
- `GET /pro/:id` — public pro profile: business info, services, photos, area, years.
- `GET /signup` `POST /signup` — fields: name, email, password, role (customer|pro), phone (optional). Pro signup also asks business_name. Creates user (+ pro_profile when role=pro). Logs in immediately, redirect to /dashboard.
- `GET /login` `POST /login` — email + password.
- `POST /logout`

Shared (logged in):
- `GET /dashboard` — role-aware: customer sees "My jobs", pro sees "New jobs" inbox summary + tier badge.
- `GET /requests/:id` — job thread (messages + estimates + booking + invoice summary), visible only to the two parties.
- `POST /requests/:id/message` — fields: body.

Customer:
- `GET /request/new?pro=<proId>&service=<serviceId?>` — form: category (preselected), title, description ("Tell us in your own words"), preferred_date (optional text/date).
- `POST /request` — creates request (status=new), redirect to thread.
- `GET /customer/requests` — my jobs list.
- `POST /requests/:id/estimates/:eid/accept` and `/decline` — customer accepts/declines; accept sets request status=accepted.

Pro:
- `GET /pro/profile/edit` `POST /pro/profile` — business_name, bio, service_area, years_experience.
- `GET /pro/services` `POST /pro/services` — add service: category_id, title, description, price_hint. List with delete: `POST /pro/services/:id/delete`.
- `POST /pro/photos` — multipart photo upload (field name `photo`), optional caption. `POST /pro/photos/:id/delete`.
- `GET /pro/inbox` — incoming requests (newest first), each linking to thread.
- `POST /requests/:id/estimate` — "Make a price": amount (dollars, converted to cents), notes, valid_days. Sets request status=estimate_sent. Prefill amount from service price_hint when possible.
- `POST /requests/:id/decline` — pro declines (status=declined).
- `POST /requests/:id/book` — PRO TIER ONLY: scheduled_at (datetime-local), notes. Sets request status=booked. Free tier → upgrade nudge page.
- `GET /pro/invoices/:id` — "Your bill" printable view.
- `POST /requests/:id/invoice` — PRO TIER ONLY: creates invoice with line items from form arrays (description[], qty[], unit_price[] dollars). Free tier → upgrade nudge page. Invoice starts as draft; `POST /pro/invoices/:id/send` marks sent; `POST /pro/invoices/:id/paid` marks paid (pro marks manually — cash/check reality for MVP).

Billing stub:
- `GET /billing` — shows current tier; Free users see the $39/month Pro plan pitch. `lib/billing.js` exports `getTier()`, `canUse(feature, tier)`, `stripeCheckoutStub()` (throws/not-configured unless STRIPE_SECRET_KEY set). No real charging, ever, in MVP.

Seed:
- `npm run seed` inserts demo rows with `is_seed=1` and creates seed users with known passwords (documented in README). `npm run unseed` deletes all rows with `is_seed=1` plus their dependent rows (requests/estimates/messages/bookings/invoices/items tied to seed requests).
- Seed users: 1 customer (maria@example.com) + 4 pros. Passwords: `demo1234` for all seed users.

## Seed content (exact)
1. **Pato Tint & Vinyl** — pro user: pato@example.com — Automotive / Window Tint & Wraps. Services: "Full car window tint" ($199 from), "Tesla full tint" ($249 from). Area: "San Diego and nearby". Bio: "We come to you. Clean tint, no mess, done the same day."
2. **Jump Zone Party Rentals** — pro user: jumpzone@example.com — Bounce Houses & Kids Parties. Services: "Bounce house for a day" ($149 from), "Water slide rental" ($199 from). Area: "San Diego County".
3. **Marta's Mobile Bar** — pro user: marta@example.com — Bartending. Services: "Bartender for 4 hours" ($300 from). Area: "San Diego".
4. **Sparkle Home Cleaning** — pro user: sparkle@example.com — Home Cleaning. Services: "Whole home clean" ($129 from). Area: "San Diego".
5. Customer: maria@example.com — "Maria Lopez".
6. One seed request: Maria → Pato Tint, category automotive/tint, "Tint my Honda Civic", status=new.

## Categories (id fixed for seed stability)
1 Home Cleaning — "Someone to clean your home" 🧹
2 Handyman & Repairs — "Someone to fix things around the house" 🔧
3 Plumbing — "Someone to fix sinks, toilets, and pipes" 🚰
4 Electrical — "Someone to fix lights and outlets" 💡
5 Lawn & Yard — "Someone to cut grass and clean the yard" 🌱
6 Painting — "Someone to paint walls and rooms" 🎨
7 Automotive — "Someone to work on your car" 🚗
8 Window Tint & Wraps — "Someone to tint windows or wrap your car" 🪟
9 Beauty — "Hair, nails, and makeup at your home" 💅
10 Pets — "Someone to care for your pets" 🐾
11 Lessons — "Someone to teach you something new" 📚
12 Tech Repair — "Someone to fix your phone or computer" 📱
13 Business Help — "Someone to help with your business" 💼
14 Wellness — "Massage and feel-good services at home" 💆
15 Events — "Help for parties and big days" 🎉
16 Bartending — "Someone to pour drinks at your party" 🍹
17 Bounce Houses & Kids Parties — "Big blow-up fun for kids parties" 🏰
18 DJs & Music — "Music for your party" 🎧
19 Characters & Entertainers — "Princesses, superheroes, and clowns" 🦸
20 Party Setup & Decor — "Someone to set up and decorate" 🎈

## Frontend contract
- Views in `views/` (EJS). One layout `views/layout.ejs` with header/nav (shows Log in / Sign up or Dashboard + Log out), footer.
- Single stylesheet `public/style.css`: purple (#5b2d8e-ish) and gold (#d4a017-ish), mobile-first responsive, big touch targets, plain-language labels.
- Photo display via `/uploads/<filename>` static route.
- All forms show simple error text on failure. No JS framework required; tiny vanilla JS only if needed.

## Project layout
```
marketplace-app/
  CONTRACT.md  (this file)
  package.json (scripts: start, seed, unseed, dev)
  README.md
  ARCHITECTURE.md
  server.js        — express app wiring
  db/
    schema.sql
    index.js       — better-sqlite3 singleton + helpers
  lib/
    auth.js        — bcrypt + session helpers + requireLogin/requireRole middleware
    billing.js     — tier flags + Stripe-shaped stub
  routes/
    public.js      — /, /c/:id, /pro/:id, /uploads static in server.js
    auth.js        — signup/login/logout
    customer.js
    pro.js
    requests.js    — shared thread + messages + estimate accept/decline
  views/  (*.ejs)
  public/style.css
  data/            — gitignored: marketplace.db, uploads/
  scripts/seed.js  — npm run seed
  scripts/unseed.js— npm run unseed
```

## Test contract (for the tester)
Scripted HTTP pass with curl + cookie jars must cover:
1. Signup customer (maria2@example.com) + login.
2. Signup pro (tier free) + add profile + add service + upload photo (small png).
3. Customer sends request to pro → pro sees it in inbox.
4. Pro "Make a price" (estimate) → customer sees it → customer accepts.
5. Thread messages both directions.
6. Free-tier pro tries to book → gets upgrade nudge (HTTP 200 page mentioning $39).
7. Free-tier pro tries to invoice → gets upgrade nudge.
8. Tier flip to pro in DB → book + invoice succeed → invoice view shows line items + total.
9. Public pages render: /, /c/8, /pro/:id.
10. Seed run → seeded pages show demo pros; unseed removes them.
Every step asserts on HTTP status and a distinctive string in the body.
