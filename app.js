// app.js — single-source UI (no duplicate rendering)
// Expects these element IDs in index.html:
// search, stateFilter, eventFilter, phaseFilter, sortOrder, statusMessage, rowCount, results
// Loads: ./data/incidents.csv
// Uses new headers including: n_numbers, raw_narrative, event_type, phase, etc.

const CSV_URL = "./data/incidents.csv";

const $ = (id) => document.getElementById(id);

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
      if (c === "\r" && next === "\n") i++; // CRLF
      row.push(field);
      field = "";

      if (c === "\n" || c === "\r") {
        // ignore completely empty trailing lines
        if (!(row.length === 1 && row[0] === "")) rows.push(row);
        row = [];
      }
      continue;
    }

    field += c;
  }

  row.push(field);
  if (!(row.length === 1 && row[0] === "")) rows.push(row);

  if (!rows.length) return [];

  // handle BOM on first header
  const headers = rows[0].map((h, idx) => {
    const v = (h ?? "").trim();
    return idx === 0 ? v.replace(/^\uFEFF/, "") : v;
  });

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    const cols = rows[r];
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cols[c] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function uniqSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function setOptions(selectEl, items, allLabel) {
  const current = selectEl.value;
  selectEl.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = allLabel;
  selectEl.appendChild(optAll);

  for (const v of items) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }

  // preserve selection if still available
  if ([...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  } else {
    selectEl.value = "";
  }
}

function parseDateScore(rec) {
  // Prefer ISO-like event_datetime_z, fallback to US event_date, fallback report_date
  const iso = rec.event_datetime_z;
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }

  const us = rec.event_date; // e.g. 8/18/2025
  if (us) {
    const m = us.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const mm = Number(m[1]);
      const dd = Number(m[2]);
      const yyyy = Number(m[3]);
      const t = Date.UTC(yyyy, mm - 1, dd);
      if (!Number.isNaN(t)) return t;
    }
  }

  const rep = rec.report_date; // e.g. 2025-08-26
  if (rep) {
    const t = Date.parse(rep);
    if (!Number.isNaN(t)) return t;
  }

  return 0;
}

function matchesSearch(rec, q) {
  if (!q) return true;
  const hay = [
    rec.raw_narrative,
    rec.city,
    rec.state,
    rec.airport_code,
    rec.facility,
    rec.aircraft_primary,
    rec.aircraft_primary_model,
    rec.n_numbers,
    rec.phase,
    rec.event_type,
    rec.injuries,
    rec.damage,
    rec.pob,
    rec.group_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return hay.includes(q);
}

function buildCard(rec) {
  const city = rec.city || "";
  const state = rec.state || "";
  const airport = rec.airport_code || "";
  const nnums = rec.n_numbers || "";
  const date = rec.event_date || rec.report_date || "";

  const titleParts = [];
  const loc = [city, state].filter(Boolean).join(", ");
  if (loc) titleParts.push(loc);
  if (airport) titleParts.push(airport);
  if (nnums) titleParts.push(nnums);
  if (date) titleParts.push(date);

  const title = titleParts.join(" — ") || "Incident";

  const sub = [rec.aircraft_primary, rec.aircraft_primary_model]
    .filter(Boolean)
    .join(" — ");

  const fields = [
    ["Report Date", rec.report_date],
    ["Event Date/Time (Z)", rec.event_datetime_z],
    ["Event Date", rec.event_date],
    ["Event Time (Z)", rec.event_time_z],
    ["City", rec.city],
    ["State", rec.state],
    ["Airport Code", rec.airport_code],
    ["Facility", rec.facility],
    ["Aircraft", rec.aircraft_primary],
    ["Model", rec.aircraft_primary_model],
    ["N-number(s)", rec.n_numbers],
    ["Phase", rec.phase],
    ["Event Type", rec.event_type],
    ["POB", rec.pob],
    ["Injuries", rec.injuries],
    ["Damage", rec.damage],
    ["Form 8020-9", rec.form_8020_9],
    ["Group ID", rec.group_id],
    ["Group Size", rec.group_size],
    ["Context (parens)", rec.context_parens],
  ].filter(([, v]) => v && v.trim() !== "");

  const card = document.createElement("article");
  card.className = "card";

  const h = document.createElement("div");
  h.className = "cardHeader";

  const h2 = document.createElement("h2");
  h2.className = "cardTitle";
  h2.textContent = title;

  const subEl = document.createElement("div");
  subEl.className = "cardSub";
  subEl.textContent = sub;

  h.appendChild(h2);
  if (sub) h.appendChild(subEl);

  const meta = document.createElement("div");
  meta.className = "meta";

  for (const [label, value] of fields) {
    const row = document.createElement("div");
    row.className = "metaRow";

    const l = document.createElement("div");
    l.className = "metaLabel";
    l.textContent = label;

    const v = document.createElement("div");
    v.className = "metaValue";
    v.textContent = value;

    row.appendChild(l);
    row.appendChild(v);
    meta.appendChild(row);
  }

  const narWrap = document.createElement("div");
  narWrap.className = "narrative";

  const narLabel = document.createElement("div");
  narLabel.className = "narrLabel";
  narLabel.textContent = "Narrative";

  const narText = document.createElement("div");
  narText.className = "narrText";
  narText.textContent = (rec.raw_narrative || "").trim() || "No narrative provided.";

  narWrap.appendChild(narLabel);
  narWrap.appendChild(narText);

  card.appendChild(h);
  card.appendChild(meta);
  card.appendChild(narWrap);

  return card;
}

function render(records, ui) {
  const q = (ui.search.value || "").trim().toLowerCase();
  const state = ui.state.value;
  const eventType = ui.event.value;
  const phase = ui.phase.value;
  const sort = ui.sort.value || "newest";

  let filtered = records.filter((r) => {
    if (state && (r.state || "") !== state) return false;
    if (eventType && (r.event_type || "") !== eventType) return false;
    if (phase && (r.phase || "") !== phase) return false;
    if (!matchesSearch(r, q)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const da = parseDateScore(a);
    const db = parseDateScore(b);
    return sort === "oldest" ? da - db : db - da;
  });

  ui.results.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const r of filtered) frag.appendChild(buildCard(r));
  ui.results.appendChild(frag);

  ui.rowCount.textContent = `Rows detected: ${records.length}`;
}

async function init() {
  const ui = {
    search: $("search"),
    state: $("stateFilter"),
    event: $("eventFilter"),
    phase: $("phaseFilter"),
    sort: $("sortOrder"),
    status: $("statusMessage"),
    rowCount: $("rowCount"),
    results: $("results"),
  };

  // If any IDs are missing, fail loudly (prevents “ghost” UI behavior)
  for (const [k, el] of Object.entries(ui)) {
    if (!el) throw new Error(`Missing required element id="${k === "status" ? "statusMessage" : k}"`);
  }

  ui.status.textContent = "Loading data…";

  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${CSV_URL}: ${res.status} ${res.statusText}`);
  const text = await res.text();

  const records = parseCSV(text);

  // Populate dropdowns from CSV
  setOptions(ui.state, uniqSorted(records.map((r) => r.state)), "All states");
  setOptions(ui.event, uniqSorted(records.map((r) => r.event_type)), "All event types");
  setOptions(ui.phase, uniqSorted(records.map((r) => r.phase)), "All phases");

  ui.status.textContent = "";
  render(records, ui);

  let t = null;
  const rerender = () => {
    clearTimeout(t);
    t = setTimeout(() => render(records, ui), 80);
  };

  ui.search.addEventListener("input", rerender);
  ui.state.addEventListener("change", rerender);
  ui.event.addEventListener("change", rerender);
  ui.phase.addEventListener("change", rerender);
  ui.sort.addEventListener("change", rerender);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    const status = $("statusMessage");
    if (status) status.textContent = `Error: ${err.message}`;
    console.error(err);
  });
});
