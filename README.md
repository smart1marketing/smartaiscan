# Smart 1 — AI Visibility Scan (lead funnel)

A drop-in lead-gen widget for Smart 1 Marketing. A visitor enters a website
URL → the app scans it live for SEO / AI-search ("GEO") readiness → shows a
teaser score → gates the full report + recommended package behind a short
lead form → forwards the lead and scan data to Smart 1 Suite via webhook.

**Flow:** enter URL → scan animation → teaser score (blurred/gated) → lead
capture → full report + package recommendation + "Book a Call" CTA. This is
the same shape as a qualify-then-reveal lead funnel (ask a couple of
qualifying questions, then unlock the quote) — here the qualifying question
is "how many locations do you operate?", which feeds the Authority vs.
Dominance package recommendation.

## What it checks

Server-side, no headless browser needed:
- Homepage HTML: title tag, meta description, word count, JSON-LD schema
  types (FAQPage, HowTo, LocalBusiness/Organization), a rough phone/NAP
  pattern
- `robots.txt` (is the site blocking crawlers site-wide?)
- `sitemap.xml` (present? how many URLs — used as a page-count proxy for
  package sizing)
- `llms.txt` (AI readiness / LLM policy file)

These map to the same categories in Smart 1's Diagnostic Radar Matrix
(Schema, Sitemap, AI Readiness Signals, Reputation/NAP, Resource Content,
Web Structure), scored 0–100 with Critical / Competitive / Strong / Dominant
tiers, matching the gauge in the AI Search Architecture Blueprint.

## 1. Local setup

```bash
npm install
cp .env.example .env
# fill in OPENAI_API_KEY and SMART1_WEBHOOK_URL in .env
npm start
```

Visit `http://localhost:3000`.

## 2. Deploy to Render (via GitHub)

1. Push this folder to a new GitHub repo.
2. In Render: **New → Blueprint**, point it at the repo. `render.yaml` is
   already set up (Node web service, `npm install` / `npm start`).
   - Alternatively: **New → Web Service**, connect the repo, and Render will
     detect Node automatically (build: `npm install`, start: `npm start`).
3. In the Render dashboard, set the environment variables it prompts for
   (`sync: false` ones aren't stored in the repo, so you enter them once in
   Render):
   - `OPENAI_API_KEY`
   - `SMART1_WEBHOOK_URL` — **you'll need this from your Smart 1 Suite
     account's lead-intake/webhook settings.** Until it's set, scans still
     run and reports still generate, but leads won't reach the CRM (check
     the Render logs — it warns loudly).
   - `SMART1_WEBHOOK_TOKEN` — only if Smart 1 Suite requires a bearer token
     on that webhook.
4. Deploy. Render gives you a URL like
   `https://smart1-ai-visibility-funnel.onrender.com`.

## 3. Embed it on a page

**Option A — iframe (simplest, fully isolated):**

```html
<iframe
  src="https://smart1-ai-visibility-funnel.onrender.com"
  style="width:100%; max-width:600px; height:720px; border:0;"
  title="Smart 1 AI Visibility Scan">
</iframe>
```

Resize the iframe's `height` per step if you embed it on a page where you
control the surrounding layout — the widget's content height changes as the
visitor moves through the flow.

**Option B — direct embed on a page you control**, by copying
`public/index.html`'s `<div id="widget">…</div>` block plus `styles.css` and
`app.js` into your page. If the widget's origin differs from the page it's
embedded on, add before `app.js`:

```html
<script>window.SMART1_API_BASE = "https://smart1-ai-visibility-funnel.onrender.com";</script>
<script src="https://smart1-ai-visibility-funnel.onrender.com/app.js"></script>
```

## 4. What gets sent to Smart 1 Suite

On lead capture (`POST /api/unlock`), this JSON is POSTed to
`SMART1_WEBHOOK_URL`:

```json
{
  "source": "ai-visibility-scan-funnel",
  "submittedAt": "2026-07-17T18:00:00.000Z",
  "lead": {
    "name": "...", "email": "...", "phone": "...", "company": "...",
    "website": "https://example.com", "locations": 1
  },
  "scan": {
    "domain": "example.com", "score": 62, "tier": "Strong",
    "signals": { "...": "raw scan signals" },
    "findings": ["..."]
  },
  "recommendation": {
    "name": "Smart 1 Authority Package",
    "reason": "...",
    "setupInvestment": "$5,000 – $7,000",
    "monthlyInvestment": "$349 – $499 / month"
  }
}
```

If your Smart 1 Suite webhook expects a different field layout, adjust the
`webhookPayload` object in `server.js` (`sendToSmart1Suite` call site) — it's
one object literal, easy to reshape.

## 5. Package logic (edit in `server.js` → `recommendPackage`)

- **Dominance package** if the lead reports 2+ locations, or the scanned
  site's sitemap has 75+ URLs.
- **Authority package** otherwise.

Figures are hard-coded from Smart 1's current pricing:

| | Authority | Dominance |
|---|---|---|
| One-time setup | $5,000 – $7,000 | $4,500 – $8,000 |
| Monthly optimization | $349 – $499/mo | $499 – $1,000+/mo |

## Notes / things to swap before real launch

- **Lead storage is in-memory** (`scanCache` in `server.js`), which resets on
  every deploy/restart and won't work across multiple Render instances.
  Fine for a single low-traffic instance; swap for Redis or a DB if you
  scale this up or add autoscaling.
- **Email delivery of the report** isn't wired up — right now the report
  only renders in the widget. If you want it emailed too, that's a second
  webhook call or an email API (e.g. via the CRM automation once the lead
  hits Smart 1 Suite) rather than something this app should own.
- The OpenAI call only writes the narrative copy (headline/summary/gap
  phrasing); the score itself is rule-based and deterministic, so it won't
  drift or hallucinate.
