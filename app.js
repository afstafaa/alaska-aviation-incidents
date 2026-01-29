/* Alaska Aviation Incidents - app.js
   Loads: ./data/incidents.csv
   Narrative column: raw_narrative
*/

const CSV_PATH = "./data/incidents.csv";

const els = {
  search: document.getElementById("search"),
  stateFilter: document.getElementById("stateFilter"),
  eventFilter: document.getElementById("eventFilter"),
  phaseFilter: document.getElementById("phaseFilter"),
  sortOrder: document.getElementById("sortOrder"),
  statusMessage: document.getElementById("statusMessage"),
  rowCount: document.getElementById("rowCount"),
  results: document.getElementById("results"),
};

let allRows = [];
let filteredRows = [];
let headers = [];

// ---------- CSV parsing (handles commas/quotes/newlines) ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  // Normalize newlines
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // escaped quote?
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    // not in quotes
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  // last field
  row.push(field);
  rows.push(row);

  // Remove empty trailing rows
  return rows.filter(r => r.some(cell => (cell ?? "").trim() !== ""));
}

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase();
}

function normValue(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function buildObjects(csvRows) {
  headers = csvRows[0].map(normHeader);
  const objs = [];

  for (let r = 1; r < csvRows.length; r++) {
    const line = csvRows[r];
    if (!line || line.length === 0) continue;

    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = normValue(line[c]);
    }
    objs.push(obj);
  }
  return objs;
}

// ---------- helpers ----------
function uniqSorted(values) {
  const set = new Set(values.filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(selectEl, values, allLabel) {
  selectEl.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = allLabel;
  selectEl.appendChild(optAll);

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function safeUpper(s) {
  const t = normValue(s);
  return t ? t.toUpperCase() : "";
}

function firstToken(s) {
  const t = normValue(s);
  if (!t) return "";
  return t.split(/[;, ]+/).filter(Boolean)[0] || "";
}

function parseIsoZ(iso) {
  const t = normValue(iso);
  const d = t ? new Date(t) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

function fmtMDY(dateObj) {
  // m/d/yyyy
  const m = dateObj.getMonth() + 1;
  const d = dateObj.getDate();
  const y = dateObj.getFullYear();
  return `${m}/${d}/${y}`;
}

function fmtTimeHM(dateObj, timeZone) {
  // HH:MM (24h)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dateObj);

  const hh = parts.find(p => p.type === "hour")?.value ?? "";
  const mm = parts.find(p => p.type === "minute")?.value ?? "";
  return `${hh}:${mm}`;
}

function getSortDate(row) {
  // Prefer event_datetime_z, else event_date, else report_date
  const dz = parseIsoZ(row["event_datetime_z"]);
  if (dz) return dz;

  const ed = normValue(row["event_date"]);
  if (ed) {
    const d = new Date(ed);
    if (!isNaN(d.getTime())) return d;
  }

  const rd = normValue(row["report_date"]);
  if (rd) {
    const d = new Date(rd);
    if (!isNaN(d.getTime())) return d;
  }

  return new Date(0);
}

function makeSearchBlob(row) {
  const fields = [
    row["raw_narrative"],
    row["city"],
    row["state"],
    row["airport_code"],
    row["facility"],
    row["aircraft_primary"],
    row["aircraft_primary_model"],
    row["n_numbers"],
    row["phase"],
    row["event_type"],
  ];
  return fields.map(v => normValue(v).toLowerCase()).join(" | ");
}

// ---------- render ----------
function render() {
  const q = normValue(els.search.value).toLowerCase();
  const st = normValue(els.stateFilter.value);
  const ev = normValue(els.eventFilter.value);
  const ph = normValue(els.phaseFilter.value);
  const sort = normValue(els.sortOrder.value);

  filteredRows = allRows.filter(row => {
    if (st && row["state"] !== st) return false;
    if (ev && row["event_type"] !== ev) return false;
    if (ph && row["phase"] !== ph) return false;
    if (q) {
      const blob = row.__search || "";
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  filteredRows.sort((a, b) => {
    const da = getSortDate(a).getTime();
    const db = getSortDate(b).getTime();
    return sort === "oldest" ? da - db : db - da;
  });

  els.rowCount.textContent = `Rows detected: ${filteredRows.length}`;

  els.results.innerHTML = "";
  filteredRows.forEach(row => els.results.appendChild(renderCard(row)));
}

function renderCard(row) {
  const card = document.createElement("article");
  card.className = "card";

  // Line 1: N7050K • PA20-2
  const tail = normValue(row["aircraft_primary"]) || firstToken(row["n_numbers"]) || "Unknown aircraft";
  const model = normValue(row["aircraft_primary_model"]) || "Unknown model";

  const l1 = document.createElement("div");
  l1.className = "l1";
  l1.textContent = `${tail} \u2022 ${model}`;

  // Line 2: Merrill Field, AK • 8/23/2025 (2018Z / 11:18 AKDT)
  const city = normValue(row["city"]) || "Unknown location";
  const state = normValue(row["state"]) || "";
  const zulu = normValue(row["event_time_z"]);
  const iso = normValue(row["event_datetime_z"]);

  let mdy = normValue(row["event_date"]);
  let akdtHM = "";
  let zuluDisplay = zulu ? zulu : "";

  const dz = parseIsoZ(iso);
  if (dz) {
    // If event_date missing or not in m/d/y format, compute from ISO in AK time for display
    mdy = mdy || fmtMDY(new Date(dz.getTime()));
    akdtHM = fmtTimeHM(dz, "America/Anchorage");
  }

  // If event_date exists but is like 8/23/2025 already, keep it.
  // If it's yyyy-mm-dd, convert to m/d/yyyy for display
  if (mdy && /^\d{4}-\d{2}-\d{2}$/.test(mdy)) {
    const d = new Date(mdy);
    if (!isNaN(d.getTime())) mdy = fmtMDY(d);
  }

  const l2 = document.createElement("div");
  l2.className = "l2";
  const loc = state ? `${city}, ${state}` : city;
  const timePart = (zuluDisplay || akdtHM) ? ` (${zuluDisplay || "—"}${akdtHM ? ` / ${akdtHM} AKDT` : ""})` : "";
  l2.textContent = `${loc} \u2022 ${mdy || "Unknown date"}${timePart}`;

  // Narrative preview + expand
  const narr = normValue(row["raw_narrative"]);
  const narrText = narr || "No narrative provided.";

  const narrRow = document.createElement("div");
  narrRow.className = "narrRow";

  const narrPreview = document.createElement("div");
  narrPreview.className = "narrPreview";
  narrPreview.textContent = narrText;

  const expandBtn = document.createElement("button");
  expandBtn.className = "expandBtn";
  expandBtn.type = "button";
  expandBtn.textContent = "Expand";

  const narrFull = document.createElement("div");
  narrFull.className = "narrFull";
  narrFull.textContent = narrText;

  // Metadata chips (show only when expanded)
  const chips = document.createElement("div");
  chips.className = "chips";

  function chip(label, value) {
    const v = normValue(value) || "Unknown";
    const el = document.createElement("span");
    el.className = "chip";
    const b = document.createElement("b");
    b.textContent = `${label}`;
    el.appendChild(b);
    el.appendChild(document.createTextNode(v));
    return el;
  }

  chips.appendChild(chip("Report:", row["report_date"]));
  chips.appendChild(chip("Phase:", row["phase"]));
  chips.appendChild(chip("Type:", row["event_type"]));
  chips.appendChild(chip("POB:", row["pob"]));
  chips.appendChild(chip("Injuries:", row["injuries"]));
  chips.appendChild(chip("Damage:", row["damage"]));
  chips.appendChild(chip("8020-9:", row["form_8020_9"]));

  // only show chips when expanded
  chips.style.display = "none";

  expandBtn.addEventListener("click", () => {
    const expanded = card.classList.toggle("expanded");
    expandBtn.textContent = expanded ? "Collapse" : "Expand";
    chips.style.display = expanded ? "flex" : "none";
  });

  narrRow.appendChild(narrPreview);
  narrRow.appendChild(expandBtn);

  card.appendChild(l1);
  card.appendChild(l2);
  card.appendChild(narrRow);
  card.appendChild(narrFull);
  card.appendChild(chips);

  return card;
}

// ---------- init ----------
async function init() {
  try {
    const res = await fetch(CSV_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Unable to load CSV (${res.status})`);

    const csvText = await res.text();
    const csvRows = parseCSV(csvText);

    if (!csvRows.length || csvRows.length < 2) throw new Error("CSV appears empty");

    allRows = buildObjects(csvRows);

    // Add prebuilt search blob
    allRows.forEach(r => (r.__search = makeSearchBlob(r)));

    // Populate filters
    const states = uniqSorted(allRows.map(r => r["state"]));
    const types = uniqSorted(allRows.map(r => r["event_type"]));
    const phases = uniqSorted(allRows.map(r => r["phase"]));

    setSelectOptions(els.stateFilter, states, "All states");
    setSelectOptions(els.eventFilter, types, "All event types");
    setSelectOptions(els.phaseFilter, phases, "All phases");

    // Status
    const hasNarr = headers.includes("raw_narrative");
    els.statusMessage.textContent = hasNarr
      ? "Loaded OK (narrative column: raw_narrative)"
      : `Loaded OK (missing raw_narrative; found: ${headers.join(", ")})`;

    // Wire events
    ["input", "change"].forEach(evt => {
      els.search.addEventListener(evt, render);
      els.stateFilter.addEventListener(evt, render);
      els.eventFilter.addEventListener(evt, render);
      els.phaseFilter.addEventListener(evt, render);
      els.sortOrder.addEventListener(evt, render);
    });

    render();
  } catch (err) {
    els.statusMessage.textContent = `Error: ${err.message}`;
    els.rowCount.textContent = "Rows detected: 0";
    console.error(err);
  }
}

init();
