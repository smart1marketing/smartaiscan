/**
 * Smart 1 Marketing — AI Visibility Scan
 * Lead-funnel microservice: scans a prospect's site for SEO / AI-search (GEO)
 * readiness, teases a score, then gates the full report + package
 * recommendation behind a lead-capture form that fires a webhook into
 * Smart 1 Suite.
 *
 * Deploy target: Render (Web Service, Node).
 */

const express = require("express");
const cheerio = require("cheerio");
const OpenAI = require("openai");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- Config -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SMART1_WEBHOOK_URL = process.env.SMART1_WEBHOOK_URL || "";
const SMART1_WEBHOOK_TOKEN = process.env.SMART1_WEBHOOK_TOKEN || "";
const CALENDAR_URL = process.env.CALENDAR_URL || "https://smart1marketing.com/book-a-call";
const FETCH_TIMEOUT_MS = 8000;

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// In-memory scan cache. Swap for Redis/a DB before scaling past a single
// Render instance or if you need scans to survive a restart.
const scanCache = new Map();
const SCAN_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of scanCache) {
    if (now - entry.createdAt > SCAN_TTL_MS) scanCache.delete(id);
  }
}, 5 * 60 * 1000);

// ---- Helpers ------------------------------------------------------------

function normalizeUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return new URL(url);
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Smart1AIVisibilityBot/1.0 (+https://smart1marketing.com; site-readiness-scan)",
        ...(opts.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function safeText(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, status: res.status, body: "" };
    const body = await res.text();
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: "", error: e.message };
  }
}

/** Pull every JSON-LD block on the page and flatten @type values. */
function extractSchemaTypes($) {
  const types = new Set();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = node["@graph"] || [node];
        for (const g of graph) {
          const t = g && g["@type"];
          if (!t) continue;
          (Array.isArray(t) ? t : [t]).forEach((x) => types.add(String(x)));
        }
      }
    } catch (_) {
      /* malformed JSON-LD — counts against the site, not against us */
    }
  });
  return types;
}

function countSitemapUrls(xml) {
  const matches = xml.match(/<loc>/gi);
  return matches ? matches.length : 0;
}

/**
 * Rule-based AI Visibility scan. Mirrors the category weighting used in
 * the Smart 1 AI Search Architecture Blueprint (schema, sitemap, AI
 * readiness signals, local/NAP clarity, content depth, crawlability).
 */
async function scanSite(targetUrl) {
  const parsed = normalizeUrl(targetUrl);
  const origin = parsed.origin;

  const [homepage, robots, sitemap, llmsTxt] = await Promise.all([
    safeText(parsed.toString()),
    safeText(origin + "/robots.txt"),
    safeText(origin + "/sitemap.xml"),
    safeText(origin + "/llms.txt"),
  ]);

  if (!homepage.ok) {
    const err = new Error(
      `Couldn't reach ${parsed.toString()} (status ${homepage.status || "unknown"}). Check the URL and try again.`
    );
    err.userFacing = true;
    throw err;
  }

  const $ = cheerio.load(homepage.body);
  const schemaTypes = extractSchemaTypes($);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  const hasFAQ = schemaTypes.has("FAQPage");
  const hasHowTo = schemaTypes.has("HowTo");
  const hasLocalBusiness = [...schemaTypes].some((t) =>
    /LocalBusiness|Organization|.*Business$/.test(t)
  );
  const hasNAP = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.test(bodyText);
  const title = $("title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content") || "";
  const h1Count = $("h1").length;
  const imgs = $("img");
  const imgsMissingAlt = imgs.filter((_, el) => !$(el).attr("alt")).length;

  const sitemapUrlCount = sitemap.ok ? countSitemapUrls(sitemap.body) : 0;
  const robotsBlocksAll =
    robots.ok && /User-agent:\s*\*\s*[\r\n]+\s*Disallow:\s*\/\s*$/im.test(robots.body);

  // --- Scoring (0–100), weighted like the Diagnostic Radar Matrix -------
  let score = 0;
  const findings = [];

  // Schema richness (0–25)
  let schemaScore = 0;
  if (hasFAQ) schemaScore += 12;
  if (hasHowTo) schemaScore += 6;
  if (hasLocalBusiness) schemaScore += 7;
  schemaScore = Math.min(schemaScore, 25);
  score += schemaScore;
  if (!hasFAQ && !hasHowTo) {
    findings.push(
      "No FAQ or HowTo schema detected — AI engines have no conversational, machine-readable modules to extract for direct answers."
    );
  }

  // AI readiness signal / llms.txt (0–15)
  if (llmsTxt.ok) {
    score += 15;
  } else {
    findings.push(
      "No llms.txt file found — there's no explicit policy telling LLMs how to understand, index, and cite the business."
    );
  }

  // Sitemap (0–10)
  if (sitemap.ok && sitemapUrlCount > 0) {
    score += 10;
  } else {
    findings.push("No reachable sitemap.xml — this slows discovery and indexing of new pages.");
  }

  // Title / meta basics (0–10)
  if (title) score += 5;
  if (metaDesc) score += 5;
  if (!title || !metaDesc) {
    findings.push("Missing or thin title/meta description tags on the homepage.");
  }

  // Local / NAP clarity (0–10)
  if (hasNAP) score += 5;
  if (hasLocalBusiness) score += 5;
  if (!hasNAP) {
    findings.push("No clear phone/contact pattern found on the homepage — weak local entity signal.");
  }

  // Content depth (0–15)
  if (wordCount > 1200) score += 15;
  else if (wordCount > 600) score += 9;
  else if (wordCount > 250) score += 4;
  else findings.push("Homepage content is thin — limited raw material for AI engines to draw from.");

  // Crawlability (0–15)
  if (robots.ok && !robotsBlocksAll) score += 15;
  else if (!robots.ok) score += 7;
  else findings.push("robots.txt appears to block crawling site-wide.");

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier;
  if (score < 25) tier = "Critical";
  else if (score < 50) tier = "Competitive";
  else if (score < 75) tier = "Strong";
  else tier = "Dominant";

  return {
    url: parsed.toString(),
    domain: parsed.hostname,
    score,
    tier,
    signals: {
      hasFAQSchema: hasFAQ,
      hasHowToSchema: hasHowTo,
      hasLocalBusinessSchema: hasLocalBusiness,
      hasNAP,
      hasTitle: !!title,
      hasMetaDescription: !!metaDesc,
      h1Count,
      wordCount,
      imagesMissingAlt: imgsMissingAlt,
      sitemapFound: sitemap.ok,
      sitemapUrlCount,
      llmsTxtFound: llmsTxt.ok,
      robotsBlocksAll,
    },
    findings,
  };
}

/** Package logic drawn directly from the Smart 1 Authority / Dominance tiers. */
function recommendPackage({ sitemapUrlCount }, locationsCount) {
  const multiLocation = locationsCount && locationsCount >= 2;
  const largeFootprint = sitemapUrlCount >= 75;

  if (multiLocation || largeFootprint) {
    return {
      name: "Smart 1 Dominance Package",
      reason: multiLocation
        ? "Multi-location businesses need coordinated local authority across every profile, which the Dominance package is built for."
        : "A site of this size needs schema and content work across 15+ pages, which is the Dominance package's scope.",
      setupInvestment: "$4,500 – $8,000",
      monthlyInvestment: "$499 – $1,000+ / month",
      monthlyEffort: "10–15+ hrs/month of ongoing management",
    };
  }
  return {
    name: "Smart 1 Authority Package",
    reason:
      "A single-location business with a moderate site footprint is the ideal fit for the Authority package's infrastructure build.",
    setupInvestment: "$5,000 – $7,000",
    monthlyInvestment: "$349 – $499 / month",
    monthlyEffort: "Lighter monthly cadence — analytics, dashboard, and content reviews rather than aggressive multi-location scaling",
  };
}

async function generateNarrative(scan, lead, pkg) {
  const fallback = {
    headline: `${scan.domain} scores ${scan.score}/100 — ${scan.tier} AI visibility.`,
    summary:
      scan.findings.length > 0
        ? `The site has real gaps holding back AI citation: ${scan.findings.slice(0, 3).join(" ")}`
        : "The site has a solid technical base with room to grow AI citation authority.",
    gaps: scan.findings.slice(0, 4),
  };

  if (!openai) return fallback;

  try {
    const prompt = `You are writing a short, plain-English AI-search-readiness summary for a business owner, as part of a Smart 1 Marketing lead-gen tool. Do not use marketing hype. Be specific and factual, based only on the data given.

Site: ${scan.domain}
AI Visibility Score: ${scan.score}/100 (${scan.tier})
Signals: ${JSON.stringify(scan.signals)}
Detected gaps: ${JSON.stringify(scan.findings)}
Lead's stated locations: ${lead.locations || "not provided"}
Recommended package: ${pkg.name}

Return JSON only, matching this shape exactly:
{"headline": "one sentence, <20 words", "summary": "2-3 sentences, plain English, no jargon overload", "gaps": ["short gap 1", "short gap 2", "short gap 3"]}`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 400,
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    if (!parsed.headline || !parsed.summary) return fallback;
    return parsed;
  } catch (e) {
    console.error("OpenAI narrative generation failed:", e.message);
    return fallback;
  }
}

async function sendToSmart1Suite(payload) {
  if (!SMART1_WEBHOOK_URL) {
    console.warn("SMART1_WEBHOOK_URL not set — skipping CRM webhook (lead was NOT forwarded).");
    return { sent: false, reason: "no_webhook_configured" };
  }
  try {
    const res = await fetchWithTimeout(SMART1_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SMART1_WEBHOOK_TOKEN ? { Authorization: `Bearer ${SMART1_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    console.error("Smart 1 Suite webhook failed:", e.message);
    return { sent: false, reason: e.message };
  }
}

// ---- Routes -------------------------------------------------------------

app.use(express.static("public"));

/** Step 1: run the scan, cache it, return a TEASER only (no full gaps/package). */
app.post("/api/scan", async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "A website URL is required." });
  }
  try {
    const scan = await scanSite(url);
    const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    scanCache.set(scanId, { scan, createdAt: Date.now() });

    res.json({
      scanId,
      domain: scan.domain,
      score: scan.score,
      tier: scan.tier,
      teaserFinding: scan.findings[0] || "Your site has structural gaps limiting AI citation.",
      gapCount: scan.findings.length,
    });
  } catch (e) {
    res.status(e.userFacing ? 422 : 500).json({ error: e.message || "Scan failed." });
  }
});

/** Step 2: lead capture unlocks the full report AND fires the CRM webhook. */
app.post("/api/unlock", async (req, res) => {
  const { scanId, lead } = req.body || {};
  const entry = scanId && scanCache.get(scanId);
  if (!entry) {
    return res
      .status(404)
      .json({ error: "That scan has expired. Please run the scan again." });
  }
  if (!lead || !lead.name || !lead.email || !lead.website) {
    return res.status(400).json({ error: "Name, email, and website are required." });
  }

  const { scan } = entry;
  const locationsCount = Number(lead.locations) || 1;
  const pkg = recommendPackage(scan.signals, locationsCount);
  const narrative = await generateNarrative(scan, lead, pkg);

  const webhookPayload = {
    source: "ai-visibility-scan-funnel",
    submittedAt: new Date().toISOString(),
    lead: {
      name: lead.name,
      email: lead.email,
      phone: lead.phone || null,
      company: lead.company || null,
      website: scan.url,
      locations: locationsCount,
    },
    scan: {
      domain: scan.domain,
      score: scan.score,
      tier: scan.tier,
      signals: scan.signals,
      findings: scan.findings,
    },
    recommendation: pkg,
  };

  const webhookResult = await sendToSmart1Suite(webhookPayload);

  res.json({
    domain: scan.domain,
    score: scan.score,
    tier: scan.tier,
    findings: scan.findings,
    signals: scan.signals,
    headline: narrative.headline,
    summary: narrative.summary,
    gaps: narrative.gaps,
    package: pkg,
    bookingUrl: CALENDAR_URL,
    crmForwarded: webhookResult.sent,
  });

  scanCache.delete(scanId);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: !!openai,
    webhookConfigured: !!SMART1_WEBHOOK_URL,
  });
});

app.listen(PORT, () => {
  console.log(`Smart 1 AI Visibility Scan running on port ${PORT}`);
  if (!OPENAI_API_KEY) console.warn("⚠️  OPENAI_API_KEY not set — narrative will use fallback text.");
  if (!SMART1_WEBHOOK_URL) console.warn("⚠️  SMART1_WEBHOOK_URL not set — leads will NOT reach Smart 1 Suite.");
});
