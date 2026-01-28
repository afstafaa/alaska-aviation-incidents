// app.js — Alaska Aviation Incidents (GitHub Pages, client-side)
// - Robust CSV parsing (quotes, commas, newlines)
// - Auto-detect narrative column (context_parens / narrative / etc.)
// - Cache-bust CSV fetch to avoid stale GitHub Pages caching

const el = (id) => document.getElementById(id);

const els = {
  search: el("search"),
  state: el("stateFilter"),
  event: el("eventFilter"),
  phase: el("phaseFilter"),
  sort: el("sortOrder"),
  status: el("statusMessage"),
  rowCount: el("rowCount"),
  results: el("results"),
};

let allRows = [];
let narrativeKey = null;

function normalize(s) {
  return (s ?? "").toString().trim();
}

function safeUpper(s) {
  const t = normalize(s);
  return t ? t.toUpperCase() : "";
}

function toNumberMaybe(v) {
  const t = normalize(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseDateForSort(row) {
  // Prefer event_datetime_z (ISO) then event_date + event_time_z then report_date
  const dt = normalize(row.event_datetime_z);
  if (dt) {
    const ms = Date.parse(dt);
    if (!Number.isNaN(ms)) return ms;
  }
  const d = normalize(row.event_date);
  const tz = normalize(row.event_time_z);
  if (d) {
    // If time is "1930Z" make "19:30Z"
    let iso = d;
    if (tz && /^[0-2]\d[0-5]\dZ$/.test(tz)) {
      iso = `${d}T${tz.slice(0, 2)}:${tz.slice(2, 4)}:00Z`;
    }
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) return ms;
  }
  const rd = normalize(row.report_date);
  if (rd) {
    const ms = Date.parse(rd);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

/**
 * Robust CSV parser:
 * - supports quoted fields
 * - supports embedded commas and newlines inside quotes
 * - returns array of rows (each row array of cells)
 */
function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  // Normalize line endings
  const text = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // escaped quote?
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i += 1;
          continue;
        }
      } else {
        cell += ch;
        i += 1;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        row.push(cell);
        cell = "";
        i += 1;
        continue;
      }
      if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
  }

  // last cell
  row.push(cell);
  rows.push(row);

  // Remove trailing totally-empty rows
  return rows.filter((r) => r.some((c) => normalize(c).length > 0));
}

function detectNarrativeKey(headers) {
  // Most likely your narrative is in context_parens
  const priority = [
    "context_parens",
    "narrative",
    "context",
    "details",
    "description",
    "summary",
    "remarks",
    "note",
  ];

  const lower = headers.map((h) => normalize(h).toLowerCase());
  for (const k of priority) {
    const idx = lower.indexOf(k);
    if (idx !== -1) return headers[idx];
  }

  // fallback: find any header containing "narr"
  for (let i = 0; i < lower.length; i++) {
    if (lower[i].includes("narr")) return headers[i];
  }
  return null;
}

function buildOptions(selectEl, values, placeholder) {
  const unique = Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  for (const v of unique) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
}

function getField(row, ...keys) {
  for (const k of keys) {
    if (!k) continue;
    const v = row[k];
    if (normalize(v)) return normalize(v);
  }
  return "";
}

function formatTitle(row) {
  const city = getField(row, "city");
  const state = getField(row, "state");
  const loc = [city, state].filter(Boolean).join(", ");
  const eventDate = getField(row, "event_date") || getField(row, "event_datetime_z");
  const timeZ = getField(row, "event_time_z");
  const datePart = eventDate ? eventDate.split("T")[0] : "";
  const timePart = timeZ ? ` (${timeZ})` : "";

  if (loc && datePart) return `${loc} — ${datePart}${timePart}`;
  if (loc) return loc;
  if (datePart) return `${datePart}${timePart}`;
  return "Unknown location";
}

function formatLine2(row) {
  const n1 = getField(row, "aircraft_primary", "aircraft_1_nnumber", "n_numbers");
  const model = getField(row, "aircraft_primary_model", "aircraft_1_type", "aircraft_primary_model");
  const facility = getField(row, "facility", "airport_name", "airport_code");

  const parts = [];
  if (n1) parts.push(n1);
  if (model) parts.push(model);
  if (facility) parts.push(facility);
  return parts.join(" • ");
}

function chip(label, value) {
  const d = document.createElement("div");
  d.className = "chip";
  d.innerHTML = `<b>${label}:</b> ${value}`;
  return d;
}

function renderRows(rows) {
  els.results.innerHTML = "";

  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "card";

    const h1 = document.createElement("div");
    h1.className = "cardHeadLine1";
    h1.textContent = formatTitle(row);

    const h2 = document.createElement("div");
    h2.className = "cardHeadLine2";
    h2.textContent = formatLine2(row) || "";

    const chips = document.createElement("div");
    chips.className = "chips";

    const reportDate = getField(row, "report_date");
    const phase = getField(row, "phase");
    const eventType = getField(row, "event_type");
    const pob = getField(row, "pob");
    const injuries = getField(row, "injuries");
    const damage = getField(row, "damage");
    const form8020 = getField(row, "form_8020_9");

    if (reportDate) chips.appendChild(chip("Report", reportDate));
    if (phase) chips.appendChild(chip("Phase", phase));
    if (eventType) chips.appendChild(chip("Type", eventType));
    if (pob) chips.appendChild(chip("POB", pob));
    if (injuries) chips.appendChild(chip("Injuries", injuries));
    if (damage) chips.appendChild(chip("Damage", damage));
    if (form8020) chips.appendChild(chip("8020-9", form8020));

    // Narrative (this is the key fix)
    const narr = getField(row, narrativeKey) || "";
    const narrWrap = document.createElement("div");
    narrWrap.className = "narrWrap";

    const preview = document.createElement("div");
    preview.className = "narrPreview";
    preview.textContent = narr ? narr : "No narrative provided.";

    const full = document.createElement("div");
    full.className = "narrFull";
    full.textContent = narr ? narr : "No narrative provided.";

    narrWrap.appendChild(preview);
    narrWrap.appendChild(full);

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

    card.appendChild(h1);
    if (h2.textContent) card.appendChild(h2);
    card.appendChild(chips);
    card.appendChild(narrWrap);
    card.appendChild(actions);

    els.results.appendChild(card);
  }
}

function applyFilters() {
  const q = normalize(els.search.value).toLowerCase();
  const st = normalize(els.state.value);
  const ev = normalize(els.event.value);
  const ph = normalize(els.phase.value);
  const sort = normalize(els.sort.value);

  let filtered = allRows.slice();

  if (st) filtered = filtered.filter((r) => normalize(r.state) === st);
  if (ev) filtered = filtered.filter((r) => normalize(r.event_type) === ev);
  if (ph) filtered = filtered.filter((r) => normalize(r.phase) === ph);

  if (q) {
    filtered = filtered.filter((r) => {
      const hay = [
        r.state,
        r.city,
        r.airport_code,
        r.facility,
        r.aircraft_primary,
        r.aircraft_primary_model,
        r.aircraft_1_nnumber,
        r.n_numbers,
        r.event_type,
        r.phase,
        r.damage,
        r.injuries,
        r.pob,
        r[narrativeKey],
      ]
        .map((x) => normalize(x).toLowerCase())
        .join(" | ");
      return hay.includes(q);
    });
  }

  filtered.sort((a, b) => {
    const da = parseDateForSort(a);
    const db = parseDateForSort(b);
    return sort === "oldest" ? da - db : db - da;
  });

  els.rowCount.textContent = `Rows detected: ${allRows.length}`;
  renderRows(filtered);
}

async function init() {
  try {
    els.status.textContent = "Loading data…";

    // Cache bust to avoid stale fetch from GitHub Pages/CDN
    const csvUrl = `./data/incidents.csv?v=${Date.now()}`;
    const res = await fetch(csvUrl, { cache: "no-store" });

    if (!res.ok) throw new Error(`Unable to load CSV (${res.status})`);
    const csvText = await res.text();

    const rawRows = parseCsv(csvText);
    if (rawRows.length < 2) throw new Error("CSV has no data rows.");

    const headers = rawRows[0].map((h) => normalize(h));
    narrativeKey = detectNarrativeKey(headers);

    const dataRows = rawRows.slice(1);
    allRows = dataRows
      .map((cells) => {
        const row = {};
        for (let i = 0; i < headers.length; i++) {
          row[headers[i]] = cells[i] ?? "";
        }
        // Common normalize for known keys
        row.state = normalize(row.state);
        row.city = normalize(row.city);
        row.event_type = normalize(row.event_type);
        row.phase = normalize(row.phase);
        row.damage = normalize(row.damage);
        row.injuries = normalize(row.injuries);
        row.pob = normalize(row.pob);
        row.facility = normalize(row.facility);
        return row;
      })
      .filter((r) => Object.values(r).some((v) => normalize(v).length > 0));

    // Build dropdown options
    buildOptions(els.state, allRows.map((r) => r.state), "All states");
    buildOptions(els.event, allRows.map((r) => r.event_type), "All event types");
    buildOptions(els.phase, allRows.map((r) => r.phase), "All phases");

    // Status line tells us what narrative column we’re using (super useful for debugging)
    els.status.textContent = narrativeKey
      ? `Loaded OK (narrative column: ${narrativeKey})`
      : "Loaded OK (no narrative column detected)";

    // Wire events
    ["input", "change"].forEach((evt) => {
      els.search.addEventListener(evt, applyFilters);
      els.state.addEventListener(evt, applyFilters);
      els.event.addEventListener(evt, applyFilters);
      els.phase.addEventListener(evt, applyFilters);
      els.sort.addEventListener(evt, applyFilters);
    });

    applyFilters();
  } catch (err) {
    els.status.textContent = `Error: ${err.message}`;
    els.rowCount.textContent = "Rows detected: 0";
    els.results.innerHTML = "";
    console.error(err);
  }
}

init();
