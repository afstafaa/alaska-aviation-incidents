/* app.js - Alaska Aviation Incidents (GitHub Pages, client-side)
   Expects: /index.html with ids:
   q, state, eventType, phase, sort, download, reset, results, status, count
   Data: ./data/incidents.csv
*/

const CSV_PATH = "./data/incidents.csv";

// If true, ONLY removes obvious non-narrative footer strings.
// Set to false to show narrative 100% raw, unchanged.
const STRIP_BOILERPLATE = true;

// How many characters to show before "Expand"
const NARRATIVE_PREVIEW_CHARS = 380;

const $ = (id) => document.getElementById(id);

let rows = [];
let filtered = [];

// ---------- Utilities ----------
function safeText(v) {
  return v == null ? "" : String(v);
}

function norm(v) {
  return safeText(v).trim();
}

function upper(v) {
  return norm(v).toUpperCase();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}

function cleanInternalBoilerplate(text) {
  if (!text) return "";
  let t = String(text);

  // normalize CRLF
  t = t.replace(/\r\n/g, "\n");

  // remove ONLY these known footer/header strings
  const patterns = [
    /Page\s+\d+\s+FOR\s+OFFICIAL\s+USE\s+ONLY/gi,
    /FOR\s+OFFICIAL\s+USE\s+ONLY/gi,
    /\(Public availability to be determined under Title 5 USC 552\)/gi
  ];

  for (const re of patterns) t = t.replace(re, "");

  // tidy whitespace introduced by removals (doesn't alter meaning)
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n").trim();

  return t;
}

function getNarrative(obj) {
  // Your CSV screenshot shows "context"; some versions use "narrative"
  const raw = pick(obj, ["context", "narrative", "summary", "details"]);
  if (!raw) return "";
  if (!STRIP_BOILERPLATE) return safeText(raw);
  const cleaned = cleanInternalBoilerplate(raw);
  // if cleaner removes too much, fall back to raw
  return cleaned || safeText(raw);
}

function parseUSDate(maybe) {
  // accepts: 9/1/2025 or 08/18/2025 or 2025-09-02, returns Date or null
  const s = norm(maybe);
  if (!s) return null;

  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // M/D/YYYY or MM/DD/YYYY
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

function formatDateForHeader(eventDate, eventTimeZ) {
  const d = parseUSDate(eventDate);
  const t = norm(eventTimeZ);
  // If we have a date, show nice; else return raw
  if (d) {
    const opts = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
    const dateStr = d.toLocaleDateString("en-US", opts);
    return t ? `${dateStr} (${t})` : dateStr;
  }
  return eventDate || "";
}

function buildCSVLine(fields) {
  // basic CSV quoting
  return fields.map((v) => {
    const s = safeText(v);
    if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(",");
}

function downloadCSV(filename, dataRows, headers) {
  const lines = [];
  lines.push(buildCSVLine(headers));
  for (const r of dataRows) {
    lines.push(buildCSVLine(headers.map((h) => r[h] ?? "")));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ---------- CSV Parser (handles quoted fields) ----------
function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { // escaped quote
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
        continue;
      }
      if (c === "\r") { // ignore
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }

  // flush last field/row
  row.push(field);
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);

  return rows;
}

// ---------- Data mapping ----------
function mapRow(headers, values) {
  const obj = {};
  headers.forEach((h, idx) => {
    obj[h] = values[idx] ?? "";
  });

  // Normalize key fields we use in UI, but keep original columns intact too.
  obj.__report_date = norm(pick(obj, ["report_date", "Report Date", "reportDate"]));
  obj.__event_date = norm(pick(obj, ["event_date", "Event Date", "eventDate"]));
  obj.__event_time_z = norm(pick(obj, ["event_time_z", "event_time", "time_z", "eventTimeZ"]));
  obj.__state = upper(pick(obj, ["state", "State"]));
  obj.__city = norm(pick(obj, ["city", "City"]));
  obj.__airport_code = upper(pick(obj, ["airport_code", "airport", "Airport"]));
  obj.__facility = norm(pick(obj, ["facility", "Facility"]));
  obj.__n_numbers = norm(pick(obj, ["n_numbers", "aircraft_1_nnumber", "registration", "tail", "Tail", "aircraft_primary"]));
  obj.__aircraft_model = norm(pick(obj, ["aircraft_primary_model", "aircraft_1_type", "model", "Model"]));
  obj.__phase = norm(pick(obj, ["phase", "Phase"]));
  obj.__event_type = norm(pick(obj, ["event_type", "Event Type", "eventType"]));
  obj.__pob = norm(pick(obj, ["pob", "POB"]));
  obj.__injuries = norm(pick(obj, ["injuries", "Injuries"]));
  obj.__damage = norm(pick(obj, ["damage", "Damage"]));
  obj.__form8020 = norm(pick(obj, ["form_8020_9", "8020-9", "form8020"]));
  obj.__narrative = getNarrative(obj);

  // For searching
  obj.__search = lower([
    obj.__city, obj.__state, obj.__airport_code, obj.__facility,
    obj.__n_numbers, obj.__aircraft_model, obj.__phase, obj.__event_type,
    obj.__damage, obj.__injuries, obj.__narrative
  ].filter(Boolean).join(" | "));

  // Sort key (prefer event_date + time; fallback report_date)
  const d = parseUSDate(obj.__event_date) || parseUSDate(obj.__report_date);
  obj.__sort_ts = d ? d.getTime() : 0;

  return obj;
}

// ---------- UI ----------
function fillSelect(selectEl, values, placeholder) {
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function render() {
  const q = lower($("q").value);
  const state = $("state").value;
  const eventType = $("eventType").value;
  const phase = $("phase").value;
  const sort = $("sort").value;

  filtered = rows.filter((r) => {
    if (q && !r.__search.includes(q)) return false;
    if (state && r.__state !== state) return false;
    if (eventType && r.__event_type !== eventType) return false;
    if (phase && r.__phase !== phase) return false;
    return true;
  });

  if (sort === "newest") filtered.sort((a, b) => (b.__sort_ts - a.__sort_ts));
  if (sort === "oldest") filtered.sort((a, b) => (a.__sort_ts - b.__sort_ts));

  $("count").textContent = `${filtered.length} shown`;
  $("status").textContent = `Loaded: OK`;

  const results = $("results");
  results.innerHTML = "";

  for (const r of filtered) {
    results.appendChild(renderCard(r));
  }
}

function pill(label, value) {
  const span = document.createElement("span");
  span.className = "pill";
  span.innerHTML = `<strong>${label}:</strong> ${value || "—"}`;
  return span;
}

function renderCard(r) {
  const card = document.createElement("div");
  card.className = "card";

  // Header line (Location / Date)
  const h = document.createElement("div");
  h.className = "card-title";

  const location = [r.__city, r.__state].filter(Boolean).join(", ") || "Unknown location";
  const dateLine = formatDateForHeader(r.__event_date, r.__event_time_z) || "Unknown date";

  h.textContent = `${location} — ${dateLine}`;
  card.appendChild(h);

  // Subheader (Registration / Model / Airport)
  const sub = document.createElement("div");
  sub.className = "card-sub";

  const reg = r.__n_numbers ? r.__n_numbers : "Unknown registration";
  const model = r.__aircraft_model ? r.__aircraft_model : "Unknown model";
  const apt = r.__airport_code ? r.__airport_code : "";
  const facility = r.__facility ? r.__facility : "";

  const left = document.createElement("div");
  left.className = "sub-left";
  left.textContent = `${reg}${model ? " • " + model : ""}${apt ? " • " + apt : ""}${facility ? " • " + facility : ""}`;

  const right = document.createElement("div");
  right.className = "sub-right";
  right.textContent = r.__event_type ? r.__event_type.toUpperCase() : "";

  sub.appendChild(left);
  sub.appendChild(right);
  card.appendChild(sub);

  // Pills (NTSB-ish factual fields)
  const pills = document.createElement("div");
  pills.className = "pills";
  pills.appendChild(pill("Report", r.__report_date));
  pills.appendChild(pill("Phase", r.__phase));
  pills.appendChild(pill("Type", r.__event_type));
  pills.appendChild(pill("POB", r.__pob));
  pills.appendChild(pill("Injuries", r.__injuries));
  pills.appendChild(pill("Damage", r.__damage));
  pills.appendChild(pill("8020-9", r.__form8020));
  card.appendChild(pills);

  // Factual Information (raw narrative)
  const section = document.createElement("div");
  section.className = "section";

  const sectionTitle = document.createElement("div");
  sectionTitle.className = "section-title";
  sectionTitle.textContent = "Factual Information";
  section.appendChild(sectionTitle);

  const narrativeText = r.__narrative ? r.__narrative : "No narrative provided.";
  const narrative = document.createElement("div");
  narrative.className = "narrative";

  const shortText =
    narrativeText.length > NARRATIVE_PREVIEW_CHARS
      ? narrativeText.slice(0, NARRATIVE_PREVIEW_CHARS).trim() + "…"
      : narrativeText;

  narrative.textContent = shortText;
  section.appendChild(narrative);

  if (narrativeText.length > NARRATIVE_PREVIEW_CHARS) {
    const btn = document.createElement("button");
    btn.className = "expand";
    btn.type = "button";
    btn.textContent = "Expand";
    let expanded = false;

    btn.addEventListener("click", () => {
      expanded = !expanded;
      narrative.textContent = expanded ? narrativeText : shortText;
      btn.textContent = expanded ? "Collapse" : "Expand";
    });

    section.appendChild(btn);
  }

  card.appendChild(section);

  return card;
}

// ---------- Init ----------
async function init() {
  $("status").textContent = "Loading…";

  try {
    const resp = await fetch(CSV_PATH, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Unable to load CSV (${resp.status})`);
    const csvText = await resp.text();

    const parsed = parseCsv(csvText).filter((r) => r.some((c) => String(c).trim() !== ""));
    if (!parsed.length) throw new Error("CSV appears empty");

    const headers = parsed[0].map((h) => norm(h));
    const data = parsed.slice(1);

    rows = data.map((vals) => mapRow(headers, vals));

    // Build filter options from data
    const states = Array.from(new Set(rows.map((r) => r.__state).filter(Boolean))).sort();
    const types = Array.from(new Set(rows.map((r) => r.__event_type).filter(Boolean))).sort();
    const phases = Array.from(new Set(rows.map((r) => r.__phase).filter(Boolean))).sort();

    fillSelect($("state"), states, "All states");
    fillSelect($("eventType"), types, "All event types");
    fillSelect($("phase"), phases, "All phases");

    // sort options
    $("sort").innerHTML = "";
    [
      ["newest", "Newest"],
      ["oldest", "Oldest"]
    ].forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      $("sort").appendChild(opt);
    });

    // Wire events
    ["q", "state", "eventType", "phase", "sort"].forEach((id) => {
      $(id).addEventListener("input", render);
      $(id).addEventListener("change", render);
    });

    $("reset").addEventListener("click", () => {
      $("q").value = "";
      $("state").value = "";
      $("eventType").value = "";
      $("phase").value = "";
      $("sort").value = "newest";
      render();
    });

    $("download").addEventListener("click", () => {
      // Download the currently filtered data but keep original headers (best-effort)
      const headersOut = headers;
      downloadCSV("incidents_filtered.csv", filtered, headersOut);
    });

    $("status").textContent = "Loaded: OK";
    $("count").textContent = `${rows.length} loaded`;

    render();
  } catch (e) {
    console.error(e);
    $("status").textContent = `Load failed: ${e.message}`;
    $("count").textContent = "0 shown";
  }
}

document.addEventListener("DOMContentLoaded", init);
