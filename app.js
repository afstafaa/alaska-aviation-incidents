/* app.js — static GitHub Pages incident viewer (CSV -> cards) */

const CSV_PATH = "./data/incidents.csv";

const el = (id) => document.getElementById(id);

const statusMessage = el("statusMessage");
const rowCountEl = el("rowCount");
const resultsEl = el("results");

const searchEl = el("search");
const stateFilterEl = el("stateFilter");
const eventFilterEl = el("eventFilter");
const phaseFilterEl = el("phaseFilter");
const sortOrderEl = el("sortOrder");

let allRows = [];
let filteredRows = [];

function norm(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function upper(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : "";
}

function pickRowValue(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && norm(row[k]) !== "") return row[k];
  }
  return "";
}

function firstTail(nNumbers) {
  // n_numbers might contain "N2996C; N6397V; N8241A"
  const s = norm(nNumbers);
  if (!s) return "";
  return s.split(/[,;]+/).map(x => x.trim()).filter(Boolean)[0] || "";
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text) {
  // Handles quoted fields, commas, and newlines inside quotes
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
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ignore
      } else {
        field += c;
      }
    }
  }

  // last line
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  // remove empty trailing rows
  return rows.filter(r => r.some(cell => norm(cell) !== ""));
}

function buildObjects(parsed) {
  if (!parsed.length) return { headers: [], data: [] };
  const headers = parsed[0].map(h => norm(h));
  const data = parsed.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    return obj;
  });
  return { headers, data };
}

function formatZandAKDT(eventDate, eventTimeZ, eventDateTimeZ) {
  // Prefer event_datetime_z ISO; fallback to date + timeZ.
  // Returns "(2018Z / 11:18 AKDT)" style when possible.
  const tZ = upper(eventTimeZ);
  let zPart = tZ ? tZ : "";

  // Try to produce AK local time using Intl if we have a real ISO timestamp.
  let iso = norm(eventDateTimeZ);
  if (!iso) {
    // build an ISO if possible
    const d = norm(eventDate);
    if (d && tZ) {
      // expects time like 2018Z or 2018
      const hh = tZ.replace("Z", "").padStart(4, "0").slice(0, 2);
      const mm = tZ.replace("Z", "").padStart(4, "0").slice(2, 4);
      // Create a UTC ISO: YYYY-MM-DDTHH:MM:00Z (but CSV date might be M/D/YYYY)
      // If date is M/D/YYYY, we can’t reliably parse to ISO without guessing.
      // So we only do AKDT conversion when event_datetime_z exists.
    }
  }

  let akPart = "";
  if (iso) {
    try {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Anchorage",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        });
        const parts = fmt.format(d).replace(/^24:/, "00:");
        akPart = `${parts} AKDT`;
      }
    } catch (_) {}
  }

  if (zPart && akPart) return `(${zPart} / ${akPart})`;
  if (zPart) return `(${zPart})`;
  return "";
}

function cleanPreviewText(raw) {
  const s = norm(raw);
  if (!s) return "No narrative provided.";
  // Keep the true narrative, just normalize whitespace for the one-line preview
  return s.replace(/\s+/g, " ").trim();
}

function titleLine1(row) {
  const tail = firstTail(pickRowValue(row, ["n_numbers", "n_number", "tail", "tail_number"]));
  const model = norm(pickRowValue(row, ["aircraft_primary_model", "aircraft_model", "model", "aircraft_primary"]));
  const left = tail || norm(pickRowValue(row, ["aircraft_primary"])) || "Unknown aircraft";
  const right = model || "Unknown model";
  return `${left} • ${right}`;
}

function titleLine2(row) {
  // "Merrill Field, AK • 8/23/2025 (2018Z / 11:18 AKDT)"
  const city = norm(pickRowValue(row, ["city", "location_city"]));
  const state = upper(pickRowValue(row, ["state"]));
  const date = norm(pickRowValue(row, ["event_date", "date", "eventDate"]));
  const timeZ = upper(pickRowValue(row, ["event_time_z", "time_z", "event_time"]));
  const iso = norm(pickRowValue(row, ["event_datetime_z", "eventDateTimeZ"]));

  const place = city && state ? `${city}, ${state}` : (city || state || "Unknown location");
  const zAk = formatZandAKDT(date, timeZ, iso);
  const datePart = date ? date : "Unknown date";

  return `${place} • ${datePart} ${zAk}`.trim();
}

function chip(label, value) {
  const v = norm(value);
  return `<span class="chip"><span class="chipLabel">${label}</span> <span class="chipValue">${v || "—"}</span></span>`;
}

function renderCard(row, narrativeKey) {
  const narrativeRaw = norm(row[narrativeKey]);
  const preview = cleanPreviewText(narrativeRaw);
  const full = narrativeRaw || "No narrative provided.";

  const reportDate = pickRowValue(row, ["report_date"]);
  const phase = pickRowValue(row, ["phase"]);
  const type = pickRowValue(row, ["event_type", "type"]);
  const pob = pickRowValue(row, ["pob"]);
  const injuries = pickRowValue(row, ["injuries"]);
  const damage = pickRowValue(row, ["damage"]);
  const f8020 = pickRowValue(row, ["form_8020_9", "8020_9", "form8020_9"]);

  const chipsHtml = `
    <div class="chips">
      ${chip("Report:", reportDate)}
      ${chip("Phase:", phase)}
      ${chip("Type:", type)}
      ${chip("POB:", pob)}
      ${chip("Injuries:", injuries)}
      ${chip("Damage:", damage)}
      ${chip("8020-9:", f8020)}
    </div>
  `;

  const card = document.createElement("article");
  card.className = "card";

  card.innerHTML = `
    <div class="line1">${titleLine1(row)}</div>
    <div class="line2">${titleLine2(row)}</div>

    <div class="narrSection">
      <div class="narrText">
        <div class="narrPreview" title="${preview.replace(/"/g, "&quot;")}">${preview}</div>
        <div class="narrFull">${full.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      </div>

      <button class="expandBtn" type="button">Expand</button>
    </div>

    <div class="metaArea">
      ${chipsHtml}
    </div>
  `;

  const btn = card.querySelector(".expandBtn");
  btn.addEventListener("click", () => {
    const expanded = card.classList.toggle("expanded");
    btn.textContent = expanded ? "Collapse" : "Expand";
  });

  return card;
}

function getNarrativeKey(headers) {
  const preferred = ["raw_narrative", "narrative", "context_parens", "context", "rawNarrative"];
  for (const k of preferred) {
    if (headers.includes(k)) return k;
  }
  return ""; // handled later
}

function uniqueSorted(values) {
  const set = new Set(values.map(v => norm(v)).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function fillSelect(selectEl, items, allLabel) {
  selectEl.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = allLabel;
  selectEl.appendChild(optAll);

  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it;
    opt.textContent = it;
    selectEl.appendChild(opt);
  }
}

function matchesSearch(row, narrativeKey, q) {
  if (!q) return true;
  const hay = [
    row[narrativeKey],
    row.city,
    row.state,
    row.airport_code,
    row.facility,
    row.aircraft_primary,
    row.aircraft_primary_model,
    row.n_numbers,
    row.event_type,
    row.phase
  ].map(norm).join(" ").toLowerCase();
  return hay.includes(q);
}

function sortRows(rows, order) {
  const getDate = (r) => norm(pickRowValue(r, ["event_datetime_z", "event_date", "report_date"]));
  const dir = order === "oldest" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const da = getDate(a);
    const db = getDate(b);
    return da.localeCompare(db) * dir;
  });
}

function applyFilters(headers) {
  const narrativeKey = getNarrativeKey(headers) || "raw_narrative";

  const q = norm(searchEl.value).toLowerCase();
  const state = upper(stateFilterEl.value);
  const type = norm(eventFilterEl.value);
  const phase = norm(phaseFilterEl.value);
  const order = sortOrderEl.value;

  let rows = allRows.filter(r => {
    if (state && upper(r.state) !== state) return false;
    if (type && norm(r.event_type) !== type) return false;
    if (phase && norm(r.phase) !== phase) return false;
    return matchesSearch(r, narrativeKey, q);
  });

  rows = sortRows(rows, order);
  filteredRows = rows;

  resultsEl.innerHTML = "";
  rows.forEach(r => resultsEl.appendChild(renderCard(r, narrativeKey)));
  rowCountEl.textContent = `Rows detected: ${rows.length}`;
}

async function init() {
  try {
    const resp = await fetch(CSV_PATH, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Unable to load CSV (${resp.status})`);
    const text = await resp.text();

    const parsed = parseCsv(text);
    const { headers, data } = buildObjects(parsed);

    allRows = data;

    const narrativeKey = getNarrativeKey(headers);
    statusMessage.textContent = narrativeKey
      ? `Loaded OK (narrative column: ${narrativeKey})`
      : `Loaded OK (narrative column not found — expecting raw_narrative)`;

    rowCountEl.textContent = `Rows detected: ${allRows.length}`;

    fillSelect(stateFilterEl, uniqueSorted(allRows.map(r => upper(r.state))), "All states");
    fillSelect(eventFilterEl, uniqueSorted(allRows.map(r => norm(r.event_type))), "All event types");
    fillSelect(phaseFilterEl, uniqueSorted(allRows.map(r => norm(r.phase))), "All phases");

    // default filters
    applyFilters(headers);

    // listeners
    const rerun = () => applyFilters(headers);
    searchEl.addEventListener("input", rerun);
    stateFilterEl.addEventListener("change", rerun);
    eventFilterEl.addEventListener("change", rerun);
    phaseFilterEl.addEventListener("change", rerun);
    sortOrderEl.addEventListener("change", rerun);

  } catch (e) {
    statusMessage.textContent = `Error: ${e.message}`;
    resultsEl.innerHTML = "";
    rowCountEl.textContent = "Rows detected: 0";
    console.error(e);
  }
}

init();
