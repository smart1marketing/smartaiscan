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

  // ---- Step 4: full report -----------------------------------------------
  function renderReport(data) {
    document.getElementById("reportHeadline").textContent = data.headline;
    document.getElementById("reportSummary").textContent = data.summary;

    const gapsList = document.getElementById("gapsList");
    gapsList.innerHTML = "";
    (data.gaps && data.gaps.length ? data.gaps : data.findings || []).forEach((g) => {
      const li = document.createElement("li");
      li.textContent = g;
      gapsList.appendChild(li);
    });

    document.getElementById("packageName").textContent = data.package.name;
    document.getElementById("packageReason").textContent = data.package.reason;
    document.getElementById("packageSetup").textContent = data.package.setupInvestment;
    document.getElementById("packageMonthly").textContent = data.package.monthlyInvestment;
    document.getElementById("packageEffort").textContent = data.package.monthlyEffort || "";

    const bookBtn = document.getElementById("bookCallBtn");
    bookBtn.href = data.bookingUrl || "#";

    document.getElementById("crmNote").textContent = data.crmForwarded
      ? "Your results have been sent to a Smart 1 strategist."
      : "Your report is ready. A Smart 1 strategist will follow up shortly.";

    showStep("report");
  }
})();
