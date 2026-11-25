const formatInr = (amount) => {
  const sign = amount < 0 ? "-" : "";
  const absVal = Math.abs(Number(amount) || 0);
  const [intPart, decPart] = absVal.toFixed(2).split(".");
  let formattedInt = intPart;
  if (intPart.length > 3) {
    const lastThree = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    const groups = [];
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) groups.unshift(rest);
    formattedInt = `${groups.join(",")},${lastThree}`;
  }
  return `${sign}₹${formattedInt}.${decPart}`;
};

// Accessible validation sync (:user-invalid + aria-invalid + polite live region)
(() => {
  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.classList.add("visually-hidden");
  document.body.append(announcer);

  let announceTimer;
  let announcedField;
  const flagged = new WeakSet();
  const announced = new WeakSet();

  const linkError = (el, shown) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  };

  const announceError = (el) => {
    const error = document.getElementById(el.dataset.error);
    if (!error) return;
    const labelText = el.labels?.[0]?.textContent?.trim();
    const prefix = labelText ? `${labelText}: ` : "";
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = prefix + error.textContent.replace(/\s+/g, " ").trim();
    }, 450);
  };

  const syncAria = (el, shouldAnnounce = false) => {
    if (!el.matches?.("input, select, textarea")) return;
    const isInvalid = CSS.supports("selector(:user-invalid)")
      ? el.matches(":user-invalid")
      : !el.validity.valid && flagged.has(el);

    if (isInvalid) {
      if (shouldAnnounce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute("aria-invalid", "true");
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
      el.setAttribute("aria-invalid", "false");
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = "";
      }
    }
  };

  document.querySelectorAll("input, select").forEach((el) => syncAria(el));
  document.addEventListener("blur", (e) => syncAria(e.target, true), true);
  document.addEventListener("input", (e) => {
    if (e.target.hasAttribute("aria-invalid")) syncAria(e.target);
  });
  document.addEventListener("invalid", (e) => {
    announced.add(e.target);
    syncAria(e.target);
  }, true);
})();

const form = document.getElementById("sim-form");
const tickersInput = document.getElementById("tickers-input");
const stockSearchInput = document.getElementById("stock-search");
const stockListbox = document.getElementById("stock-listbox");
const stockCombobox = document.getElementById("stock-combobox");
const selectedStocksEl = document.getElementById("selected-stocks");
const weightsInput = document.getElementById("weights-input");

const INDIAN_STOCK_CATALOG = [
  { base: "RELIANCE", name: "Reliance Industries" },
  { base: "TCS", name: "Tata Consultancy Services" },
  { base: "HDFCBANK", name: "HDFC Bank" },
  { base: "INFY", name: "Infosys" },
  { base: "ICICIBANK", name: "ICICI Bank" },
  { base: "SBIN", name: "State Bank of India" },
  { base: "BHARTIARTL", name: "Bharti Airtel" },
  { base: "ITC", name: "ITC Limited" },
  { base: "LT", name: "Larsen & Toubro" },
  { base: "SUNPHARMA", name: "Sun Pharmaceutical" },
  { base: "HINDUNILVR", name: "Hindustan Unilever" },
  { base: "AXISBANK", name: "Axis Bank" },
  { base: "KOTAKBANK", name: "Kotak Mahindra Bank" },
  { base: "BAJFINANCE", name: "Bajaj Finance" },
  { base: "MARUTI", name: "Maruti Suzuki India" },
  { base: "TITAN", name: "Titan Company" },
  { base: "ASIANPAINT", name: "Asian Paints" },
  { base: "WIPRO", name: "Wipro" },
  { base: "HCLTECH", name: "HCL Technologies" },
  { base: "NTPC", name: "NTPC Limited" },
  { base: "POWERGRID", name: "Power Grid Corp" },
  { base: "TATAMOTORS", name: "Tata Motors" },
  { base: "TATASTEEL", name: "Tata Steel" },
  { base: "JSWSTEEL", name: "JSW Steel" },
  { base: "ADANIENT", name: "Adani Enterprises" },
  { base: "ADANIPORTS", name: "Adani Ports" },
  { base: "ULTRACEMCO", name: "UltraTech Cement" },
  { base: "M&M", name: "Mahindra & Mahindra" },
  { base: "COALINDIA", name: "Coal India" },
  { base: "ONGC", name: "Oil & Natural Gas Corp" },
  { base: "BAJAJ-AUTO", name: "Bajaj Auto" },
  { base: "CIPLA", name: "Cipla" },
  { base: "DRREDDY", name: "Dr. Reddy's Laboratories" },
  { base: "NESTLEIND", name: "Nestle India" },
  { base: "TRENT", name: "Trent Limited" },
  { base: "BEL", name: "Bharat Electronics" },
  { base: "HAL", name: "Hindustan Aeronautics" },
  { base: "INDIGO", name: "InterGlobe Aviation (IndiGo)" },
  { base: "DMART", name: "Avenue Supermarts (DMart)" },
];

let activeExchange = "NS";
let selectedTickers = [];
let dropdownOptions = [];
let highlightedIndex = -1;
let searchDebounce;
let searchAbortController = null;

function syncSelectedStocksUI() {
  tickersInput.value = selectedTickers.join(", ");
  selectedStocksEl.innerHTML = selectedTickers
    .map(
      (sym) => `
      <span class="stock-tag">
        <span>${sym}</span>
        <button type="button" data-remove="${sym}" aria-label="Remove ${sym}">&times;</button>
      </span>`
    )
    .join("");

  if (selectedTickers.length < 2 || selectedTickers.length > 10) {
    tickersInput.setCustomValidity("Select between 2 and 10 Indian stocks.");
  } else {
    tickersInput.setCustomValidity("");
  }
}

function addOrToggleTicker(symbol) {
  const sym = symbol.toUpperCase();
  if (selectedTickers.includes(sym)) {
    selectedTickers = selectedTickers.filter((t) => t !== sym);
  } else if (selectedTickers.length < 10) {
    selectedTickers = [...selectedTickers, sym];
  }
  if (selectedTickers.length >= 2) {
    errorBanner.hidden = true;
  }
  syncSelectedStocksUI();
  renderStockDropdown(dropdownOptions);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStockDropdown(
  options,
  emptyMessage = "No matching stocks found",
  searchingQuery = ""
) {
  dropdownOptions = options;
  if (!options.length && searchingQuery) {
    stockListbox.innerHTML = `<li class="stock-searching">Searching for "${escapeHtml(searchingQuery)}"...</li>`;
    highlightedIndex = -1;
  } else if (!options.length) {
    stockListbox.innerHTML = `<li class="stock-empty">${escapeHtml(emptyMessage)}</li>`;
    highlightedIndex = -1;
  } else {
    const itemsHtml = options
      .map((opt, idx) => {
        const isSelected = selectedTickers.includes(opt.symbol);
        const isHighlighted = idx === highlightedIndex;
        return `
        <li
          role="option"
          aria-selected="${isSelected}"
          class="stock-option ${isSelected ? "selected" : ""} ${isHighlighted ? "highlighted" : ""}"
          data-symbol="${opt.symbol}"
        >
          <span class="stock-opt-name">${escapeHtml(opt.name)}</span>
          <span class="stock-opt-sym">${opt.symbol}${isSelected ? " ✓" : ""}</span>
        </li>`;
      })
      .join("");
    const statusRow = searchingQuery
      ? `<li class="stock-searching">Searching for "${escapeHtml(searchingQuery)}"...</li>`
      : "";
    stockListbox.innerHTML = itemsHtml + statusRow;
  }
  stockListbox.hidden = false;
  stockSearchInput.setAttribute("aria-expanded", "true");
}

function closeStockDropdown() {
  stockListbox.hidden = true;
  stockSearchInput.setAttribute("aria-expanded", "false");
  highlightedIndex = -1;
}

function getLocalMatches(query) {
  const q = query.trim().toLowerCase();
  const suffix = `.${activeExchange}`;
  return INDIAN_STOCK_CATALOG.filter(
    (item) =>
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.base.toLowerCase().includes(q)
  )
    .slice(0, 12)
    .map((item) => ({
      symbol: `${item.base}${suffix}`,
      name: item.name,
      exchange: activeExchange,
    }));
}

async function searchStocks(query) {
  const local = getLocalMatches(query);
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    renderStockDropdown(local);
    return;
  }

  renderStockDropdown(local, "No matching stocks found", trimmed);

  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  try {
    const resp = await fetch(
      `/api/search?q=${encodeURIComponent(trimmed)}&exchange=${activeExchange}`,
      { signal: searchAbortController.signal }
    );
    if (!resp.ok) {
      if (stockSearchInput.value.trim() === trimmed && !stockListbox.hidden) {
        renderStockDropdown(local);
      }
      return;
    }
    const data = await resp.json();
    const remote = data.results || [];
    const seen = new Set(local.map((o) => o.symbol));
    const merged = [...local];
    for (const item of remote) {
      if (!seen.has(item.symbol)) {
        seen.add(item.symbol);
        merged.push(item);
      }
    }
    if (stockSearchInput.value.trim() === trimmed && !stockListbox.hidden) {
      renderStockDropdown(merged.slice(0, 12));
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (stockSearchInput.value.trim() === trimmed && !stockListbox.hidden) {
      renderStockDropdown(local);
    }
  }
}

syncSelectedStocksUI();

document.querySelectorAll(".exch-btn[data-exchange]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeExchange = btn.dataset.exchange;
    document.querySelectorAll(".exch-btn[data-exchange]").forEach((b) => {
      const isActive = b === btn;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-pressed", String(isActive));
    });
    if (!stockListbox.hidden || document.activeElement === stockSearchInput) {
      searchStocks(stockSearchInput.value);
    }
  });
});

stockSearchInput.addEventListener("focus", () => {
  searchStocks(stockSearchInput.value);
});

stockSearchInput.addEventListener("input", () => {
  highlightedIndex = -1;
  clearTimeout(searchDebounce);
  const q = stockSearchInput.value;
  const trimmed = q.trim();
  renderStockDropdown(
    getLocalMatches(q),
    "No matching stocks found",
    trimmed.length >= 2 ? trimmed : ""
  );
  searchDebounce = setTimeout(() => searchStocks(q), 150);
});

stockSearchInput.addEventListener("keydown", (e) => {
  if (stockListbox.hidden) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (dropdownOptions.length) {
      highlightedIndex = (highlightedIndex + 1) % dropdownOptions.length;
      renderStockDropdown(dropdownOptions);
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (dropdownOptions.length) {
      highlightedIndex =
        (highlightedIndex - 1 + dropdownOptions.length) % dropdownOptions.length;
      renderStockDropdown(dropdownOptions);
    }
  } else if (e.key === "Enter" && highlightedIndex >= 0 && dropdownOptions[highlightedIndex]) {
    e.preventDefault();
    addOrToggleTicker(dropdownOptions[highlightedIndex].symbol);
  } else if (e.key === "Escape") {
    closeStockDropdown();
  }
});

stockListbox.addEventListener("mousedown", (e) => {
  const option = e.target.closest(".stock-option[data-symbol]");
  if (!option) return;
  e.preventDefault();
  addOrToggleTicker(option.dataset.symbol);
});

selectedStocksEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove]");
  if (!btn) return;
  const sym = btn.dataset.remove;
  selectedTickers = selectedTickers.filter((t) => t !== sym);
  syncSelectedStocksUI();
  if (!stockListbox.hidden) {
    renderStockDropdown(dropdownOptions);
  }
});

document.addEventListener("click", (e) => {
  if (!stockCombobox.contains(e.target)) {
    closeStockDropdown();
  }
});

const portfolioValueInput = document.getElementById("portfolio-value");
const periodSelect = document.getElementById("period-select");
const horizonInput = document.getElementById("horizon-days");
const confidenceSelect = document.getElementById("confidence-select");
const simsInput = document.getElementById("sims-input");

const choleskyToggle = document.getElementById("cholesky-toggle");
const stressSlider = document.getElementById("stress-slider");
const stressAlphaVal = document.getElementById("stress-alpha-val");
const stressBadge = document.getElementById("stress-badge");

const runBtn = document.getElementById("run-btn");
const refreshBtn = document.getElementById("refresh-btn");
const dataBadge = document.getElementById("data-badge");
const errorBanner = document.getElementById("error-banner");

let lastRequestId = 0;
let lastRenderedData = null;
let histGeometry = null;
let sensGeometry = null;
let hasAnimatedEntrance = false;

function validateWeightsField() {
  const rawWeights = weightsInput.value.trim();
  if (!rawWeights) {
    weightsInput.setCustomValidity("");
    return null;
  }
  const weights = rawWeights.split(",").map((w) => Number(w.trim()));
  if (
    weights.length !== selectedTickers.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0) ||
    weights.reduce((a, b) => a + b, 0) <= 0
  ) {
    weightsInput.setCustomValidity("Weights must match ticker count and be positive.");
    return weights;
  }
  weightsInput.setCustomValidity("");
  return weights;
}

function parsePayload(forceRefresh = false) {
  const weights = validateWeightsField();
  return {
    tickers: [...selectedTickers],
    weights,
    period: periodSelect.value,
    portfolioValue: Number(portfolioValueInput.value),
    horizonDays: Number(horizonInput.value),
    confidence: Number(confidenceSelect.value),
    sims: Number(simsInput.value),
    useCholesky: choleskyToggle.checked,
    stressAlpha: Number(stressSlider.value),
    forceRefresh,
  };
}

function setLoading(isLoading, label = "Fetching live NSE data...") {
  runBtn.disabled = isLoading;
  refreshBtn.disabled = isLoading;
  dataBadge.textContent = isLoading ? label : "Live Data Ready";
  dataBadge.className = `status-pill ${isLoading ? "loading" : "ready"}`;
}

function setupHiDpiCanvas(canvas, cssHeight = 280) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(280, Math.round(canvas.clientWidth || 640));
  const height = Math.round(cssHeight);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawHistogram(data) {
  const canvas = document.getElementById("hist-canvas");
  const { ctx, width, height } = setupHiDpiCanvas(canvas, 280);

  const { counts, edges } = data.activeScenario.histogram;
  const varLine = -data.activeScenario.varPct * 100;
  const esLine = -data.activeScenario.esPct * 100;

  const pad = { top: 26, right: 18, bottom: 36, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const minX = edges[0];
  const maxX = edges[edges.length - 1];
  const maxY = Math.max(...counts, 1);

  const xScale = (val) => pad.left + ((val - minX) / (maxX - minX || 1)) * plotW;

  ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  const bars = [];
  for (let i = 0; i < counts.length; i++) {
    const x0 = xScale(edges[i]);
    const x1 = xScale(edges[i + 1]);
    const barH = (counts[i] / maxY) * plotH;
    const mid = (edges[i] + edges[i + 1]) / 2;
    ctx.fillStyle = mid <= varLine ? "rgba(244, 63, 94, 0.8)" : "rgba(56, 189, 248, 0.78)";
    ctx.fillRect(x0, pad.top + plotH - barH, Math.max(1, x1 - x0 - 1), barH);
    bars.push({ x0, x1, count: counts[i], from: edges[i], to: edges[i + 1] });
  }
  histGeometry = { bars, pad, plotH, totalSims: Number(simsInput.value) || 10000 };

  const drawMarker = (xVal, color, label, alignLeft, offsetY) => {
    const x = xScale(xVal);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.font = "600 11px Inter, sans-serif";
    ctx.textAlign = alignLeft ? "right" : "left";
    const textX = alignLeft
      ? Math.max(pad.left + 68, x - 6)
      : Math.min(width - pad.right - 78, x + 6);
    ctx.fillText(label, textX, pad.top + offsetY);
  };

  drawMarker(esLine, "#fb7185", `ES: ${(-esLine).toFixed(2)}%`, true, 14);
  drawMarker(varLine, "#fbbf24", `VaR: ${(-varLine).toFixed(2)}%`, false, 14);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const val = minX + ((maxX - minX) * i) / 5;
    ctx.fillText(`${val.toFixed(1)}%`, xScale(val), height - 12);
  }
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxY * (4 - i)) / 4);
    ctx.fillText(String(val), pad.left - 6, pad.top + (plotH * i) / 4 + 4);
  }
}

function drawSensitivityChart(data) {
  const canvas = document.getElementById("sens-canvas");
  const { ctx, width, height } = setupHiDpiCanvas(canvas, 280);

  const rows = data.sensitivity;
  const sweep = rows.filter((r) => r.alpha >= 0);
  const uncorr = rows.find((r) => r.alpha < 0);

  const pad = { top: 28, right: 20, bottom: 36, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxY = Math.max(...rows.map((r) => r.esPct * 100), data.activeScenario.esPct * 100) * 1.12;
  const minY = Math.max(0, Math.min(...rows.map((r) => r.varPct * 100)) * 0.85);

  const xScale = (corr) => pad.left + corr * plotW;
  const yScale = (pct) => pad.top + plotH - ((pct - minY) / (maxY - minY || 1)) * plotH;

  ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  const drawCurve = (key, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    sweep.forEach((pt, idx) => {
      const x = xScale(pt.avgCorr);
      const y = yScale(pt[key] * 100);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    sweep.forEach((pt) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xScale(pt.avgCorr), yScale(pt[key] * 100), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  drawCurve("varPct", "#fbbf24");
  drawCurve("esPct", "#fb7185");

  if (uncorr) {
    ctx.fillStyle = "#94a3b8";
    ctx.beginPath();
    ctx.arc(xScale(0), yScale(uncorr.varPct * 100), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const activeX = xScale(data.activeScenario.avgCorr);
  const activeY = yScale(data.activeScenario.varPct * 100);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(activeX, activeY, 7.5, 0, Math.PI * 2);
  ctx.stroke();

  sensGeometry = rows.map((r) => ({
    x: xScale(r.avgCorr),
    yVar: yScale(r.varPct * 100),
    row: r,
  }));

  ctx.font = "600 11px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#fbbf24";
  ctx.fillText("VaR (%)", pad.left + 6, 16);
  ctx.fillStyle = "#fb7185";
  ctx.fillText("ES (%)", pad.left + 68, 16);
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("No Cholesky", pad.left + 124, 16);
  ctx.fillStyle = "#38bdf8";
  ctx.fillText("Active", pad.left + 210, 16);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  [0, 0.25, 0.5, 0.75, 1.0].forEach((c) => {
    ctx.fillText(c.toFixed(2), xScale(c), height - 12);
  });
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = minY + ((maxY - minY) * (4 - i)) / 4;
    ctx.fillText(`${val.toFixed(1)}%`, pad.left - 6, pad.top + (plotH * i) / 4 + 4);
  }
}

function drawCorrHeatmap(data) {
  const canvas = document.getElementById("corr-canvas");
  const cssHeight = Math.min(380, Math.max(290, Math.round((canvas.clientWidth || 480) * 0.68)));
  const { ctx, width, height } = setupHiDpiCanvas(canvas, cssHeight);

  const tickers = data.parameters.tickers.map((t) => t.replace(/\.(NS|BO)$/i, ""));
  const matrix = data.parameters.activeCorrMatrix;
  const n = tickers.length;

  const labelFontSize = n > 7 ? 10 : 11;
  ctx.font = `600 ${labelFontSize}px Inter, sans-serif`;
  const maxLabelW = Math.max(...tickers.map((t) => ctx.measureText(t).width), 48);

  const padTop = Math.min(68, Math.max(48, Math.round(maxLabelW * 0.55 + 16)));
  const padBottom = 14;
  const padRight = 16;
  const labelGap = 10;

  const size = Math.max(
    140,
    Math.min(width - maxLabelW - labelGap - padRight - 12, height - padTop - padBottom)
  );
  const cell = size / n;

  // Center the [row-labels + matrix] block horizontally and vertically within the canvas
  const totalBlockW = maxLabelW + labelGap + size;
  const gridX = Math.max(
    maxLabelW + labelGap + 8,
    Math.round((width - totalBlockW) / 2 + maxLabelW + labelGap)
  );
  const gridY = Math.round(padTop + (height - padTop - padBottom - size) / 2);

  const cellFontSize = Math.min(12.5, Math.max(9, cell * 0.24));

  for (let i = 0; i < n; i++) {
    ctx.font = `600 ${labelFontSize}px Inter, sans-serif`;
    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "right";
    ctx.fillText(tickers[i], gridX - labelGap, gridY + i * cell + cell / 2 + 4);

    ctx.save();
    ctx.translate(gridX + i * cell + cell / 2, gridY - 8);
    ctx.rotate(-Math.PI / 6);
    ctx.textAlign = "left";
    ctx.fillText(tickers[i], 0, 0);
    ctx.restore();

    ctx.font = `600 ${cellFontSize}px Inter, sans-serif`;
    for (let j = 0; j < n; j++) {
      const val = matrix[i][j];
      const clamped = Math.max(-1, Math.min(1, val));
      const r = clamped >= 0 ? Math.round(30 + clamped * 205) : 30;
      const g = Math.round(58 + (1 - Math.abs(clamped)) * 65);
      const b = clamped <= 0 ? Math.round(138 + Math.abs(clamped) * 105) : 68;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(gridX + j * cell, gridY + i * cell, cell - 2, cell - 2);

      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.fillText(val.toFixed(2), gridX + j * cell + cell / 2, gridY + i * cell + cell / 2 + cellFontSize * 0.34);
    }
  }
}

function renderTables(data) {
  const p = data.parameters;
  const stocksTbody = document.getElementById("stocks-tbody");
  stocksTbody.innerHTML = p.tickers
    .map(
      (ticker, idx) => `
      <tr>
        <th>${ticker}</th>
        <td>${(p.weights[idx] * 100).toFixed(1)}%</td>
        <td>${formatInr(p.latestPrices[idx])}</td>
        <td>${(p.annualMean[idx] * 100).toFixed(2)}%</td>
        <td>${(p.annualVol[idx] * 100).toFixed(2)}%</td>
      </tr>`
    )
    .join("");

  const sensTbody = document.getElementById("sens-tbody");
  sensTbody.innerHTML = data.sensitivity
    .map((row) => {
      const isMatch = row.scenario === data.activeScenario.label;
      return `
      <tr class="${isMatch ? "active-row" : ""}">
        <th>${row.scenario}</th>
        <td>${row.avgCorr.toFixed(3)}</td>
        <td>${(row.varPct * 100).toFixed(2)}%</td>
        <td>${formatInr(row.varInr)}</td>
        <td>${(row.esPct * 100).toFixed(2)}%</td>
        <td>${formatInr(row.esInr)}</td>
      </tr>`;
    })
    .join("");
}

function updateRiskInsight(data) {
  const s = data.activeScenario;
  const confLabel = `${Math.round(Number(confidenceSelect.value) * 100)}%`;
  const days = Number(horizonInput.value);
  const uncorr = data.sensitivity.find((r) => r.alpha < 0);

  let comparison = "";
  if (uncorr && s.useCholesky && uncorr.varInr > 0) {
    const diffInr = s.varInr - uncorr.varInr;
    const diffPct = ((s.varInr / uncorr.varInr) - 1) * 100;
    document.getElementById("kpi-var-delta").textContent =
      `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}% vs No-Chol`;
    comparison =
      diffInr >= 0
        ? ` Accounting for correlation adds ${formatInr(diffInr)} (+${diffPct.toFixed(1)}%) to VaR compared to an uncorrelated assumption.`
        : "";
  } else {
    document.getElementById("kpi-var-delta").textContent = "Baseline";
  }

  const esMultiple = s.varPct > 0 ? (s.esPct / s.varPct).toFixed(2) : "1.00";
  document.getElementById("kpi-es-ratio").textContent = `${esMultiple}x VaR`;

  document.getElementById("insight-text").textContent =
    `At ${confLabel} confidence over ${days} trading days (${s.label}), portfolio losses stay below ${formatInr(s.varInr)} (${(s.varPct * 100).toFixed(2)}%) in normal months, while the worst tail averages ${formatInr(s.esInr)} (${(s.esPct * 100).toFixed(2)}%).${comparison}`;

  const sims = Number(simsInput.value) || 10000;
  const conf = Number(confidenceSelect.value);
  const tailCount = Math.max(1, Math.round((1 - conf) * sims));
  const portfolioVal = Number(portfolioValueInput.value) || 1000000;

  document.getElementById("guide-var-text").textContent =
    `On a ${formatInr(portfolioVal)} portfolio over ${days} trading days, ${confLabel} VaR of ${formatInr(s.varInr)} (${(s.varPct * 100).toFixed(2)}%) means that in ${confLabel} of simulated futures your loss does not exceed this threshold. Only the worst ${tailCount.toLocaleString()} out of ${sims.toLocaleString()} paths (${Math.round((1 - conf) * 100)}%) lose more than this.`;

  document.getElementById("guide-es-text").textContent =
    `VaR only marks the cutoff line; Expected Shortfall (also called Conditional VaR) averages all ${tailCount.toLocaleString()} tail scenarios beyond VaR. If a rare ${Math.round((1 - conf) * 100)}% crash occurs, your average expected loss is ${formatInr(s.esInr)} (${(s.esPct * 100).toFixed(2)}%), which is ${esMultiple}x your VaR.`;

  if (uncorr) {
    const diffInr = s.varInr - uncorr.varInr;
    const diffPct = uncorr.varInr > 0 ? ((s.varInr / uncorr.varInr) - 1) * 100 : 0;
    document.getElementById("guide-corr-text").textContent =
      `Your stocks currently have an average pairwise correlation of ${s.avgCorr.toFixed(3)}. If you skipped Cholesky decomposition and assumed stocks move independently (corr = 0.000), VaR would look like ${formatInr(uncorr.varInr)} (${(uncorr.varPct * 100).toFixed(2)}%) — ${diffInr >= 0 ? `understating real risk by ${formatInr(diffInr)} (+${diffPct.toFixed(1)}%)` : "matching the uncorrelated baseline"}.`;
  }

  const maxStress = data.sensitivity[data.sensitivity.length - 1];
  if (maxStress) {
    document.getElementById("guide-stress-text").textContent =
      `During market panics, stocks tend to fall together and correlations spike toward 1.0. In the extreme stress regime (avg corr ${maxStress.avgCorr.toFixed(3)}), diversification fails: VaR rises to ${formatInr(maxStress.varInr)} (${(maxStress.varPct * 100).toFixed(2)}%) and ES reaches ${formatInr(maxStress.esInr)} (${(maxStress.esPct * 100).toFixed(2)}%).`;
  }
}

function animateEntrance() {
  if (hasAnimatedEntrance) return;
  hasAnimatedEntrance = true;
  if (
    typeof window.gsap === "undefined" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  window.gsap.from(".kpi-card", {
    y: 18,
    opacity: 0,
    duration: 0.45,
    stagger: 0.08,
    ease: "power2.out",
    clearProps: "transform",
  });
  window.gsap.from(".chart-card, .table-panel, .heatmap-panel", {
    y: 20,
    opacity: 0,
    duration: 0.5,
    stagger: 0.08,
    delay: 0.1,
    ease: "power2.out",
    clearProps: "transform",
  });
}

function renderDashboard(data) {
  lastRenderedData = data;
  const confLabel = `${Math.round(Number(confidenceSelect.value) * 100)}%`;
  const s = data.activeScenario;

  document.getElementById("kpi-conf-var").textContent = confLabel;
  document.getElementById("kpi-conf-es").textContent = confLabel;
  document.getElementById("kpi-var-pct").textContent = `${(s.varPct * 100).toFixed(2)}%`;
  document.getElementById("kpi-var-inr").textContent = formatInr(s.varInr);
  document.getElementById("kpi-es-pct").textContent = `${(s.esPct * 100).toFixed(2)}%`;
  document.getElementById("kpi-es-inr").textContent = formatInr(s.esInr);

  const sign = s.meanReturnPct >= 0 ? "+" : "";
  document.getElementById("kpi-mean-pct").textContent = `${sign}${(s.meanReturnPct * 100).toFixed(2)}%`;
  document.getElementById("kpi-range").textContent =
    `Worst ${(s.worstReturnPct * 100).toFixed(1)}% / Best +${(s.bestReturnPct * 100).toFixed(1)}%`;

  document.getElementById("kpi-corr").textContent = s.avgCorr.toFixed(3);
  document.getElementById("kpi-scenario").textContent = s.label;
  stressBadge.textContent = s.label;

  document.getElementById("hist-meta").textContent =
    `${Number(simsInput.value).toLocaleString()} paths · ${horizonInput.value}d`;
  document.getElementById("obs-meta").textContent =
    `${data.parameters.nObservations} daily returns · Latest: ${data.parameters.latestDate}`;

  updateRiskInsight(data);
  drawHistogram(data);
  drawSensitivityChart(data);
  drawCorrHeatmap(data);
  renderTables(data);
  animateEntrance();
}

async function runSimulation(forceRefresh = false) {
  const payload = parsePayload(forceRefresh);
  if (payload.tickers.length < 2 || payload.tickers.length > 10) {
    errorBanner.textContent = "Select between 2 and 10 Indian stocks before running the simulation.";
    errorBanner.hidden = false;
    stockSearchInput.focus();
    return;
  }
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  errorBanner.hidden = true;
  const reqId = ++lastRequestId;
  setLoading(true, forceRefresh ? "Refreshing live NSE quotes..." : "Running 10,000 simulations...");

  try {
    const resp = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (reqId !== lastRequestId) return;
    if (!resp.ok) {
      throw new Error(data.error || "Simulation failed.");
    }
    weightsInput.setAttribute("aria-invalid", "false");
    renderDashboard(data);
  } catch (err) {
    errorBanner.textContent = err.message;
    errorBanner.hidden = false;
  } finally {
    if (reqId === lastRequestId) {
      setLoading(false);
    }
  }
}

// Interactive tooltips for Histogram & Sensitivity Curve
(() => {
  const histCanvas = document.getElementById("hist-canvas");
  const histTip = document.getElementById("hist-tooltip");
  histCanvas.addEventListener("mousemove", (e) => {
    if (!histGeometry) return;
    const rect = histCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const bar = histGeometry.bars.find((b) => x >= b.x0 && x <= b.x1);
    if (!bar) {
      histTip.hidden = true;
      return;
    }
    const pct = ((bar.count / histGeometry.totalSims) * 100).toFixed(2);
    histTip.innerHTML = `<strong>${bar.from.toFixed(1)}% to ${bar.to.toFixed(1)}%</strong><br>${bar.count.toLocaleString()} paths (${pct}%)`;
    histTip.style.left = `${Math.min(rect.width - 140, Math.max(8, x + 10))}px`;
    histTip.style.top = `${Math.max(8, e.clientY - rect.top - 42)}px`;
    histTip.hidden = false;
  });
  histCanvas.addEventListener("mouseleave", () => {
    histTip.hidden = true;
  });

  const sensCanvas = document.getElementById("sens-canvas");
  const sensTip = document.getElementById("sens-tooltip");
  sensCanvas.addEventListener("mousemove", (e) => {
    if (!sensGeometry?.length) return;
    const rect = sensCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let closest = sensGeometry[0];
    let bestDist = Math.abs(x - closest.x);
    for (const pt of sensGeometry) {
      const d = Math.abs(x - pt.x);
      if (d < bestDist) {
        bestDist = d;
        closest = pt;
      }
    }
    if (bestDist > 26) {
      sensTip.hidden = true;
      return;
    }
    const r = closest.row;
    sensTip.innerHTML = `<strong>${r.scenario}</strong> (r=${r.avgCorr.toFixed(2)})<br>VaR: ${(r.varPct * 100).toFixed(2)}% (${formatInr(r.varInr)})<br>ES: ${(r.esPct * 100).toFixed(2)}% (${formatInr(r.esInr)})`;
    sensTip.style.left = `${Math.min(rect.width - 175, Math.max(8, closest.x + 10))}px`;
    sensTip.style.top = `${Math.max(8, e.clientY - rect.top - 52)}px`;
    sensTip.hidden = false;
  });
  sensCanvas.addEventListener("mouseleave", () => {
    sensTip.hidden = true;
  });
})();

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSimulation(false);
});

refreshBtn.addEventListener("click", () => runSimulation(true));

let sliderDebounce;
stressSlider.addEventListener("input", () => {
  stressAlphaVal.textContent = Number(stressSlider.value).toFixed(2);
  clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(() => runSimulation(false), 120);
});

choleskyToggle.addEventListener("change", () => {
  stressSlider.disabled = !choleskyToggle.checked;
  runSimulation(false);
});

weightsInput.addEventListener("input", () => {
  validateWeightsField();
  if (weightsInput.validity.valid) {
    weightsInput.setAttribute("aria-invalid", "false");
  }
});

[periodSelect, confidenceSelect, portfolioValueInput, horizonInput, simsInput].forEach(
  (el) => {
    el.addEventListener("change", () => {
      if (form.checkValidity() && selectedTickers.length >= 2) {
        runSimulation(false);
      }
    });
  }
);

if (typeof ResizeObserver !== "undefined") {
  let resizeTimer;
  const observer = new ResizeObserver(() => {
    if (!lastRenderedData) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawHistogram(lastRenderedData);
      drawSensitivityChart(lastRenderedData);
      drawCorrHeatmap(lastRenderedData);
    }, 60);
  });
  ["hist-canvas", "sens-canvas", "corr-canvas"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

// Keep initial state clean until the user picks stocks and runs a simulation

// Help modal dialog with light-dismiss fallback
(() => {
  const helpBtn = document.getElementById("help-btn");
  const helpDialog = document.getElementById("help-dialog");
  if (!helpBtn || !helpDialog) return;

  helpBtn.addEventListener("click", () => {
    helpDialog.showModal();
  });

  helpDialog.addEventListener("close", () => {
    helpDialog.returnValue = "";
  });

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const isOutside = (e) => {
      const r = helpDialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    let pressedOutside = false;
    helpDialog.addEventListener("pointerdown", (e) => {
      pressedOutside = isOutside(e);
    });
    helpDialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && isOutside(e)) helpDialog.close();
    });
  }
})();
