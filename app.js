// Alaska Aviation Incidents — static client-side CSV UI (GitHub Pages friendly)

const CSV_URL = "./data/incidents.csv";

const $ = (id) => document.getElementById(id);

const el = {
  q: $("q"),
  state: $("state"),
  eventType: $("eventType"),
  phase: $("phase"),
  sort: $("sort"),
  download: $("download"),
  reset: $("reset"),
  results: $("results"),
  errors: $("errors"),
  loadedStatus: $("loadedStatus"),
  countShown: $("countShown"),
};

let rawCsvText = "";
let rows = [];        // parsed objects (normalized keys)
let filtered = [];    // view rows

// ---------- CSV parsing (supports quoted fields with commas and newlines) ----------
function parseCsv(text) {
  const out = [];
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
        field = "";
        // ignore completely empty trailing lines
        if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) out.push(row);
        row = [];
      } else if (c === "\r") {
        // ignore
      } else {
        field += c;
      }
    }
  }

  // flush last line
  row.push(field);
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) out.push(row);

  return out;
}

function normKey(k) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function safeUpper(v) {
  const s = String(v || "").trim();
  return s ? s.toUpperCase() : "";
}

function parseDateForSort(obj) {
  // prefer event_datetime_z, else event_date, else report_date
  const dt = pick(obj, "event_datetime_z");
  if (dt) {
    const t = Date.parse(dt);
    if (!Number.isNaN(t)) return t;
  }
  const d = pick(obj, "event_date");
  if (d) {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return t;
    // handle m/d/yyyy
    const mdy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const t2 = Date.parse(`${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`);
      if (!Number.isNaN(t2)) return t2;
    }
  }
  const rd = pick(obj, "report_date");
  if (rd) {
    const t = Date.parse(rd);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function prettyDate(obj) {
  const dt = pick(obj, "event_date");
  if (dt) return dt;
  const z = pick(obj, "event_datetime_z");
  if (z) return z.split("T")[0];
  const rd = pick(obj, "report_date");
  return rd || "";
}

// ---------- Mapping for YOUR CSV headers ----------
function toDisplayModel(obj) {
  const city = pick(obj, "city");
  const state = safeUpper(pick(obj, "state"));
  const airport = pick(obj, "airport_code", "airport");
  const facility = pick(obj, "facility");
  const tail = safeUpper(pick(obj, "aircraft_primary", "n_numbers", "aircraft_1_nnumber", "aircraft_1_n_number"));
  const model = pick(obj, "aircraft_primary_model", "aircraft_1_type", "aircraft_1_model");
  const phase = pick(obj, "phase");
  const eventType = pick(obj, "event_type");
  // Pull narrative from best available column(s)
const issueParts = Object.keys(obj)
  .filter(k => k.startsWith("issue_") || k.startsWith("issue"))
  .sort()
  .map(k => String(obj[k] || "").trim())
  .filter(Boolean);

const narrative =
  pick(obj,
    "context",
    "narrative",
    "remarks",
    "description",
    "details",
    "synopsis",
    "event_description"
  ) || (issueParts.length ? issueParts.join(" ") : "");
  const injuries = pick(obj, "injuries");
  const damage = pick(obj, "damage");
  const pob = pick(obj, "pob");

  // best "location" label for title
  const locBits = [];
  if (city) locBits.push(city);
  if (state) locBits.push(state);
  let location = locBits.join(", ");
  if (!location && airport) location = airport;
  if (!location && facility) location = facility;
  if (!location) location = "Unknown location";

  const date = prettyDate(obj);

  return {
    _ts: parseDateForSort(obj),
    location,
    date,
    city,
    state,
    airport,
    facility,
    tail,
    model,
    phase,
    eventType,
    pob,
    injuries,
    damage,
    narrative: narrative || "No narrative provided.",
  };
}

function showError(msg) {
  el.errors.hidden = false;
  el.errors.textContent = msg;
}

function clearError() {
  el.errors.hidden = true;
  el.errors.textContent = "";
}

// ---------- UI build ----------
function setOptions(selectEl, values, placeholderLabel) {
  const current = selectEl.value || "";
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholderLabel;
  selectEl.appendChild(opt0);

  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
  // restore if still valid
  selectEl.value = values.includes(current) ? current : "";
}

function render() {
  const q = (el.q.value || "").trim().toLowerCase();
  const st = el.state.value;
  const et = el.eventType.value;
  const ph = el.phase.value;
  const sort = el.sort.value;

  filtered = rows
    .filter((r) => {
      if (st && r.state !== st) return false;
      if (et && r.eventType !== et) return false;
      if (ph && r.phase !== ph) return false;

      if (q) {
        const hay = [
          r.location, r.city, r.state, r.airport, r.facility, r.tail, r.model, r.phase, r.eventType, r.narrative
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .slice();

  if (sort === "newest") filtered.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  if (sort === "oldest") filtered.sort((a, b) => (a._ts || 0) - (b._ts || 0));
  if (sort === "city") filtered.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
  if (sort === "state") filtered.sort((a, b) => (a.state || "").localeCompare(b.state || ""));

  el.countShown.textContent = String(filtered.length);

  el.results.innerHTML = "";
  for (const r of filtered) el.results.appendChild(renderCard(r));
}

function renderCard(r) {
  const card = document.createElement("div");
  card.className = "card";

  const top = document.createElement("div");
  top.className = "cardTop";

  const left = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "title";
  title.textContent = `${r.location}${r.date ? " — " + r.date : ""}`;
  left.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "meta";

  const parts = [
    ["State", r.state],
    ["Airport", r.airport],
    ["Facility", r.facility],
    ["Tail", r.tail],
    ["Model", r.model],
    ["Phase", r.phase],
    ["POB", r.pob],
    ["Injuries", r.injuries],
    ["Damage", r.damage],
  ];

  for (const [k, v] of parts) {
    if (!v) continue;
    const s = document.createElement("span");
    s.innerHTML = `${k}: <b>${escapeHtml(v)}</b>`;
    meta.appendChild(s);
  }

  left.appendChild(meta);

  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = r.eventType ? r.eventType : "EVENT";

  top.appendChild(left);
  top.appendChild(tag);

  const narr = document.createElement("p");
  narr.className = "narr";
  const fullText = r.narrative || "";
  const shortText = fullText.length > 220 ? fullText.slice(0, 220).trimEnd() + "…" : fullText;
  narr.textContent = shortText;

  card.appendChild(top);
  card.appendChild(narr);

  if (fullText.length > 220) {
    const btn = document.createElement("button");
    btn.className = "view-full";
    btn.type = "button";
    btn.textContent = "View full narrative";
    let expanded = false;
    btn.addEventListener("click", () => {
      expanded = !expanded;
      narr.textContent = expanded ? fullText : shortText;
      btn.textContent = expanded ? "Show less" : "View full narrative";
    });
    card.appendChild(btn);
  }

  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- Download ----------
function downloadCsv() {
  if (!rawCsvText) return;
  const blob = new Blob([rawCsvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "incidents.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Load ----------
async function init() {
  clearError();
  el.loadedStatus.textContent = "Loading…";

  try {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Unable to load CSV (${res.status}) at ${CSV_URL}`);

    rawCsvText = await res.text();

    const table = parseCsv(rawCsvText).filter((r) => r.some((c) => String(c).trim() !== ""));
    if (!table.length) throw new Error("CSV appears to be empty.");
    if (table.length < 2) throw new Error("CSV has headers but no data rows.");

    const headers = table[0].map((h) => normKey(h));
    const data = table.slice(1);

    // build objects
    const objs = data.map((r) => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = (r[i] ?? "").trim();
      return obj;
    });

    // map to display model
    rows = objs.map(toDisplayModel);

    // build dropdown options from actual data
    const states = [...new Set(rows.map((r) => r.state).filter(Boolean))].sort();
    const eventTypes = [...new Set(rows.map((r) => r.eventType).filter(Boolean))].sort();
    const phases = [...new Set(rows.map((r) => r.phase).filter(Boolean))].sort();

    setOptions(el.state, states, "State (all)");
    setOptions(el.eventType, eventTypes, "Event type (all)");
    setOptions(el.phase, phases, "Phase (all)");

    el.loadedStatus.textContent = "OK";
    render();

  } catch (err) {
    el.loadedStatus.textContent = "ERROR";
    showError(err.message || String(err));
  }
}

// ---------- Events ----------
["input", "change"].forEach((evt) => {
  el.q.addEventListener(evt, render);
  el.state.addEventListener(evt, render);
  el.eventType.addEventListener(evt, render);
  el.phase.addEventListener(evt, render);
  el.sort.addEventListener(evt, render);
});

el.download.addEventListener("click", downloadCsv);

el.reset.addEventListener("click", () => {
  el.q.value = "";
  el.state.value = "";
  el.eventType.value = "";
  el.phase.value = "";
  el.sort.value = "newest";
  render();
});

init();
