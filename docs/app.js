// Halal Momentum Calculator — loads data.json and computes allocations

let data = null;
let currency = "USD";  // "USD" or "SAR"

const $ = id => document.getElementById(id);

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

async function refreshData() {
  const btn = $("refresh-btn");
  btn.disabled = true;
  btn.className = "refresh-btn loading";
  btn.textContent = "↻ Refreshing...";
  try {
    const resp = await fetch("data.json?t=" + Date.now());
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    data = await resp.json();
    render();
    if (!$("results").classList.contains("hidden")) calculate();
    btn.className = "refresh-btn success";
    btn.textContent = "✓ Data Updated";
  } catch (err) {
    console.error(err);
    btn.className = "refresh-btn error";
    btn.textContent = "✗ Refresh Failed";
  } finally {
    setTimeout(() => {
      btn.textContent = "↻ Refresh Data";
      btn.className = "refresh-btn";
      btn.disabled = false;
    }, 2500);
  }
}

function render() {
  // Market status banner
  const spy = data.spy;
  const statusCard = $("market-status");
  const statusValue = $("status-value");
  const statusDetail = $("status-detail");

  if (spy.above_ma200) {
    statusCard.classList.add("green");
    statusCard.classList.remove("red");
    statusValue.textContent = `ABOVE by +${spy.percent_diff.toFixed(2)}%`;
    statusDetail.innerHTML = `SPY $${spy.price.toFixed(2)} · 200MA $${spy.ma200.toFixed(2)} · <strong>OK to invest</strong>`;
  } else {
    statusCard.classList.add("red");
    statusCard.classList.remove("green");
    statusValue.textContent = `BELOW by ${spy.percent_diff.toFixed(2)}%`;
    statusDetail.innerHTML = `SPY $${spy.price.toFixed(2)} · 200MA $${spy.ma200.toFixed(2)} · <strong>STAY IN CASH</strong>`;
  }

  // Info panel
  $("signal-date").textContent = data.signal_date;
  $("last-updated").textContent = data.last_updated;
  $("universe-size").textContent = data.universe_size + " stocks";
}

function calculate() {
  if (!data) return;

  const amountRaw = parseFloat($("amount").value);
  if (!amountRaw || amountRaw <= 0) {
    alert("Enter a valid amount");
    return;
  }

  // Convert to USD if needed
  const amountUSD = currency === "USD" ? amountRaw : amountRaw / data.usd_to_sar;
  const amountSAR = amountUSD * data.usd_to_sar;

  const k = parseInt($("k-slider").value, 10);
  const topK = data.ranked_stocks.slice(0, k);
  const perStockUSD = amountUSD / k;
  const perStockSAR = amountSAR / k;

  // Summary
  const summary = $("results-summary");
  summary.innerHTML = `
    <div class="big">$${amountUSD.toLocaleString(undefined, {maximumFractionDigits: 2})} USD</div>
    <div class="small">≈ ${amountSAR.toLocaleString(undefined, {maximumFractionDigits: 2})} SAR · ${k} stocks · ${(100/k).toFixed(1)}% each</div>
    <div class="small" style="margin-top:8px;">Per stock: <strong>$${perStockUSD.toFixed(2)}</strong> · <strong>${perStockSAR.toFixed(2)} SAR</strong></div>
  `;

  // Stock rows
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

function updateConverted() {
  if (!data) return;
  const raw = parseFloat($("amount").value);
  const out = $("converted");
  if (!raw || raw <= 0) { out.textContent = ""; return; }
  if (currency === "USD") {
    const sar = raw * data.usd_to_sar;
    out.textContent = `≈ ${sar.toLocaleString(undefined, {maximumFractionDigits: 2})} SAR`;
  } else {
    const usd = raw / data.usd_to_sar;
    out.textContent = `≈ $${usd.toLocaleString(undefined, {maximumFractionDigits: 2})} USD`;
  }
}

function setCurrency(cur) {
  currency = cur;
  document.querySelectorAll(".currency-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.currency === cur);
  });
  $("amount-label").textContent = `Amount (${cur})`;
  updateConverted();
}

// Event bindings
document.addEventListener("DOMContentLoaded", () => {
  loadData();

  document.querySelectorAll(".currency-btn").forEach(b => {
    b.addEventListener("click", () => setCurrency(b.dataset.currency));
  });

  $("amount").addEventListener("input", updateConverted);

  $("k-slider").addEventListener("input", e => {
    $("k-value").textContent = e.target.value;
    if (!$("results").classList.contains("hidden")) calculate();
  });

  $("calculate-btn").addEventListener("click", calculate);

  $("amount").addEventListener("keydown", e => {
    if (e.key === "Enter") calculate();
  });

  $("refresh-btn").addEventListener("click", refreshData);
});
