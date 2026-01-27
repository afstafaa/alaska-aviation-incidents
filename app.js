/* app.js — GitHub Pages, no build, reads ./data/incidents.csv */

const CSV_PATH = "./data/incidents.csv";

// ---- DOM ----
const $ = (id) => document.getElementById(id);

const elQ = $("q");
const elState = $("state");
const elEventType = $("eventType");
const elPhase = $("phase");
const elSort = $("sort");
const elDownload = $("download");
const elReset = $("reset");

const elShown = $("shown");
const elLoaded = $("loaded");
const elResults = $("results");
const elErrors = $("errors");
const elCsvPath = $("csvPath");

// ---- Helpers ----
function setStatus(text) {
  if (elLoaded) elLoaded.textContent = text;
}

function showError(msg) {
  if (!elErrors) return;
  elErrors.style.display = "block";
  elErrors.textContent = msg;
}

function clearError() {
  if (!elErrors) return;
  elErrors.style.display = "none";
  elErrors.textContent = "";
}

function safe(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeHeader(h) {
  return safe(h).toLowerCase().replace(/\s+/g, "_");
}

function parseDateish(row) {
  // Prefer event_date; fallback report_date; fallback event_datetime_z
  const d =
    safe(row.event_date) ||
    safe(row.report_date) ||
    safe(row.event_datetime_z) ||
    "";
  // Try Date parse; if not parseable, return NaN-safe
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}

function formatPrettyDate(row) {
  // event_date in your CSV is like 8/31/2025 or 2025-08-31
  const raw = safe(row.event_date) || safe(row.report_date) || "";
  if (!raw) return "Unknown date";
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return raw;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function titleLocation(row) {
  const city = safe(row.city) || "Unknown location";
  const state = safe(row.state);
  return state ? `${city}, ${state}` : city;
}

function shortText(text, max = 160) {
  const t = safe(text);
  if (!t) return "";
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + "…";
}

function asUpper(v) {
  const t = safe(v);
  return t ? t.toUpperCase() : "";
}

// Robust CSV parser (handles quotes, commas, and newlines inside quotes)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r") {
        // ignore
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }

  // last field
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Remove fully empty rows
  return rows.filter((r) => r.some((cell) => safe(cell) !== ""));
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = safe(r[idx]);
    });
    out.push(obj);
  }
  return out;
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function fillSelect(selectEl, values, placeholderText) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholderText;
  selectEl.appendChild(opt0);

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function escapeCsvValue(v) {
  const s = safe(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, headers, rows) {
  const lines = [];
  lines.push(headers.join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvValue(r[h])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- App state ----
let ALL = [];
let FILTERED = [];
let HEADERS = [];

function normalizeRow(r) {
  // Normalize the key names we use everywhere
  // (Your CSV has these: report_date, event_date, event_time_z, city, state,
  // airport_code, facility, aircraft_primary, aircraft_primary_model, n_number,
  // phase, event_type, pob, injuries, damage, raw_narrative ...)
  const row = { ...r };

  // Narrative: prefer raw_narrative, fallback narrative
  row.narrative = safe(row.raw_narrative) || safe(row.narrative) || "";

  // Fix weird encoding artifacts if any (safe)
  row.narrative = row.narrative
    .replace(/\uFFFD/g, "")   // replacement chars
    .replace(/\s+/g, " ")
    .trim();

  return row;
}

function buildFiltersFromData(data) {
  const states = uniqSorted(data.map((r) => safe(r.state)));
  const eventTypes = uniqSorted(data.map((r) => safe(r.event_type)));
  const phases = uniqSorted(data.map((r) => safe(r.phase)));

  fillSelect(elState, states, "State (all)");
  fillSelect(elEventType, eventTypes, "Event type (all)");
  fillSelect(elPhase, phases, "Phase (all)");
}

function matchSearch(row, q) {
  if (!q) return true;
  const needle = q.toLowerCase();

  const hay = [
    row.narrative,
    row.city,
    row.state,
    row.airport_code,
    row.facility,
    row.aircraft_primary,
    row.aircraft_primary_model,
    row.n_number,
    row.event_type,
    row.phase,
  ]
    .map(safe)
    .join(" | ")
    .toLowerCase();

  return hay.includes(needle);
}

function applyFilters() {
  const q = safe(elQ?.value).toLowerCase();
  const state = safe(elState?.value);
  const eventType = safe(elEventType?.value);
  const phase = safe(elPhase?.value);
  const sort = safe(elSort?.value) || "newest";

  let out = ALL.filter((r) => {
    if (state && safe(r.state) !== state) return false;
    if (eventType && safe(r.event_type) !== eventType) return false;
    if (phase && safe(r.phase) !== phase) return false;
    if (!matchSearch(r, q)) return false;
    return true;
  });

  out.sort((a, b) => {
    const ta = parseDateish(a);
    const tb = parseDateish(b);
    if (sort === "oldest") return ta - tb;
    return tb - ta; // newest
  });

  FILTERED = out;
  render();
}

function makeMetaSpan(label, value) {
  const span = document.createElement("span");
  span.innerHTML = `<b>${label}:</b> ${safe(value) || "—"}`;
  return span;
}

function renderCard(row) {
  const card = document.createElement("div");
  card.className = "card";

  const top = document.createElement("div");
  top.className = "cardTop";

  const title = document.createElement("h3");
  title.className = "title";
  title.textContent = `${titleLocation(row)} — ${formatPrettyDate(row)}`;

  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = safe(row.event_type) ? asUpper(row.event_type) : "EVENT";

  top.appendChild(title);
  top.appendChild(tag);

  const meta = document.createElement("div");
  meta.className = "meta";

  meta.appendChild(makeMetaSpan("Facility", row.facility));
  meta.appendChild(makeMetaSpan("Tail", row.n_number));
  meta.appendChild(makeMetaSpan("Model", row.aircraft_primary_model || row.aircraft_primary));
  meta.appendChild(makeMetaSpan("Phase", row.phase));
  meta.appendChild(makeMetaSpan("POB", row.pob));
  meta.appendChild(makeMetaSpan("Injuries", row.injuries));
  meta.appendChild(makeMetaSpan("Damage", row.damage));

  const narr = document.createElement("p");
  narr.className = "narr";

  const full = safe(row.narrative);
  narr.textContent = full ? shortText(full, 180) : "No narrative provided.";

  card.appendChild(top);
  card.appendChild(meta);
  card.appendChild(narr);

  if (full && full.length > 180) {
    const btn = document.createElement("button");
    btn.className = "view-full";
    let expanded = false;

    btn.textContent = "View full";
    btn.addEventListener("click", () => {
      expanded = !expanded;
      narr.textContent = expanded ? full : shortText(full, 180);
      btn.textContent = expanded ? "Show less" : "View full";
    });

    card.appendChild(btn);
  }

  return card;
}

function render() {
  if (elShown) elShown.textContent = `${FILTERED.length} shown`;
  if (elResults) elResults.innerHTML = "";

  if (!FILTERED.length) return;

  const grid = document.createElement("div");
  grid.className = "grid";

  FILTERED.forEach((r) => {
    grid.appendChild(renderCard(r));
  });

  elResults.appendChild(grid);
}

// ---- Init ----
async function init() {
  try {
    clearError();
    if (elCsvPath) elCsvPath.textContent = CSV_PATH;
    setStatus("Loading…");

    const res = await fetch(CSV_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);

    const csvText = await res.text();
    const parsed = parseCSV(csvText);
    if (!parsed.length) throw new Error("CSV appears empty.");

    HEADERS = parsed[0].map(normalizeHeader);
    const objs = rowsToObjects(parsed).map(normalizeRow);

    ALL = objs;
    buildFiltersFromData(ALL);

    setStatus("OK");
    applyFilters();
  } catch (err) {
    setStatus("—");
    showError(err?.message || String(err));
  }
}

// ---- Events ----
function wireEvents() {
  const onChange = () => applyFilters();

  elQ?.addEventListener("input", onChange);
  elState?.addEventListener("change", onChange);
  elEventType?.addEventListener("change", onChange);
  elPhase?.addEventListener("change", onChange);
  elSort?.addEventListener("change", onChange);

  elReset?.addEventListener("click", () => {
    if (elQ) elQ.value = "";
    if (elState) elState.value = "";
    if (elEventType) elEventType.value = "";
    if (elPhase) elPhase.value = "";
    if (elSort) elSort.value = "newest";
    applyFilters();
  });

  elDownload?.addEventListener("click", () => {
    if (!FILTERED.length) return;
    // Download only the columns we actually have in the file (HEADERS)
    const filename = "incidents_filtered.csv";
    downloadCsv(filename, HEADERS, FILTERED);
  });
}

wireEvents();
init();
