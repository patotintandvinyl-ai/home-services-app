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
| `STRIPE_SECRET_KEY` | no | Enables real card charging. Without it, commissions are tracked as "due" ledger entries and cards saved are clearly-labeled DEMO cards that can never charge anyone |
| `STRIPE_PUBLISHABLE_KEY` | no | Reserved for the future checkout front end |
| `ADMIN_EMAIL` | no | Email of the site owner — unlocks the promo-code admin page at `/admin/promos` |
| `RESEND_API_KEY` | no | Send notification emails via Resend. Until set, in-app bell notifications are the working channel (the app says so in the UI) |
| `EMAIL_WEBHOOK_URL` | no | Alternative: POST `{to, subject, text}` JSON to your own endpoint for emails |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | no | SMS sender — stubbed interface for later (`lib/sms.js`) |

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

- Commissions: free pros pay 10% per booked job, Pro pros pay 5% ($5 minimum). The fee
  triggers only when both sides agree on a day and time in chat, and the pro must
  always press confirm — nothing is ever charged silently. Cancelled jobs void the fee.
- Reviews: customers can leave 1–5 stars after a job is done (one per job); averages
  show on pro profiles, search, and category pages.
- Notifications: in-app bell for requests, messages, prices, bookings, fees, reviews.
  Email works when `RESEND_API_KEY` or `EMAIL_WEBHOOK_URL` is set; SMS is stubbed.
- Promo codes (`/admin/promos`, owner only via `ADMIN_EMAIL`): free Pro days, no-fee
  jobs, customer credit, and partner codes (lifetime Pro + 0% commission forever).
- Tests: `npm test` runs 58 assertions against a throwaway database.
- Uploaded photos live in `data/uploads/` (gitignored) and are served at `/uploads/<filename>`.
- SQLite file: `data/marketplace.db` (created on boot from `db/schema.sql`).
