# ARCHITECTURE.md — backend overview

## Request flow

```
browser -> server.js (sessions, static, views, dashboard, billing)
          -> routes/auth.js      /signup /login /logout
          -> routes/pro.js       /pro/* (profile, services, photos, inbox)
                                 /requests/:id/estimate|decline|book|invoice (pro-owned)
                                 /pro/invoices/:id (+ /send, /paid)
          -> routes/customer.js  /request/new, /request, /customer/requests
                                 /requests/:id/estimates/:eid/accept|decline
          -> routes/requests.js  /requests/:id (thread), /requests/:id/message
          -> routes/public.js    /, /c/:id, /pro/:id
```

All routers mount at `/`. The pro router mounts before the public router so
`/pro/services` etc. win over the `/pro/:id` public profile route.

## Layers

- `db/index.js` — better-sqlite3 singleton (`data/marketplace.db`), runs
  `db/schema.sql` on boot, exports `db` + `now()` (ISO timestamps).
- `lib/auth.js` — bcryptjs (10 rounds), `requireLogin`, `requireRole('customer'|'pro')`,
  `currentUser(req)` (never returns the password hash), `currentPro(req)`.
- `lib/billing.js` — `TIER_FREE`/`TIER_PRO`, `getTier()`, `canUse(feature, tier)`
  ('booking' and 'invoicing' require Pro), `planName()`/`planPrice()`,
  `stripeCheckoutStub()` (throws unless `STRIPE_SECRET_KEY` is set; stub only).
- Views: EJS + express-ejs-layouts (`views/layout.ejs` wraps every page via `<%- body %>`).
  Every render passes `pageTitle`; `user` and `proTier` come from `res.locals` middleware.

## Conventions

- Forms POST, then redirect (PRG). Server-rendered; no client framework.
- Money is stored as integer cents (`amount_cents`, `unit_price_cents`); the
  "Make a price" form takes dollars and converts.
- Access: a request thread is visible only to its customer or its pro.
  Estimate accept/decline is customer-only; estimate/book/invoice/decline on a
  request is pro-owner-only. Booking + invoicing are Pro-tier-gated (free tier
  sees the upgrade nudge naming the $39/month Pro plan).
- Photos: multer disk storage to `data/uploads/`, 5 MB cap, image mimes only.
