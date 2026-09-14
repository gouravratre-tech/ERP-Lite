# KGS ERP Lite — Cloud Edition (free, always-on, works when your PC is off)

This is the same app again, adapted to run on a free hosting platform instead of
your own computer — so it's reachable from anywhere, at any time, whether or not
your PC is switched on.

## Why two services instead of one

Free hosts that run your Node app (like Render) wipe their disk on every restart
— so a database file sitting next to your code would silently lose data. To keep
your data safe **and** stay at $0, this version splits the work:

| Piece | Where it runs | Why |
|---|---|---|
| The app itself (this code) | **Render** (free web service) | Runs your Node server, serves the web pages |
| Your data | **Neon** (free Postgres database) | Persists independently of Render — a Render restart can't touch it |

Both have genuinely permanent free tiers (no trial clock, no card required for
either). The one trade-off: Render's free tier "sleeps" your app after 15
minutes with no visitors, and takes ~30–60 seconds to wake back up on the next
request. Everything works normally once it's awake — this only affects the
very first request after a quiet period.

## One-time setup (about 15 minutes)

### 1. Create the database (Neon)
1. Go to [neon.com](https://neon.com) → sign up (no card needed) → **New Project**.
2. Once created, open your project's **Connection Details** and copy the
   connection string — it looks like:
   `postgresql://user:password@ep-something.neon.tech/neondb?sslmode=require`
3. Keep this tab open — you'll paste this string into Render in step 3.

### 2. Put this code on GitHub
Render deploys from a Git repository. If you don't already have a GitHub
account, create one (free), then:
```bash
cd kgs-erp-cloud
git init
git add .
git commit -m "Initial commit"
```
Create a new empty repository on GitHub (github.com → New repository), then:
```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

### 3. Deploy on Render
1. Go to [render.com](https://render.com) → sign up (no card needed for the
   free tier) → **New** → **Web Service**.
2. Connect your GitHub account and pick the repository you just pushed.
3. Render should auto-detect Node. Confirm these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment Variables**, add:
   - `DATABASE_URL` → paste the Neon connection string from step 1
   - `APP_USERNAME` → your chosen login username
   - `APP_PASSWORD` → your chosen login password (make it a real one)
5. Click **Create Web Service**. The first deploy takes a few minutes.
6. Once it's live, Render gives you a URL like
   `https://kgs-erp-lite.onrender.com` — that's your permanent address, usable
   from anywhere, on any device, whether or not your PC is on.

That's it — no server to maintain, no renewal dates on either free tier.

## Using it day-to-day

- Just open your Render URL and log in with the username/password you set.
- If nobody's used it in the last 15 minutes, the first load takes ~30–60
  seconds while Render wakes the app back up — refresh if the first attempt
  times out.
- Every change you make is saved straight to Neon, so it survives Render
  restarts, redeploys, and sleep cycles without any extra step from you.

## If you edit the original HTML files

Same as the local edition — `CSS_Theme.html`, `Logo_Header.html`,
`Sidebar_Nav.html`, `Dashboard_Content.html`, and `Index.html` live in
`src-partials/`. Edit them, commit, and `git push` — Render redeploys
automatically on every push to `main`.

## Editing company details, firms, or director names

Same file as the local edition: **`server/config.js`**. Edit it, commit, push.

## Storage limits to be aware of

Neon's free tier caps total storage at **0.5 GB**. Your regular records (bills,
customers, cash book, etc.) are tiny text — years of normal use won't get close.
**Attachments are the thing to watch**: this version stores uploaded files
(work order PDFs, bank statement uploads, purchase bill scans) directly inside
the database, capped at 10MB per file, since Render's free disk isn't
persistent. If you regularly upload large files, keep an eye on your Neon
project's storage usage — if you ever approach the limit, the fix is either
deleting old attachments or moving to Neon's (still cheap) paid tier.

## Testing changes locally before pushing

You need a Postgres database to point at — either a free Neon branch/project
just for testing, or a local Postgres install:
```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/kgs_test" \
DATABASE_SSL=false \
npm start
```
(`DATABASE_SSL=false` is only for a local, non-Neon Postgres — omit it, or leave
it unset, when pointing at Neon.)

## Project layout

```
kgs-erp-cloud/
├── package.json
├── server/
│   ├── index.js     — Express server: login, /api/rpc endpoint, attachment serving
│   ├── rpc.js        — maps every function the app calls to a real implementation
│   ├── logic.js       — dashboard math, customer ledger, bank statement matching, bulk upload
│   ├── store.js        — generic add/update/delete engine (Postgres version)
│   ├── db.js             — Postgres connection + table creation
│   └── config.js          — FIRMS / DIRECTORS / SHEETS — same as the local edition
├── src-partials/    — your original HTML files, unmodified
├── scripts/
│   ├── build-index.js  — stitches src-partials/ into public/index.html
│   └── gas-shim.js       — makes google.script.run calls hit /api/rpc instead of Google
└── public/          — the built app (generated on every deploy — don't hand-edit)
```

## If you outgrow the free tier

If the app becomes central to daily operations and the sleep/wake delay or the
0.5GB cap start to matter, the upgrade path is simple and doesn't require
touching this code: Render's paid plan ($7/mo) removes the sleep behavior, and
Neon's paid tier removes the storage cap. Nothing about the app itself changes.
