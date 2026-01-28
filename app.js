// app.js — Alaska Aviation Incidents (GitHub Pages, client-side)
// ✅ Robust CSV parser (handles quotes, commas, and newlines inside quotes)
// ✅ Auto-detects narrative column (prefers context_parens, then narrative, then anything w/ "narr")
// ✅ Uses the detected narrative column for display

const $ = (id) => document.getElementById(id);

const els = {
  search: $("search"),
  state: $("stateFilter"),
  event: $("eventFilter"),
  phase: $("phaseFilter"),
  sort: $("sortOrder"),
  status: $("statusMessage"),
  rowCount: $("rowCount"),
  results: $("results"),
};

let allRows = [];
let narrativeKey = null;

const norm = (v) => (v ?? "").toString().trim();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < s.length) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        cell += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
        i += 1;
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
      } else {
        cell += ch;
        i += 1;
      }
    }
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((r) => r.some((c) => norm(c).length > 0));
}

function detectNarrativeKey(headers) {
  const lower = headers.map((h) => norm(h).toLowerCase());

  // Your CSV screenshots show narrative content living in context_parens
  const priority = ["context_parens", "narrative", "context", "details", "description", "summary"];

  for (const k of priority) {
    const idx = lower.indexOf(k);
    if (idx !== -1) return headers[idx];
  }

  // fallback: any header containing "narr"
  for (let i = 0; i < lower.length; i++) {
    if (lower[i].includes("narr")) return headers[i];
  }
  return null;
}

function buildOptions(selectEl, values, placeholder) {
  const unique = Array.from(new Set(values.map(norm).filter(Boolean))).sort((a, b) =>
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

function get(row, ...keys) {
  for (const k of keys) {
    if (!k) continue;
    const v = row[k];
    if (norm(v)) return norm(v);
  }
  return "";
}

function parseSortDate(row) {
  const dt = norm(row.event_datetime_z);
  if (dt) {
    const ms = Date.parse(dt);
    if (!Number.isNaN(ms)) return ms;
  }
  const d = norm(row.event_date);
  const tz = norm(row.event_time_z);
  if (d) {
    let iso = d;
    if (tz && /^[0-2]\d[0-5]\dZ$/.test(tz)) {
      iso = `${d}T${tz.slice(0, 2)}:${tz.slice(2, 4)}:00Z`;
    }
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) return ms;
  }
  const rd = norm(row.report_date);
  if (rd) {
    const ms = Date.parse(rd);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function formatTitle(row) {
  const city = get(row, "city");
  const state = get(row, "state");
  const loc = [city, state].filter(Boolean).join(", ");

  const d = get(row, "event_date") || get(row, "event_datetime_z");
  const datePart = d ? d.split("T")[0] : "";
  const tz = get(row, "event_time_z");
  const timePart = tz ? ` (${tz})` : "";

  if (loc && datePart) return `${loc} — ${datePart}${timePart}`;
  if (loc) return loc;
  if (datePart) return `${datePart}${timePart}`;
  return "Unknown location";
}

function formatLine2(row) {
  const n = get(row, "aircraft_primary", "aircraft_1_nnumber", "n_numbers");
  const model = get(row, "aircraft_primary_model", "aircraft_1_type");
  const facility = get(row, "facility", "airport_code", "airport_name");
  return [n, model, facility].filter(Boolean).join(" • ");
}

function chip(label, value) {
  const d = document.createElement("div");
  d.className = "chip";
  d.innerHTML = `<b>${label}:</b> ${value}`;
  return d;
}

function render(rows) {
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

    const reportDate = get(row, "report_date");
    const phase = get(row, "phase");
    const eventType = get(row, "event_type");
    const pob = get(row, "pob");
    const injuries = get(row, "injuries");
    const damage = get(row, "damage");
    const form8020 = get(row, "form_8020_9");

    if (reportDate) chips.appendChild(chip("Report", reportDate));
    if (phase) chips.appendChild(chip("Phase", phase));
    if (eventType) chips.appendChild(chip("Type", eventType));
    if (pob) chips.appendChild(chip("POB", pob));
    if (injuries) chips.appendChild(chip("Injuries", injuries));
    if (damage) chips.appendChild(chip("Damage", damage));
    if (form8020) chips.appendChild(chip("8020-9", form8020));

    // ✅ Narrative (this is the key)
    const narrative = get(row, narrativeKey);

    const narrWrap = document.createElement("div");
    narrWrap.className = "narrWrap";

    const preview = document.createElement("div");
    preview.className = "narrPreview";
    preview.textContent = narrative || "No narrative provided.";

    const full = document.createElement("div");
    full.className = "narrFull";
    full.textContent = narrative || "No narrative provided.";

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
  const q = norm(els.search.value).toLowerCase();
  const st = norm(els.state.value);
  const ev = norm(els.event.value);
  const ph = norm(els.phase.value);
  const sort = norm(els.sort.value);

  let filtered = allRows.slice();

  if (st) filtered = filtered.filter((r) => norm(r.state) === st);
  if (ev) filtered = filtered.filter((r) => norm(r.event_type) === ev);
  if (ph) filtered = filtered.filter((r) => norm(r.phase) === ph);

  if (q) {
    filtered = filtered.filter((r) => {
      const hay = [
        r.state, r.city, r.airport_code, r.facility,
        r.aircraft_primary, r.aircraft_primary_model,
        r.aircraft_1_nnumber, r.n_numbers,
        r.event_type, r.phase, r.damage, r.injuries, r.pob,
        r[narrativeKey],
      ]
        .map((x) => norm(x).toLowerCase())
        .join(" | ");
      return hay.includes(q);
    });
  }

  filtered.sort((a, b) => {
    const da = parseSortDate(a);
    const db = parseSortDate(b);
    return sort === "oldest" ? da - db : db - da;
  });

  els.rowCount.textContent = `Rows detected: ${allRows.length}`;
  render(filtered);
}

async function init() {
  try {
    els.status.textContent = "Loading data…";

    // cache-bust to avoid seeing old CSV
    const url = `./data/incidents.csv?v=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Unable to load CSV (${res.status})`);

    const csvText = await res.text();
    const raw = parseCsv(csvText);
    if (raw.length < 2) throw new Error("CSV has no data rows.");

    const headers = raw[0].map((h) => norm(h));
    narrativeKey = detectNarrativeKey(headers);

    const data = raw.slice(1);

    allRows = data
      .map((cells) => {
        const row = {};
        for (let i = 0; i < headers.length; i++) row[headers[i]] = cells[i] ?? "";
        // normalize common keys
        row.state = norm(row.state);
        row.city = norm(row.city);
        row.event_type = norm(row.event_type);
        row.phase = norm(row.phase);
        row.damage = norm(row.damage);
        row.injuries = norm(row.injuries);
        row.pob = norm(row.pob);
        row.facility = norm(row.facility);
        return row;
      })
      .filter((r) => Object.values(r).some((v) => norm(v).length > 0));

    buildOptions(els.state, allRows.map((r) => r.state), "All states");
    buildOptions(els.event, allRows.map((r) => r.event_type), "All event types");
    buildOptions(els.phase, allRows.map((r) => r.phase), "All phases");

    els.status.textContent = narrativeKey
      ? `Loaded OK (narrative column: ${narrativeKey})`
      : "Loaded OK (no narrative column detected)";

    // listeners
    els.search.addEventListener("input", applyFilters);
    els.state.addEventListener("change", applyFilters);
    els.event.addEventListener("change", applyFilters);
    els.phase.addEventListener("change", applyFilters);
    els.sort.addEventListener("change", applyFilters);

    applyFilters();
  } catch (e) {
    console.error(e);
    els.status.textContent = `Error: ${e.message}`;
    els.rowCount.textContent = "Rows detected: 0";
    els.results.innerHTML = "";
  }
}

init();
