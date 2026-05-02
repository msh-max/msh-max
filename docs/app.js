// Halal Momentum Calculator

let data = null;
let currency = "USD";

const $ = id => document.getElementById(id);

const OWNER    = "msh-max";
const REPO     = "msh-max";
const BRANCH   = "claude/sp500-momentum-comparison-x5jI4";
const WORKFLOW = "update-data.yml";
const API      = `https://api.github.com/repos/${OWNER}/${REPO}`;

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const resp = await fetch("data.json?t=" + Date.now());
    if (!resp.ok) throw new Error("Failed to fetch data.json");
    data = await resp.json();
    render();
  } catch (err) {
    console.error(err);
    $("status-value").textContent = "Error loading data";
    $("status-detail").textContent = err.message;
  }
}

// ── Live refresh ──────────────────────────────────────────────────────────────

async function refreshData() {
  const btn = $("refresh-btn");

  let token = localStorage.getItem("gh_pat");
  if (!token) {
    token = prompt(
      "One-time setup: enter a GitHub Personal Access Token.\n\n" +
      "Required scope: Actions → Read & Write\n" +
      "Create one at:  github.com/settings/tokens/new\n\n" +
      "It will be saved locally in your browser."
    );
    if (!token) return;
    token = token.trim();
    localStorage.setItem("gh_pat", token);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  setBtn(btn, "loading", "↻ Triggering update...", true);

  try {
    // 1. Trigger the workflow
    const triggerRes = await fetch(
      `${API}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: BRANCH }),
      }
    );

    if (triggerRes.status === 401 || triggerRes.status === 403) {
      localStorage.removeItem("gh_pat");
      throw new Error("Invalid token — cleared. Tap Refresh to re-enter.");
    }
    if (triggerRes.status !== 204) {
      const b = await triggerRes.json().catch(() => ({}));
      throw new Error(b.message || `GitHub API error ${triggerRes.status}`);
    }

    // 2. Wait for the run to appear in the API (~5-10s)
    setBtn(btn, "loading", "⏳ Queued — waiting for runner...", true);
    await sleep(10000);

    // 3. Find the latest workflow_dispatch run on this branch
    const runsRes = await fetch(
      `${API}/actions/workflows/${WORKFLOW}/runs?per_page=5&branch=${encodeURIComponent(BRANCH)}&event=workflow_dispatch`,
      { headers }
    );
    if (!runsRes.ok) throw new Error("Could not list workflow runs");
    const { workflow_runs } = await runsRes.json();
    if (!workflow_runs?.length) throw new Error("No run found — check GitHub Actions tab");
    const runId = workflow_runs[0].id;

    // 4. Poll run status until complete (up to 10 min)
    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {
      await sleep(10000);
      const r = await fetch(`${API}/actions/runs/${runId}`, { headers });
      if (!r.ok) continue;
      const run = await r.json();
      const elapsed = Math.round((Date.now() - (deadline - 10 * 60 * 1000)) / 1000);

      if (run.status === "completed") {
        if (run.conclusion !== "success") {
          throw new Error(`Workflow ${run.conclusion} — check GitHub Actions tab`);
        }
        // 5. Fetch the new data.json via Contents API (no CDN cache)
        setBtn(btn, "loading", "⏳ Loading fresh data...", true);
        const fileRes = await fetch(
          `${API}/contents/docs/data.json?ref=${encodeURIComponent(BRANCH)}`,
          { headers }
        );
        if (!fileRes.ok) throw new Error("Could not fetch updated data.json");
        const file = await fileRes.json();
        data = JSON.parse(atob(file.content.replace(/\n/g, "")));
        render();
        if (!$("results").classList.contains("hidden")) calculate();
        setBtn(btn, "success", "✓ Everything Updated!");
        setTimeout(() => resetBtn(btn), 3000);
        return;
      }

      // Show live status while waiting
      const label = run.status === "in_progress" ? "Running" : "Queued";
      setBtn(btn, "loading", `⏳ ${label}... ${elapsed}s`, true);
    }

    throw new Error("Timed out — check GitHub Actions tab for status.");

  } catch (err) {
    setBtn(btn, "error", "✗ " + err.message);
    setTimeout(() => resetBtn(btn), 6000);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function setBtn(btn, cls, text, disabled = false) {
  btn.className = "refresh-btn" + (cls ? " " + cls : "");
  btn.textContent = text;
  btn.disabled = disabled;
}
function resetBtn(btn) { setBtn(btn, "", "↻ Refresh Data"); }

// ── Render market status + info panel ────────────────────────────────────────

function render() {
  const spy = data.spy;
  const statusCard = $("market-status");

  if (spy.above_ma200) {
    statusCard.className = "status-card green";
    $("status-value").textContent = `ABOVE by +${spy.percent_diff.toFixed(2)}%`;
    $("status-detail").innerHTML =
      `SPY $${spy.price.toFixed(2)} · 200MA $${spy.ma200.toFixed(2)} · <strong>OK to invest</strong>`;
  } else {
    statusCard.className = "status-card red";
    $("status-value").textContent = `BELOW by ${spy.percent_diff.toFixed(2)}%`;
    $("status-detail").innerHTML =
      `SPY $${spy.price.toFixed(2)} · 200MA $${spy.ma200.toFixed(2)} · <strong>STAY IN CASH</strong>`;
  }

  $("signal-date").textContent   = data.signal_date;
  $("last-updated").textContent  = data.last_updated;
  $("universe-size").textContent = data.universe_size + " stocks";
}

// ── Allocation calculator ─────────────────────────────────────────────────────

function calculate() {
  if (!data) return;

  const amountRaw = parseFloat($("amount").value);
  if (!amountRaw || amountRaw <= 0) { alert("Enter a valid amount"); return; }

  const amountUSD = currency === "USD" ? amountRaw : amountRaw / data.usd_to_sar;
  const amountSAR = amountUSD * data.usd_to_sar;
  const k = parseInt($("k-slider").value, 10);
  const topK = data.ranked_stocks.slice(0, k);
  const perStockUSD = amountUSD / k;
  const perStockSAR = amountSAR / k;

  $("results-summary").innerHTML = `
    <div class="big">$${amountUSD.toLocaleString(undefined, {maximumFractionDigits: 2})} USD</div>
    <div class="small">≈ ${amountSAR.toLocaleString(undefined, {maximumFractionDigits: 2})} SAR · ${k} stocks · ${(100/k).toFixed(1)}% each</div>
    <div class="small" style="margin-top:8px;">Per stock: <strong>$${perStockUSD.toFixed(2)}</strong> · <strong>${perStockSAR.toFixed(2)} SAR</strong></div>
  `;

  const list = $("stock-list");
  list.innerHTML = "";
  topK.forEach(s => {
    const shares = perStockUSD / s.price_usd;
    const row = document.createElement("div");
    row.className = "stock-row";
    row.innerHTML = `
      <div class="stock-rank">${s.rank}</div>
      <div class="stock-info">
        <div class="stock-ticker">${s.ticker}</div>
        <div class="stock-momentum">+${s.momentum_pct.toFixed(1)}% (9-1 mo)</div>
        <div class="stock-price-small">Price $${s.price_usd.toFixed(2)}</div>
      </div>
      <div class="stock-alloc">
        <div class="usd">$${perStockUSD.toFixed(2)}</div>
        <div class="sar">${perStockSAR.toFixed(2)} SAR</div>
        <div class="shares">≈ ${shares.toFixed(3)} shares</div>
      </div>
    `;
    list.appendChild(row);
  });

  $("results").classList.remove("hidden");
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Currency helpers ──────────────────────────────────────────────────────────

function updateConverted() {
  if (!data) return;
  const raw = parseFloat($("amount").value);
  const out = $("converted");
  if (!raw || raw <= 0) { out.textContent = ""; return; }
  out.textContent = currency === "USD"
    ? `≈ ${(raw * data.usd_to_sar).toLocaleString(undefined, {maximumFractionDigits: 2})} SAR`
    : `≈ $${(raw / data.usd_to_sar).toLocaleString(undefined, {maximumFractionDigits: 2})} USD`;
}

function setCurrency(cur) {
  currency = cur;
  document.querySelectorAll(".currency-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.currency === cur)
  );
  $("amount-label").textContent = `Amount (${cur})`;
  updateConverted();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadData();

  document.querySelectorAll(".currency-btn").forEach(b =>
    b.addEventListener("click", () => setCurrency(b.dataset.currency))
  );

  $("amount").addEventListener("input", updateConverted);

  $("k-slider").addEventListener("input", e => {
    $("k-value").textContent = e.target.value;
    if (!$("results").classList.contains("hidden")) calculate();
  });

  $("calculate-btn").addEventListener("click", calculate);
  $("amount").addEventListener("keydown", e => { if (e.key === "Enter") calculate(); });
  $("refresh-btn").addEventListener("click", refreshData);
});
