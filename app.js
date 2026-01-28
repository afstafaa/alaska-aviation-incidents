/* app.js (auto-detects narrative column)
   Works with your index.html IDs:
   search, stateFilter, eventFilter, phaseFilter, sortOrder
   statusMessage, rowCount, results
   Loads: ./data/incidents.csv
*/

const CSV_PATH = "./data/incidents.csv";

const $ = (id) => document.getElementById(id);

let ALL_ROWS = [];
let FILTERED_ROWS = [];

// ---------------- CSV parsing (quoted fields + commas + newlines) ----------------
function parseCsv(text) {
  const out = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  text = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        out.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }

  row.push(field);
  if (row.some((x) => String(x).trim() !== "")) out.push(row);
  return out;
}

function safe(v) {
  return v == null ? "" : String(v);
}
function norm(v) {
  return safe(v).trim();
}
function upper(v) {
  return norm(v).toUpperCase();
}
function lower(v) {
  return norm(v).toLowerCase();
}
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

// ---------------- Date helpers ----------------
function parseUSDate(s) {
  s = norm(s);
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const yy = Number(m[3]);
    const d = new Date(Date.UTC(yy, mm - 1, dd));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatNiceDate(event_date, event_time_z) {
  const d = parseUSDate(event_date);
  const tz = norm(event_time_z);
  if (!d) return tz ? `${event_date} (${tz})` : (event_date || "");
  const ds = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC"
  });
  return tz ? `${ds} (${tz})` : ds;
}

// ---------------- Narrative auto-detection ----------------
function detectNarrativeKey(headers) {
  // Prefer these keywords in this order
  const priority = [
    "context",
    "narrative",
    "raw narrative",
    "raw_narrative",
    "details",
    "description",
    "summary",
    "remarks",
    "notes",
    "text"
  ];

  const lowered = headers.map((h) => ({
    raw: h,
    clean: lower(h).replace(/\uFEFF/g, "") // strip BOM if present
  }));

  // 1) direct match by keyword (contains)
  for (const key of priority) {
    const found = lowered.find((h) => h.clean === key || h.clean.includes(key));
    if (found) return found.raw;
  }

  // 2) heuristic: any header that contains "narr" or "context"
  const heur = lowered.find((h) => h.clean.includes("narr") || h.clean.includes("context"));
  if (heur) return heur.raw;

  return ""; // none found
}

function getNarrative(obj, narrativeKey) {
  if (narrativeKey && obj[narrativeKey] != null && String(obj[narrativeKey]).trim() !== "") {
    return safe(obj[narrativeKey]);
  }
  // fallback to common exact keys
  return safe(pick(obj, ["context", "narrative", "details", "description", "summary"]));
}

// ---------------- Mapping ----------------
function mapRow(headers, values, narrativeKey) {
  const obj = {};
  headers.forEach((h, idx) => (obj[h] = values[idx] ?? ""));

  const report_date = norm(pick(obj, ["report_date", "Report Date"]));
  const event_date = norm(pick(obj, ["event_date", "Event Date"]));
  const event_time_z = norm(pick(obj, ["event_time_z", "event_time", "time_z"]));

  const city = norm(pick(obj, ["city", "City"]));
  const state = upper(pick(obj, ["state", "State"]));
  const airport = upper(pick(obj, ["airport_code", "airport", "Airport", "facility_code"]));
  const facility = norm(pick(obj, ["facility", "Facility"]));

  const n_numbers = norm(pick(obj, ["n_numbers", "aircraft_1_nnumber", "registration", "tail", "aircraft_primary"]));
  const model = norm(pick(obj, ["aircraft_primary_model", "aircraft_1_type", "model"]));

  const phase = norm(pick(obj, ["phase", "Phase"]));
  const event_type = norm(pick(obj, ["event_type", "Event Type"]));
  const pob = norm(pick(obj, ["pob", "POB"]));
  const injuries = norm(pick(obj, ["injuries", "Injuries"]));
  const damage = norm(pick(obj, ["damage", "Damage"]));
  const form8020 = norm(pick(obj, ["form_8020_9", "8020-9", "form8020"]));

  const narrative = getNarrative(obj, narrativeKey);

  const d = parseUSDate(event_date) || parseUSDate(report_date);
  const sort_ts = d ? d.getTime() : 0;

  const searchBlob = lower(
    [
      city,
      state,
      airport,
      facility,
      n_numbers,
      model,
      phase,
      event_type,
      pob,
      injuries,
      damage,
      form8020,
      narrative
    ].filter(Boolean).join(" | ")
  );

  return {
    ...obj,
    __report_date: report_date,
    __event_date: event_date,
    __event_time_z: event_time_z,
    __city: city,
    __state: state,
    __airport: airport,
    __facility: facility,
    __n_numbers: n_numbers,
    __model: model,
    __phase: phase,
    __event_type: event_type,
    __pob: pob,
    __injuries: injuries,
    __damage: damage,
    __form8020: form8020,
    __narrative: narrative,
    __sort_ts: sort_ts,
    __search: searchBlob
  };
}

// ---------------- UI helpers ----------------
function fillSelect(selectEl, values, placeholder) {
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
}

function chip(label, value) {
  const span = document.createElement("span");
  span.className = "chip";
  span.innerHTML = `<b>${label}:</b> ${value && String(value).trim() ? String(value).trim() : "—"}`;
  return span;
}

function renderCard(r) {
  const card = document.createElement("div");
  card.className = "card";

  const location = [r.__city, r.__state].filter(Boolean).join(", ") || "Unknown location";
  const dateLine = formatNiceDate(r.__event_date, r.__event_time_z) || "Unknown date";

  const line1 = document.createElement("div");
  line1.className = "cardHeadLine1";
  line1.textContent = `${location} — ${dateLine}`;
  card.appendChild(line1);

  const line2 = document.createElement("div");
  line2.className = "cardHeadLine2";
  const reg = r.__n_numbers || "Unknown registration";
  const model = r.__model ? ` • ${r.__model}` : "";
  const apt = r.__airport ? ` • ${r.__airport}` : "";
  const fac = r.__facility ? ` • ${r.__facility}` : "";
  line2.textContent = `${reg}${model}${apt}${fac}`;
  card.appendChild(line2);

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "chips";
  chipsWrap.appendChild(chip("Report", r.__report_date));
  chipsWrap.appendChild(chip("Phase", r.__phase));
  chipsWrap.appendChild(chip("Type", r.__event_type));
  chipsWrap.appendChild(chip("POB", r.__pob));
  chipsWrap.appendChild(chip("Injuries", r.__injuries));
  chipsWrap.appendChild(chip("Damage", r.__damage));
  chipsWrap.appendChild(chip("8020-9", r.__form8020));
  card.appendChild(chipsWrap);

  const narrWrap = document.createElement("div");
  narrWrap.className = "narrWrap";

  const narr = r.__narrative && r.__narrative.trim() ? r.__narrative : "No narrative provided.";

  const preview = document.createElement("div");
  preview.className = "narrPreview";
  preview.textContent = narr;

  const full = document.createElement("div");
  full.className = "narrFull";
  full.textContent = narr;

  narrWrap.appendChild(preview);
  narrWrap.appendChild(full);
  card.appendChild(narrWrap);

  const needsExpand = narr.length > 220 || narr.includes("\n");
  if (needsExpand) {
    const actions = document.createElement("div");
    actions.className = "cardActions";

    const btn = document.createElement("button");
    btn.className = "expandBtn";
    btn.type = "button";
    btn.textContent = "Expand";

    btn.addEventListener("click", () => {
      const expanded = card.classList.toggle("expanded");
      btn.textContent = expanded ? "Collapse" : "Expand";
    });

    actions.appendChild(btn);
    card.appendChild(actions);
  }

  return card;
}

function applyFilters() {
  const q = lower($("search").value);
  const state = $("stateFilter").value;
  const eventType = $("eventFilter").value;
  const phase = $("phaseFilter").value;
  const sort = $("sortOrder").value;

  FILTERED_ROWS = ALL_ROWS.filter((r) => {
    if (q && !r.__search.includes(q)) return false;
    if (state && r.__state !== state) return false;
    if (eventType && r.__event_type !== eventType) return false;
    if (phase && r.__phase !== phase) return false;
    return true;
  });

  if (sort === "newest") FILTERED_ROWS.sort((a, b) => b.__sort_ts - a.__sort_ts);
  if (sort === "oldest") FILTERED_ROWS.sort((a, b) => a.__sort_ts - b.__sort_ts);

  return FILTERED_ROWS;
}

function render() {
  const resultsEl = $("results");
  resultsEl.innerHTML = "";

  const rows = applyFilters();
  $("rowCount").textContent = `Rows detected: ${rows.length}`;

  for (const r of rows) resultsEl.appendChild(renderCard(r));
}

// ---------------- Init ----------------
async function init() {
  $("statusMessage").textContent = "Loading data…";
  $("rowCount").textContent = "Rows detected: 0";

  try {
    const resp = await fetch(CSV_PATH, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Unable to load CSV (${resp.status})`);
    const text = await resp.text();

    const parsed = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ""));
    if (!parsed.length) throw new Error("CSV appears empty");

    // Strip BOM from first header if present
    let headers = parsed[0].map((h) => norm(h).replace(/\uFEFF/g, ""));
    const dataRows = parsed.slice(1);

    const narrativeKey = detectNarrativeKey(headers);

    ALL_ROWS = dataRows.map((vals) => mapRow(headers, vals, narrativeKey));

    const states = Array.from(new Set(ALL_ROWS.map((r) => r.__state).filter(Boolean))).sort();
    const types = Array.from(new Set(ALL_ROWS.map((r) => r.__event_type).filter(Boolean))).sort();
    const phases = Array.from(new Set(ALL_ROWS.map((r) => r.__phase).filter(Boolean))).sort();

    fillSelect($("stateFilter"), states, "All states");
    fillSelect($("eventFilter"), types, "All event types");
    fillSelect($("phaseFilter"), phases, "All phases");

    $("search").addEventListener("input", render);
    $("stateFilter").addEventListener("change", render);
    $("eventFilter").addEventListener("change", render);
    $("phaseFilter").addEventListener("change", render);
    $("sortOrder").addEventListener("change", render);

    // Helpful status info
    $("statusMessage").textContent = narrativeKey
      ? `Loaded OK (narrative column: ${narrativeKey})`
      : "Loaded OK";

    $("rowCount").textContent = `Rows detected: ${ALL_ROWS.length}`;
    render();
  } catch (err) {
    console.error(err);
    $("statusMessage").textContent = `Load failed: ${err.message}`;
    $("rowCount").textContent = "Rows detected: 0";
  }
}

document.addEventListener("DOMContentLoaded", init);
