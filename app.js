// app.js (client-side, GitHub Pages friendly)

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const els = {
  search: document.getElementById("search"),
  year: document.getElementById("yearFilter"),
  month: document.getElementById("monthFilter"),
  state: document.getElementById("stateFilter"),
  event: document.getElementById("eventFilter"),
  phase: document.getElementById("phaseFilter"),
  sort: document.getElementById("sortOrder"),
  downloadBtn: document.getElementById("downloadBtn"), // ✅ NEW
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
      if (c === "\r" && n === "\n") i++; // handle \r\n
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
  if (["CA","OR","WA","NV"].includes(s)) return "America/Los_Angeles";
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
  return hh && mm ? `${hh}:${mm} ${tz}` : "";
}

/** ---------- Date helpers (USE normalized fields) ---------- */
function getEventDate(it) {
  // Prefer normalized ISO
  if (it && it._eventISO) {
    const d = new Date(it._eventISO);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Fallback: normalized M/D/YYYY
  if (it && it._eventDate) {
    const m = String(it._eventDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const mm = Number(m[1]) - 1;
      const dd = Number(m[2]);
      const yy = Number(m[3]);
      const d2 = new Date(yy, mm, dd);
      if (!Number.isNaN(d2.getTime())) return d2;
    }
  }

  return null;
}

function populateYearMonthFilters(rows) {
  if (!els.year || !els.month) return;

  // keep the first option ("All") and remove the rest
  els.year.length = 1;
  els.month.length = 1;

  const years = new Set();
  const months = new Set();

  for (const r of rows) {
    const d = getEventDate(r);
    if (!d) continue;
    years.add(d.getFullYear());
    months.add(d.getMonth()); // 0-11
  }

  [...years].sort((a,b) => b-a).forEach(y => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    els.year.appendChild(opt);
  });

  [...months].sort((a,b) => a-b).forEach(m => {
    const opt = document.createElement("option");
    opt.value = String(m); // 0-11
    opt.textContent = MONTHS[m];
    els.month.appendChild(opt);
  });
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

  // Narrative
  const rawNarr = getAny(row, ["raw_narrative"]);
  const narrFallback = getAny(row, ["narrative", "Narrative", "context_parens", "raw_text"]);
  const narrative = rawNarr || narrFallback || "No narrative provided.";

  const localTime = formatLocalFromISO(eventISO, state);

  const line2Left = [city || (airport ? airport : ""), state].filter(Boolean).join(", ");
  const line2Right = [eventDate || "", eventTimeZ ? `${eventTimeZ}` : "", localTime ? `${localTime}` : ""].filter(Boolean);

  const line2 = line2Right.length
    ? `${line2Left} • ${line2Right[0]} (${line2Right.slice(1).join(" / ")})`
    : (line2Left || "Unknown location • Unknown date");

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

/** ---------- CSV download (CURRENT FILTERED ROWS) ---------- */
function csvEscape(value) {
  const s = (value ?? "").toString();
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsvFromObjects(objs, headers) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const o of objs) {
    const row = headers.map(h => csvEscape(o?.[h]));
    lines.push(row.join(","));
  }
  return lines.join("\r\n");
}

function downloadFilteredCsv() {
  if (!FILTERED.length) return;

  // Use original CSV columns (not the _normalized fields)
  const keys = Object.keys(FILTERED[0]).filter(k => !k.startsWith("_"));

  const csv = buildCsvFromObjects(FILTERED, keys);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  a.download = `incidents_filtered_${stamp}.csv`;

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** ---------- Render cards ---------- */
function render() {
  els.results.innerHTML = "";
  els.rowCount.textContent = `Rows detected: ${FILTERED.length}`;

  for (const it of FILTERED) {
    const card = document.createElement("article");
    card.className = "card";

    const l1 = document.createElement("div");
    l1.className = "l1";
    l1.textContent = `${it._tail} • ${it._model}`;

    const l2 = document.createElement("div");
    l2.className = "l2";
    l2.textContent = it._line2;

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

  const y = els.year ? norm(els.year.value) : "";
  const m = els.m
