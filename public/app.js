(function () {
  const widget = document.getElementById("widget");
  const steps = widget.querySelectorAll(".step");

  function showStep(name) {
    steps.forEach((s) => {
      s.hidden = s.dataset.step !== name;
    });
  }

  function apiBase() {
    // Same-origin by default. If this widget is embedded via <script> on a
    // different domain than the Render service, set window.SMART1_API_BASE
    // before including app.js, e.g.
    // <script>window.SMART1_API_BASE = "https://your-service.onrender.com";</script>
    return window.SMART1_API_BASE || "";
  }

  async function postJSON(path, body) {
    const res = await fetch(apiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function showError(message) {
    document.getElementById("errorMessage").textContent = message;
    showStep("error");
  }

  // ---- Step 0: entry ----------------------------------------------------
  const entryForm = document.getElementById("entryForm");
  const urlInput = document.getElementById("urlInput");
  let lastUrl = "";

  entryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    lastUrl = url;
    runScan(url);
  });

  document.getElementById("retryBtn").addEventListener("click", () => {
    if (lastUrl) runScan(lastUrl);
    else showStep("entry");
  });

  // ---- Step 1: scanning animation ---------------------------------------
  const CHECKLIST_STEPS = ["crawl", "sitemap", "schema", "ai", "score"];

  function runChecklistAnimation() {
    const items = document.querySelectorAll("#checklist li");
    items.forEach((li) => li.classList.remove("active", "done"));
    let i = 0;
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (i > 0) items[i - 1].classList.add("done");
        items[i - 1] && items[i - 1].classList.remove("active");
        if (i < items.length) {
          items[i].classList.add("active");
          i++;
        } else {
          clearInterval(interval);
          resolve();
        }
      }, 550);
    });
  }

  async function runScan(rawUrl) {
    document.getElementById("scanDomain").textContent = rawUrl.replace(/^https?:\/\//, "");
    showStep("scanning");

    const animationDone = runChecklistAnimation();
    let result, animError;
    try {
      const [scanResult] = await Promise.all([
        postJSON("/api/scan", { url: rawUrl }),
        animationDone,
      ]);
      result = scanResult;
    } catch (e) {
      animError = e;
    }

    if (animError) {
      showError(animError.message);
      return;
    }
    renderTeaser(result);
  }

  // ---- Step 2: teaser + gauge -------------------------------------------
  function tierArcOffset(score) {
    // gauge-fill path length is 283 (semicircle), 0 score => full offset
    const pct = Math.max(0, Math.min(100, score)) / 100;
    return 283 - 283 * pct;
  }

  function needleAngle(score) {
    // -90deg (score 0) to +90deg (score 100), pointing up at 50
    const pct = Math.max(0, Math.min(100, score)) / 100;
    return -90 + 180 * pct;
  }

  let currentScanId = null;
  let currentWebsite = "";

  function renderTeaser(data) {
    currentScanId = data.scanId;
    currentWebsite = data.domain;

    document.getElementById("teaserDomain").textContent = data.domain;
    document.getElementById("scoreValue").textContent = data.score;
    document.getElementById("tierLabel").textContent = data.tier + " AI VISIBILITY";
    document.getElementById("teaserFinding").textContent = data.teaserFinding;
    document.getElementById("gapCount").textContent = Math.max(data.gapCount - 1, 0);

    document.querySelector('input[name="scanId"]').value = data.scanId;
    document.querySelector('input[name="website"]').value = data.domain;

    showStep("teaser");

    // animate gauge after paint
    requestAnimationFrame(() => {
      const fill = document.getElementById("gaugeFill");
      const needle = document.getElementById("gaugeNeedle");
      fill.style.strokeDashoffset = tierArcOffset(data.score);
      needle.style.transform = `rotate(${needleAngle(data.score)}deg)`;
    });
  }

  // ---- Step 2b: lead capture ---------------------------------------------
  const leadForm = document.getElementById("leadForm");
  leadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showStep("unlocking");

    const fd = new FormData(leadForm);
    const lead = Object.fromEntries(fd.entries());

    try {
      const report = await postJSON("/api/unlock", {
        scanId: currentScanId,
        lead,
      });
      renderReport(report);
    } catch (err) {
      showError(err.message);
    }
  });

  // ---- Step 4: full audit report ----------------------------------------
  function ringSVG(score) {
    const r = 30, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
    const col = score >= 75 ? "#16884a" : score >= 45 ? "#c07d16" : "#b3261e";
    return (
      '<svg width="72" height="72" style="transform:rotate(-90deg)">' +
      '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="#eef2f8" stroke-width="7"/>' +
      '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct)) + '"/>' +
      '</svg><div class="rep-ring-num">' + score + "</div>"
    );
  }

  function renderReport(data) {
    document.getElementById("reportHeadline").textContent = data.headline || "";
    document.getElementById("reportSummary").textContent = data.summary || "";

    const tierEl = document.getElementById("reportTier");
    if (tierEl) tierEl.textContent = (data.tier || "") + " AI VISIBILITY";

    const ring = document.getElementById("repRing");
    if (ring) ring.innerHTML = ringSVG(data.score || 0);

    const grid = document.getElementById("catGrid");
    grid.innerHTML = "";
    (data.categories || []).forEach((c) => {
      const checks = (c.checks || [])
        .map((ck) =>
          '<div class="cat-check"><span class="ck ' + (ck.ok ? "y" : "n") + '">' +
          (ck.ok ? "✓" : "✕") + "</span>" + ck.label +
          (ck.value ? '<span class="cv">' + ck.value + "</span>" : "") + "</div>"
        )
        .join("");
      const div = document.createElement("div");
      div.className = "cat";
      div.innerHTML =
        '<div class="cat-h"><span class="nm">' + c.label + '</span><span class="sc st-' + c.status + '">' + c.score + "</span></div>" +
        '<div class="track"><div class="fillb bg-' + c.status + '" style="width:' + c.score + '%"></div></div>' +
        '<div class="cat-checks">' + checks + "</div>";
      grid.appendChild(div);
    });

    const rl = document.getElementById("recsList");
    rl.innerHTML = "";
    (data.recommendations || []).forEach((r) => {
      const div = document.createElement("div");
      div.className = "rec";
      div.innerHTML =
        '<span class="pri pri-' + r.priority + '">' + r.priority + "</span>" +
        '<div class="rc"><strong>' + r.title + "</strong><p>" + r.detail + "</p></div>";
      rl.appendChild(div);
    });

    const bookBtn = document.getElementById("bookCallBtn");
    if (bookBtn && data.bookingUrl) bookBtn.href = data.bookingUrl;

    document.getElementById("crmNote").textContent = data.crmForwarded
      ? "Your results have been sent to a Smart 1 strategist."
      : "Your report is ready. A Smart 1 strategist will follow up shortly.";

    showStep("report");
  }
})();
