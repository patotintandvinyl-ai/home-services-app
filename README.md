# Home Services App (MVP backend)

Two-sided local services marketplace. Server-rendered Express app, SQLite, plain-language UI.

## Run it

```bash
npm install
npm start                 # PORT=3000 by default
```

Open http://localhost:3000.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `PORT` | no (default 3000) | Port the server listens on |
| `SESSION_SECRET` | yes in production | Secret for signing session cookies. The app runs without it but prints a warning — set a long random string on any public deploy |
| `DATA_DIR` | no (default `./data`) | Where `marketplace.db` and `uploads/` live. Point this at your persistent disk mount on hosted deploys |
| `STRIPE_SECRET_KEY` | no | Billing is a stub in the MVP. If set, `lib/billing.js` exposes Stripe-shaped integration points; nothing charges without a full checkout build-out |
| `STRIPE_PUBLISHABLE_KEY` | no | Same as above — reserved for the future checkout front end |

## Deploy (Render or Railway)

The app is a single Node service with a SQLite file — no external database needed.

1. Push this folder to a Git repo and create a new **Web Service** (Render) or
   **Service from repo** (Railway). Build command: `npm install`. Start command: `npm start`.
2. Add a **persistent disk / volume** and mount it at the app's `data/` directory
   (or any path — then set `DATA_DIR` to that mount path). Without this, the
   database and uploaded photos are wiped on every redeploy/restart.
3. Set env vars: `SESSION_SECRET` (long random string), `PORT` if your host
   requires a specific one (Render injects `PORT` automatically).
4. Open the service URL. Run `npm run seed` once from the host's shell if you
   want the demo listings; skip it for a clean production database.

## Demo data

```bash
npm run seed     # inserts demo pros, a customer, and one job request
npm run unseed   # removes everything the seed created
```

Seed users — password for **all** of them is `demo1234`:

| Email | Role | Who |
|---|---|---|
| maria@example.com | customer | Maria Lopez |
| pato@example.com | pro | Pato Tint & Vinyl |
| jumpzone@example.com | pro | Jump Zone Party Rentals |
| marta@example.com | pro | Marta's Mobile Bar |
| sparkle@example.com | pro | Sparkle Home Cleaning |

## Notes

- Billing is a stub (`lib/billing.js`). Booking a day/time and sending bills need the
  $39/month Pro plan; there is no real checkout and no real payments, ever, in the MVP.
- Uploaded photos live in `data/uploads/` (gitignored) and are served at `/uploads/<filename>`.
- SQLite file: `data/marketplace.db` (created on boot from `db/schema.sql`).
