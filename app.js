// app.js — single UI, dropdown filters work, narrative preview + expand
const CSV_URL = "./data/incidents.csv";

const ui = {
  search: document.getElementById("search"),
  state: document.getElementById("stateFilter"),
  event: document.getElementById("eventFilter"),
  phase: document.getElementById("phaseFilter"),
  sort: document.getElementById("sortOrder"),
  status: document.getElementById("statusMessage"),
  rowCount: document.getElementById("rowCount"),
  results: document.getElementById("results"),
};

function assertUI() {
  for (const [k, el] of Object.entries(ui)) {
    if (!el) throw new Error(`Missing required element for "${k}"`);
  }
}

function parseCSV(text) {
  // Robust CSV parser: quoted commas + newlines + escaped quotes ("")
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }

    if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
      if (c === "\r" && next === "\n") i++;
      row.push(field);
      field = "";
      if (c === "\n" || c === "\r") {
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

  const headers = rows[0].map((h, idx) => {
    const v = (h ?? "").trim();
    return idx === 0 ? v.replace(/^\uFEFF/, "") : v; // strip BOM
  });

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rows[r][c] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function uniqSorted(list) {
  return Array.from(new Set(list.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function setOptions(selectEl, values, allLabel) {
  selectEl.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel;
  selectEl.appendChild(all);

  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
  selectEl.value = "";
}

function mmddyyyyToParts(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || "").trim());
  if (!m) return null;
  return { mm: +m[1], dd: +m[2], yyyy: +m[3] };
}

function zuluToUTCDate(event_date, event_time_z) {
  const d = mmddyyyyToParts(event_date);
  if (!d) return null;

  const t = (event_time_z || "").replace(/[^\d]/g, "");
  if (!t) return null;
  const t4 = t.padStart(4, "0");
  const hh = +t4.slice(0, 2);
  const mi = +t4.slice(2, 4);

  const utcMs = Date.UTC(d.yyyy, d.mm - 1, d.dd, hh, mi, 0);
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function bestDateScore(r) {
  // Prefer event_datetime_z (ISO Z), else event_date+event_time_z, else report_date
  if (r.event_datetime_z) {
    const t = Date.parse(r.event_datetime_z);
    if (!Number.isNaN(t)) return t;
  }
  const dt = zuluToUTCDate(r.event_date, r.event_time_z);
  if (dt) return dt.getTime();

  if (r.report_date) {
    const t = Date.parse(r.report_date);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function formatAKLocal(utcDate) {
  // Returns e.g. "11:18 AKDT" or "10:18 AKST"
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Anchorage",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  const parts = fmt.formatToParts(utcDate);
  const hh = parts.find(p => p.type === "hour")?.value ?? "";
  const mm = parts.find(p => p.type === "minute")?.value ?? "";
  const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "";
  // tz usually comes back as AKDT/AKST
  return `${hh}:${mm} ${tz}`;
}

function buildTimeDisplay(r) {
  const date = r.event_date || "";
  const z = r.event_time_z || "";
  if (!date || !z) return date ? `${date}` : "";

  // If outside AK: only Zulu
  if ((r.state || "").toUpperCase() !== "AK") {
    return `${date} (${z})`;
  }

  // AK: show Zulu + Alaska local
  const utc = zuluToUTCDate(date, z);
  if (!utc) return `${date} (${z})`;
  const local = formatAKLocal(utc);
  return `${date} (${z} / ${local})`;
}

function matchesSearch(r, q) {
  if (!q) return true;
  const hay = [
    r.raw_narrative,
    r.city,
    r.state,
    r.airport_code,
    r.facility,
    r.aircraft_primary,
    r.aircraft_primary_model,
    r.n_numbers,
    r.phase,
    r.event_type,
    r.pob,
    r.injuries,
    r.damage,
    r.form_8020_9,
    r.report_date,
  ].filter(Boolean).join(" ").toLowerCase();

  return hay.includes(q);
}

function chip(label, value) {
  const s = document.createElement("span");
  s.className = "chip";
  const b = document.createElement("b");
  b.textContent = `${label}:`;
  s.appendChild(b);
  s.appendChild(document.createTextNode(value));
  return s;
}

function buildCard(r) {
  const card = document.createElement("article");
  card.className = "card";

  // Line 1: CITY, ST (bold)
  const line1 = document.createElement("div");
  line1.className = "cardHeadLine1";
  const city = (r.city || "").trim();
  const st = (r.state || "").trim();
  line1.textContent = [city, st].filter(Boolean).join(", ") || "UNKNOWN LOCATION";

  // Line 2: N-numbers • model • event date (zulu / ak local)
  const line2 = document.createElement("div");
  line2.className = "cardHeadLine2";
  const nn = (r.n_numbers || "").trim();
  const model = (r.aircraft_primary_model || "").trim();
  const timeDisp = buildTimeDisplay(r);
  const parts = [nn, model, timeDisp].filter(Boolean);
  line2.textContent = parts.join(" • ");

  // Chips: Report Date • Phase • Type • POB • Injuries • Damage • Form 8020-9
  const chips = document.createElement("div");
  chips.className = "chips";
  if (r.report_date) chips.appendChild(chip("Report", r.report_date));
  if (r.phase) chips.appendChild(chip("Phase", r.phase));
  if (r.event_type) chips.appendChild(chip("Type", r.event_type));
  if (r.pob) chips.appendChild(chip("POB", r.pob));
  if (r.injuries) chips.appendChild(chip("Injuries", r.injuries));
  if (r.damage) chips.appendChild(chip("Damage", r.damage));
  if (r.form_8020_9) chips.appendChild(chip("8020-9", r.form_8020_9));

  // Narrative preview + full
  const narrWrap = document.createElement("div");
  narrWrap.className = "narrWrap";

  const preview = document.createElement("div");
  preview.className = "narrPreview";
  preview.textContent = (r.raw_narrative || "").trim() || "No narrative provided.";

  const full = document.createElement("div");
  full.className = "narrFull";
  full.textContent = (r.raw_narrative || "").trim() || "No narrative provided.";

  narrWrap.appendChild(preview);
  narrWrap.appendChild(full);

  // Expand button (narrative only)
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

  card.appendChild(line1);
  card.appendChild(line2);
  if (chips.childNodes.length) card.appendChild(chips);
  card.appendChild(narrWrap);
  card.appendChild(actions);

  return card;
}

function render(allRecords) {
  const q = (ui.search.value || "").trim().toLowerCase();
  const st = ui.state.value;
  const ev = ui.event.value;
  const ph = ui.phase.value;
  const sort = ui.sort.value || "newest";

  let recs = allRecords.filter(r => {
    if (st && (r.state || "") !== st) return false;
    if (ev && (r.event_type || "") !== ev) return false;
    if (ph && (r.phase || "") !== ph) return false;
    if (!matchesSearch(r, q)) return false;
    return true;
  });

  recs.sort((a, b) => {
    const da = bestDateScore(a);
    const db = bestDateScore(b);
    return sort === "oldest" ? (da - db) : (db - da);
  });

  ui.results.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const r of recs) frag.appendChild(buildCard(r));
  ui.results.appendChild(frag);
}

async function init() {
  assertUI();
  ui.status.textContent = "Loading data…";

  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${CSV_URL}: ${res.status} ${res.statusText}`);
  const text = await res.text();

  const records = parseCSV(text);
  ui.rowCount.textContent = `Rows detected: ${records.length}`;
  ui.status.textContent = "";

  setOptions(ui.state, uniqSorted(records.map(r => r.state)), "All states");
  setOptions(ui.event, uniqSorted(records.map(r => r.event_type)), "All event types");
  setOptions(ui.phase, uniqSorted(records.map(r => r.phase)), "All phases");

  // Render + debounce
  let t = null;
  const rerender = () => {
    clearTimeout(t);
    t = setTimeout(() => render(records), 80);
  };

  ui.search.addEventListener("input", rerender);
  ui.state.addEventListener("change", rerender);
  ui.event.addEventListener("change", rerender);
  ui.phase.addEventListener("change", rerender);
  ui.sort.addEventListener("change", rerender);

  render(records);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch(err => {
    console.error(err);
    ui.status.textContent = `Error: ${err.message}`;
  });
});
