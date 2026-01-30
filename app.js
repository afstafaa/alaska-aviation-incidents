// app.js (client-side, GitHub Pages friendly)

const els = {
  search: document.getElementById("search"),
  state: document.getElementById("stateFilter"),
  event: document.getElementById("eventFilter"),
  phase: document.getElementById("phaseFilter"),
  sort: document.getElementById("sortOrder"),
  status: document.getElementById("statusMessage"),
  rowCount: document.getElementById("rowCount"),
  results: document.getElementById("results"),
};

let INCIDENTS = [];
let FILTERED = [];

/** ---------- CSV parsing (handles quotes/newlines) ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '"' && inQuotes && n === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      // handle \r\n
      if (c === "\r" && n === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cur += c;
  }

  // flush
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  return rows;
}

function norm(s) {
  return (s ?? "").toString().trim();
}

function getAny(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && norm(v) !== "") return norm(v);
  }
  return "";
}

/** ---------- Time helpers ---------- */
function tzForState(state) {
  const s = (state || "").toUpperCase();
  if (s === "AK") return "America/Anchorage";
  if (s === "HI") return "Pacific/Honolulu";
  // Pacific states
  if (["CA","OR","WA","NV"].includes(s)) return "America/Los_Angeles";
  // Mountain-ish
  if (["ID","UT","WY","CO","MT","AZ","NM"].includes(s)) return "America/Denver";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatLocalFromISO(iso, state) {
  const z = norm(iso);
  if (!z) return "";
  const d = new Date(z);
  if (Number.isNaN(d.getTime())) return "";

  const timeZone = tzForState(state);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(d);

  const hh = parts.find(p => p.type === "hour")?.value ?? "";
  const mm = parts.find(p => p.type === "minute")?.value ?? "";
  const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "";

  // Example: "12:50 AKDT"
  return hh && mm ? `${hh}:${mm} ${tz}` : "";
}

/** ---------- Build normalized incident objects ---------- */
function toIncident(row) {
  const state = getAny(row, ["state", "State"]);

  const tail = getAny(row, ["aircraft_primary", "tail_number", "tail", "n_number"]);
  const model = getAny(row, ["aircraft_primary_model", "aircraft_primary_m", "aircraft_model", "model"]);
  const city = getAny(row, ["city", "location", "loc_city"]);
  const airport = getAny(row, ["airport_code", "airport"]);
  const eventType = getAny(row, ["event_type", "Event type", "type"]);
  const phase = getAny(row, ["phase", "Phase"]);
  const reportDate = getAny(row, ["report_date", "Report"]);
  const pob = getAny(row, ["pob", "POB"]);
  const injuries = getAny(row, ["injuries", "Injuries"]);
  const damage = getAny(row, ["damage", "Damage"]);
  const form8020 = getAny(row, ["8020_9", "8020-9", "faa_form_8020_9"]);

  // Dates/times
  const eventDate = getAny(row, ["event_date", "date", "Event date"]);
  const eventTimeZ = getAny(row, ["event_time_z", "time_z", "Event time z"]);
  const eventISO = getAny(row, ["event_datetime_z", "datetime_z", "event_datetime", "Event datetime z"]);

  // Narrative (THIS is what you wanted)
  const rawNarr = getAny(row, ["raw_narrative"]);
  const narrFallback = getAny(row, ["narrative", "Narrative", "context_parens", "raw_text"]);
  const narrative = rawNarr || narrFallback || "No narrative provided.";

  const localTime = formatLocalFromISO(eventISO, state);

  const line2Left = [
    city || (airport ? airport : ""),
    state,
  ].filter(Boolean).join(", ");

  const line2Right = [
    eventDate || "",
    eventTimeZ ? `${eventTimeZ}` : "",
    localTime ? `${localTime}` : "",
  ].filter(Boolean);

  const line2 = line2Right.length
    ? `${line2Left} • ${line2Right[0]} (${line2Right.slice(1).join(" / ")})`
    : (line2Left || "Unknown location • Unknown date");

  // for filtering/search
  const haystack = [
    tail, model, city, state, airport, eventType, phase,
    reportDate, pob, injuries, damage, form8020,
    eventDate, eventTimeZ, narrative,
  ].join(" ").toLowerCase();

  return {
    ...row,
    _state: state,
    _tail: tail || "Unknown aircraft",
    _model: model || "Unknown model",
    _city: city,
    _airport: airport,
    _eventType: eventType || "",
    _phase: phase || "",
    _reportDate: reportDate || "",
    _pob: pob || "Unknown",
    _injuries: injuries || "Unknown",
    _damage: damage || "Unknown",
    _form8020: form8020 || "Unknown",
    _eventDate: eventDate || "",
    _eventTimeZ: eventTimeZ || "",
    _eventISO: eventISO || "",
    _localTime: localTime || "",
    _line2: line2,
    _narrative: narrative,
    _haystack: haystack,
  };
}

/** ---------- UI: dropdowns ---------- */
function fillSelect(selectEl, values, allLabel) {
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

function uniqueSorted(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

/** ---------- Render cards (THIS matches your CSS classes) ---------- */
function render() {
  els.results.innerHTML = "";
  els.rowCount.textContent = `Rows detected: ${FILTERED.length}`;

  for (const it of FILTERED) {
    const card = document.createElement("article");
    card.className = "card";

    // Line 1
    const l1 = document.createElement("div");
    l1.className = "l1";
    l1.textContent = `${it._tail} • ${it._model}`;

    // Line 2
    const l2 = document.createElement("div");
    l2.className = "l2";
    l2.textContent = it._line2;

    // Narrative section (line 3 + expand button on the right)
    const narrSection = document.createElement("div");
    narrSection.className = "narrSection";

    const narrText = document.createElement("div");
    narrText.className = "narrText";

    const narrPreview = document.createElement("div");
    narrPreview.className = "narrPreview";
    narrPreview.textContent = it._narrative;

    const narrFull = document.createElement("div");
    narrFull.className = "narrFull";
    narrFull.textContent = it._narrative;

    narrText.appendChild(narrPreview);
    narrText.appendChild(narrFull);

    const btn = document.createElement("button");
    btn.className = "expandBtn";
    btn.type = "button";
    btn.textContent = "Expand";
    btn.addEventListener("click", () => {
      const expanded = card.classList.toggle("expanded");
      btn.textContent = expanded ? "Collapse" : "Expand";
    });

    narrSection.appendChild(narrText);
    narrSection.appendChild(btn);

    // Metadata line (line 4) - shown only when expanded
    const metaLine = document.createElement("div");
    metaLine.className = "metaLine";

    const chips = document.createElement("div");
    chips.className = "chips";

    const mkChip = (label, value) => {
      const span = document.createElement("span");
      span.className = "chip";
      const strong = document.createElement("strong");
      strong.textContent = `${label}:`;
      span.appendChild(strong);
      span.appendChild(document.createTextNode(` ${value || "—"}`));
      return span;
    };

    chips.appendChild(mkChip("Report", it._reportDate));
    chips.appendChild(mkChip("Phase", it._phase || "—"));
    chips.appendChild(mkChip("Type", it._eventType || "—"));
    chips.appendChild(mkChip("POB", it._pob));
    chips.appendChild(mkChip("Injuries", it._injuries));
    chips.appendChild(mkChip("Damage", it._damage));
    chips.appendChild(mkChip("8020-9", it._form8020));

    metaLine.appendChild(chips);

    // Build card
    card.appendChild(l1);
    card.appendChild(l2);
    card.appendChild(narrSection);
    card.appendChild(metaLine);

    els.results.appendChild(card);
  }
}

/** ---------- Apply filters ---------- */
function applyFilters() {
  const q = norm(els.search.value).toLowerCase();
  const st = norm(els.state.value);
  const ev = norm(els.event.value);
  const ph = norm(els.phase.value);
  const sort = norm(els.sort.value);

  FILTERED = INCIDENTS.filter(it => {
    if (st && it._state !== st) return false;
    if (ev && it._eventType !== ev) return false;
    if (ph && it._phase !== ph) return false;
    if (q && !it._haystack.includes(q)) return false;
    return true;
  });

  const toDate = (it) => {
    const iso = it._eventISO;
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
    // fallback: event_date + time_z (rough)
    return 0;
  };

  FILTERED.sort((a,b) => {
    const da = toDate(a);
    const db = toDate(b);
    return sort === "oldest" ? (da - db) : (db - da);
  });

  render();
}

/** ---------- Init ---------- */
async function init() {
  try {
    const res = await fetch("./data/incidents.csv", { cache: "no-store" });
    if (!res.ok) throw new Error("Unable to load CSV");
    const csvText = await res.text();

    const rows = parseCsv(csvText).filter(r => r.length > 1);
    if (!rows.length) throw new Error("CSV is empty");

    const headers = rows[0].map(h => norm(h));
    const dataRows = rows.slice(1);

    const objects = dataRows.map(r => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
      return obj;
    });

    INCIDENTS = objects.map(toIncident);

    // Populate dropdowns
    fillSelect(els.state, uniqueSorted(INCIDENTS.map(x => x._state)), "All states");
    fillSelect(els.event, uniqueSorted(INCIDENTS.map(x => x._eventType)), "All event types");
    fillSelect(els.phase, uniqueSorted(INCIDENTS.map(x => x._phase)), "All phases");

    els.status.textContent = "Loaded OK (narrative column: raw_narrative)";
    els.rowCount.textContent = `Rows detected: ${INCIDENTS.length}`;

    // hook events
    [els.search, els.state, els.event, els.phase, els.sort].forEach(el =>
      el.addEventListener("input", applyFilters)
    );

    // initial render
    FILTERED = [...INCIDENTS];
    applyFilters();
  } catch (e) {
    console.error(e);
    els.status.textContent = `Load error: ${e.message || e}`;
  }
}

init();
