# Sales Competition Coach — Live Scoring

A live, shared leaderboard for a sales competition, with **AI-assisted scoring**: a
judge pastes in a pitch transcript and the AI suggests a 0–10 score plus a one-sentence
justification for every rubric item it can judge from the words. The judge reviews and
can adjust **every** score before saving.

**This whole thing is free to run**, and judges need nothing — no account, no login, no
Claude/Pro. They just open the website and click.

- **Frontend:** static HTML/JS on **GitHub Pages** (free).
- **Database:** **Firebase Realtime Database** on the free **Spark** plan (the shared, live leaderboard).
- **AI scoring:** a **Cloudflare Worker** (free tier) that calls **Groq** (free tier; fast Llama models).
  Your Groq API key is a Worker secret and is **never sent to the browser**.

The rubric is the official **Sales Competition judging rubric** — 29 sub-criteria across
6 categories, 290 points.

---

## What's free vs. paid

Everything here runs on free tiers, so a normal competition costs **$0**:

| Piece | Service | Cost |
|---|---|---|
| Website | GitHub Pages | Free |
| Leaderboard + manual scoring | Firebase Realtime Database (Spark) | Free |
| AI transcript scoring + coaching | Cloudflare Workers + Groq | Free tiers |

The only limits are Groq's **free-tier rate limits** (generous and fast — fine for judging a
competition). No credit card required for any of it. If you ever outgrow the free tier, you
can add billing on the Groq side without changing this code.

---

## Project structure

```
sales-scoring/
├── index.html            # the page (leaderboard + scoring UI)
├── styles.css
├── app.js                # leaderboard, manual entry, AI scoring — talks to Firebase + the Worker
├── rubric.js             # the 29-item judging rubric — SINGLE SOURCE OF TRUTH
├── firebase-config.js    # your PUBLIC Firebase web config + your Worker URL (you fill these in)
├── firebase.json         # Firebase config (database only)
├── .firebaserc           # your Firebase project id (you fill this in)
├── database.rules.json   # Realtime Database security rules
└── worker/
    ├── worker.js         # the Cloudflare Worker that calls Groq (scoring + coaching)
    └── wrangler.toml
```

## What the AI scores vs. what you score by hand

The AI only scores items it can genuinely judge from a transcript; everything non-verbal
is left blank with a "score manually" note. Controlled by the `manualOnly` flag in
`rubric.js`.

| Left for the judge (manual, non-verbal) | Why |
|---|---|
| **All of Category 6 — Sales Style** (visual aids, engaging via questions, verbal & non-verbal delivery, professional dress/image, attitude & confidence) | Delivery, posture, aids, dress, tone — can't be seen/heard in text |
| **Intro: Professional opening** | Depends on the handshake/greeting gesture |
| **Intro: Builds rapport** | Rapport and eye contact are non-verbal |

The other **21 items** are AI-scored, each with a one-sentence justification shown under
the input (and saved with the score).

---

## Setup — walkthrough

You'll need [Node.js](https://nodejs.org) and the Firebase CLI (`npm install -g firebase-tools`).
Wrangler (the Cloudflare CLI) is run on demand via `npx`, so there's nothing to install for it.

### 1. Get a free Groq API key

1. Go to **Groq Console** → https://console.groq.com/keys
2. Sign in (free — no billing needed) and click **Create API Key**.
3. Copy the key. You'll store it as a Worker secret in step 3 (**don't** put it in any file).

### 2. Create the Firebase project (free Spark plan)

No Blaze / no billing needed — the database runs on the free tier.

1. Create a project at https://console.firebase.google.com
2. **Build → Realtime Database → Create database** → pick a region → start in **locked mode**
   (our `database.rules.json` deploys over it).
3. Register a **Web app**: **⚙ Project settings → General → Your apps → Web (`</>`)** and copy
   the `firebaseConfig` values.
4. Put your project id in **`.firebaserc`** and the web config into **`firebase-config.js`**
   (make sure `databaseURL` is filled in). Leave `aiEndpoint` for step 3.

### 3. Deploy the Cloudflare Worker (the AI backend)

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
2. From the `worker/` folder, log in and store your Groq key as a secret:
   ```bash
   npx wrangler login
   npx wrangler secret put GROQ_API_KEY
   ```
   Paste your Groq key when prompted — it's stored on Cloudflare, never in the browser or git.
   (No CLI? You can paste the Worker code and add the `GROQ_API_KEY` secret directly in the
   Cloudflare dashboard: the Worker → **Settings → Variables and Secrets**.)
3. Deploy:
   ```bash
   npx wrangler deploy
   ```
4. Wrangler prints a URL like `https://sales-competition-coach.<you>.workers.dev`. Copy it into
   **`firebase-config.js`** as `aiEndpoint` (no trailing slash).

Cloudflare Workers docs: https://developers.cloudflare.com/workers/

### 4. Deploy the database rules

From the `sales-scoring/` folder:

```bash
firebase login
firebase deploy --only database
```

(Or skip the CLI and paste `database.rules.json` into the console under Realtime Database → Rules.)

### 5. Publish the site to GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**. Docs:
   https://docs.github.com/en/pages
3. Your site is live at `https://<you>.github.io/<repo>/`. Share that link — anyone can open
   it, view the leaderboard, and score pitches with the AI button. **No account needed.**

---

## Recommended hardening (before a real event)

Defaults are permissive so it works immediately. For a real competition:

- **Lock the Worker to your site.** In `worker/wrangler.toml` set `ALLOWED_ORIGIN` to your
  GitHub Pages URL and redeploy, so only your page can call the AI (stops strangers using your
  Groq quota).
- **Lock the database.** `database.rules.json` currently allows public read/write. Add
  [Firebase Authentication](https://firebase.google.com/docs/auth) (even a shared judge login)
  and require `auth != null` in the rules.

---

## Changing things

- **AI model:** edit the `MODELS` list in `worker/worker.js` — the Worker tries them in
  order and uses the first one your Groq account supports. Model list:
  https://console.groq.com/docs/models
- **Rubric wording, points, or what's AI-scored:** edit `rubric.js` — the single source of
  truth for both the inputs the page renders and the items sent to the AI.

## Not included (yet)

**Video support** — scoring a recorded video would need audio transcription plus frame-by-frame
visual analysis for the non-verbal Sales Style items. Transcript scoring first.
