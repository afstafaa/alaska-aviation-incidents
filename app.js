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
  status: document.getElementById("statusMessage"),
  rowCount: document.getElementById("rowCount"),
  results: document.getElementById("results"),
  downloadBtn: document.getElementById("downloadBtn"),
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

    if (c === '"' && inQuotes && n === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (c === "," && !inQuotes) { row.push(cur); cur = ""; continue; }

    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && n === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cur += c;
  }

  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function norm(s) { return (s ?? "").toString().trim(); }

function getAny(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && norm(v) !== "") return norm(v);
  }
  return "";
}

/** ---------- Extraction helpers ---------- */
function looksLikeNNumber(s) {
  const t = norm(s).toUpperCase();
  return /^N[0-9A-Z]{1,5}$/.test(t);
}

function pickPrimaryTail(field) {
  const raw = norm(field);
  if (!raw) return "";

  const parts = raw.split(/[;,\s]+/)
    .map(p => norm(p).toUpperCase())
    .filter(Boolean);

  const valid = parts.find(p => /^N[1-9][0-9A-Z]{0,4}$/.test(p));

  return valid || "";
}

function extractNNumber(text) {
  const t = norm(text).toUpperCase();
  if (!t) return "";
  const m = t.match(/\bN[0-9A-Z]{1,5}\b/);
  return m ? m[0] : "";
}

function extractCallsign(text) {
  const t = norm(text).toUpperCase();
  if (!t) return "";

  const reject = (cs) => {
    if (!cs) return true;
    if (!/\d/.test(cs)) return true;          // must contain a digit
    if (cs.startsWith("RWY")) return true;     // RWY11
    if (cs.startsWith("GATE")) return true;
    return false;
  };

  // common commas: ", UAL1871, B738."
  let m = t.match(/,\s*([A-Z]{2,4}\d{1,4})\s*,/);
  if (m && !reject(m[1])) return m[1];

  // after parens: "..., (HHR), WSN2, KING-AIR B350."
  m = t.match(/\)\s*,\s*([A-Z]{2,4}\d{1,4})\b/);
  if (m && !reject(m[1])) return m[1];

  // inside parens sometimes: "(JBU2233)"
  m = t.match(/\(\s*([A-Z]{2,4}\d{1,4})\s*\)/);
  if (m && !reject(m[1])) return m[1];

  // leading token
  m = t.match(/^\(?([A-Z]{2,4}\d{1,4})\b/);
  if (m && !reject(m[1])) return m[1];

  return "";
}

function extractAircraftDesignator(text, callsign = "") {
  const U = norm(text).toUpperCase();
  if (!U) return "";

  // Slash form (N98FK/EPIC)
  let m = U.match(/\bN[1-9][0-9A-Z]{0,4}\s*\/\s*([A-Z0-9-]{2,6})\b/);
  if (m) return m[1];

  // Callsign anchored pattern
  if (callsign) {
    const cs = callsign.toUpperCase();
    const re = new RegExp(`\\b${cs}\\b[^\\n\\r]{0,80}?\\b([A-Z][A-Z0-9]{1,4})\\b`);
    m = U.match(re);
    if (m && !isBadTypeToken(m[1], U, callsign)) return m[1];
  }

  // General scan (allow 1–4 digits for TBM7 etc.)
  const candidates =
    [...U.matchAll(/\b([A-Z]{1,4}[0-9]{1,4}[A-Z]?)\b/g)]
      .map(x => x[1]);

  for (const c of candidates) {
    if (callsign && c === callsign) continue;
    if (!isBadTypeToken(c, U, callsign)) return c;
  }

  // Special case for experimental narrative
  if (U.includes("EXPERIMENTAL")) return "EXPERIMENTAL";

  return "";
}

function isBadTypeToken(token, fullText, callsign = "") {
  const t = token.toUpperCase();
  const cs = (callsign || "").toUpperCase();

  if (cs && t === cs) return true;

  if (/^RWY\d+/.test(t)) return true;              // Runway
  if (/^[A-Z]\d{2,3}$/.test(t) &&                 // Airport ID
      new RegExp(`\\(\\s*${t}\\s*\\)`).test(fullText)) return true;

  if (/^N[1-9]/.test(t)) return true;              // Tail numbers

  const bad = new Set([
    "FAA","FSS","IFR","VFR","CTAF","ALNOT","RNAV",
    "SCT","ZDV","ZAN","ZSE","ZLA","ZMA","ZNY",
    "LAX","SFO","HHR","SBS"
  ]);

  if (bad.has(t)) return true;

  return false;
}

function extractFieldFromNarrative(narr, label) {
  const t = norm(narr);
  if (!t) return "";
  const re = new RegExp(`\\b${label}\\s*:\\s*([^\\.,\\n\\r]+)`, "i");
  const m = t.match(re);
  return m ? norm(m[1]) : "";
}

function extract80209FromNarrative(narr) {
  const t = norm(narr).toLowerCase();
  if (!t) return "";
  if (t.includes("faa form 8020-9 was received")) return "Yes";
  if (t.includes("faa form 8020-9 was not received")) return "No";
  if (t.includes("form 8020-9 was received")) return "Yes";
  if (t.includes("form 8020-9 was not received")) return "No";
  return "";
}

function extractReportDateFromNarrative(narr) {
  const t = norm(narr);
  if (!t) return "";
  const matches = [...t.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{3,4})Z\b/g)];
  if (!matches.length) return "";
  const last = matches[matches.length - 1];
  return last ? last[1] : "";
}

function inferPhaseFromNarrative(narr) {
  const t = norm(narr).toLowerCase();
  if (!t) return "";
  const rules = [
    ["Ground/Taxi", ["taxi", "tug", "ramp", "parked", "pushback"]],
    ["Takeoff/Departure", ["takeoff", "depart", "departure", "rotation", "initial climb"]],
    ["Climb", ["climb"]],
    ["Cruise", ["cruise", "en route"]],
    ["Descent", ["descent"]],
    ["Landing/Approach", ["approach", "landing", "final", "touchdown", "go around", "go-around", "flare"]],
  ];
  for (const [phase, keys] of rules) {
    if (keys.some(k => t.includes(k))) return phase;
  }
  return "";
}

function inferEventTypeFromNarrative(narr) {
  const t = norm(narr).toLowerCase();
  if (!t) return "";
  const rules = [
    ["Windshield crack", ["windshield", "crack in the windshield", "cracked windshield"]],
    ["Gear-up landing", ["gear-up", "gear up"]],
    ["Engine fire", ["engine fire", "fire warning", "smoke", "fire"]],
    ["Hard landing", ["hard landing", "bounced", "bounce", "firm landing"]],
    ["Tail strike", ["tail strike", "tailstrike"]],
    ["Runway excursion", ["excursion", "ran off", "departed the runway", "veer off"]],
    ["Bird strike", ["bird strike"]],
    ["Accident/Crash", ["crashed", "impact", "wreckage", "downed aircraft"]],
    ["Emergency return", ["declared an emergency", "requested it to return", "returned to"]],
  ];
  for (const [type, keys] of rules) {
    if (keys.some(k => t.includes(k))) return type;
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

function safeParseJsonArray(s) {
  const raw = norm(s);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function buildLinksBlock(items) {
  const wrap = document.createElement("div");
  wrap.className = "linksBlock";

  if (!items || !items.length) {
    const none = document.createElement("div");
    none.className = "noneText";
    none.textContent = "None";
    wrap.appendChild(none);
    return wrap;
  }

  const ul = document.createElement("ul");
  ul.className = "linkList";

  items.forEach(it => {
    const url = norm(it.url);
    const title = norm(it.title) || url || "Link";
    const publisher = norm(it.publisher);
    const date = norm(it.date);
    if (!url) return;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = title;

    li.appendChild(a);

    const metaBits = [publisher, date].filter(Boolean);
    if (metaBits.length) {
      const meta = document.createElement("span");
      meta.className = "linkMeta";
      meta.textContent = ` — ${metaBits.join(" • ")}`;
      li.appendChild(meta);
    }

    ul.appendChild(li);
  });

  if (!ul.children.length) {
    const none = document.createElement("div");
    none.className = "noneText";
    none.textContent = "None";
    wrap.appendChild(none);
    return wrap;
  }

  wrap.appendChild(ul);
  return wrap;
}

function mkLabeledSection(labelText, contentEl) {
  const section = document.createElement("div");
  section.className = "detailSection";

  const label = document.createElement("div");
  label.className = "detailLabel";
  label.textContent = labelText;

  section.appendChild(label);
  section.appendChild(contentEl);
  return section;
}

/** ---------- Date helpers ---------- */
function getEventDate(it) {
  if (it && it._eventISO) {
    const d = new Date(it._eventISO);
    if (!Number.isNaN(d.getTime())) return d;
  }
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

  els.year.length = 1;
  els.month.length = 1;

  const years = new Set();
  const months = new Set();

  for (const r of rows) {
    const d = getEventDate(r);
    if (!d) continue;
    years.add(d.getFullYear());
    months.add(d.getMonth());
  }

  [...years].sort((a,b) => b-a).forEach(y => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    els.year.appendChild(opt);
  });

  [...months].sort((a,b) => a-b).forEach(m => {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = MONTHS[m];
    els.month.appendChild(opt);
  });
}

/** ---------- Build normalized incident objects ---------- */
function toIncident(row) {
  const state = getAny(row, ["state", "State"]);

  const rawNarr = getAny(row, ["raw_narrative"]);
  const narrFallback = getAny(row, ["narrative", "Narrative", "context_parens", "raw_text"]);
  const narrative = rawNarr || narrFallback || "No narrative provided.";

  // NEW SCHEMA FIELDS
  let callsign = getAny(row, ["callsign_primary"]);
  let typeDesignator = getAny(row, ["aircraft_type_designator"]);

  // Tail first (true N-number fields), then narrative
  let tail = getAny(row, ["n_numbers", "tail_number", "tail", "n_number", "registration"]);
  tail = pickPrimaryTail(tail);
  if (!tail) tail = extractNNumber(narrative);

  // Callsign fallback (if schema empty)
  if (!callsign) callsign = extractCallsign(narrative);

  // Type/designator fallback (if schema empty)
  if (!typeDesignator) typeDesignator = extractAircraftDesignator(narrative, callsign);

  // Display ID format you want:
  // - If callsign exists: CALLSIGN (TAIL) or CALLSIGN
  // - Else if tail exists: TAIL
  // - Else: NONE
  // Build display ID
let displayId = "NONE";

if (callsign && tail) {
  displayId = `${callsign} (${tail})`;
} else if (callsign) {
  displayId = callsign;
} else if (tail) {
  displayId = tail;
}

// Model/type
let model = typeDesignator ||
            getAny(row, ["aircraft_primary_model","aircraft_model","model","aircraft_type"]);

if (!model) model = extractAircraftDesignator(narrative, callsign);

// EPIC tweak
if (model === "EPIC") model = "EPIC (E1000)";

  let eventType = getAny(row, ["event_type", "Event type", "type"]);
  let phase = getAny(row, ["phase", "Phase"]);
  let reportDate = getAny(row, ["report_date", "Report"]);
  let pob = getAny(row, ["pob", "POB"]);
  let injuries = getAny(row, ["injuries", "Injuries"]);
  let damage = getAny(row, ["damage", "Damage"]);
  let form8020 = getAny(row, ["form_8020_9", "8020_9", "8020-9", "faa_form_8020_9"]);

  // Narrative-derived fallbacks
  if (!reportDate) reportDate = extractReportDateFromNarrative(narrative);
  if (!pob) pob = extractFieldFromNarrative(narrative, "POB");
  if (!injuries) injuries = extractFieldFromNarrative(narrative, "Injuries");
  if (!damage) damage = extractFieldFromNarrative(narrative, "Damage");

  const f8020 = extract80209FromNarrative(narrative);
  if (!form8020 && f8020) form8020 = f8020;

  if (!phase) phase = inferPhaseFromNarrative(narrative);
  if (!eventType) eventType = inferEventTypeFromNarrative(narrative);

  const city = getAny(row, ["city", "location", "loc_city"]);
  const airport = getAny(row, ["airport_code", "airport"]);

  const eventDate = getAny(row, ["event_date", "date", "Event date"]);
  const eventTimeZ = getAny(row, ["event_time_z", "time_z", "Event time z"]);
  const eventISO = getAny(row, ["event_datetime_z", "event_datetime_z", "datetime_z", "event_datetime", "Event datetime z"]);

  const sourcesJson = getAny(row, ["sources_json"]);
  const mediaJson = getAny(row, ["media_json", "media_jason"]); // keep typo support

  const aircraftImageUrl = getAny(row, ["aircraft_image_url"]);
  const aircraftImageType = getAny(row, ["aircraft_image_type"]); // actual | similar

  const localTime = formatLocalFromISO(eventISO, state);

  const line2Left = [city || (airport ? airport : ""), state].filter(Boolean).join(", ");
  const line2Right = [eventDate || "", eventTimeZ ? `${eventTimeZ}` : "", localTime ? `${localTime}` : ""].filter(Boolean);

  const line2 = line2Right.length
    ? `${line2Left} • ${line2Right[0]} (${line2Right.slice(1).join(" / ")})`
    : (line2Left || "Unknown location • Unknown date");

  const haystack = [
    displayId, tail, callsign, modelDisplay, typeDesignator, city, state, airport, eventType, phase,
    reportDate, pob, injuries, damage, form8020,
    eventDate, eventTimeZ, narrative, sourcesJson, mediaJson, aircraftImageUrl, aircraftImageType,
  ].join(" ").toLowerCase();

  return {
    ...row,
    _state: state,
    _tail: displayId,
    _model: model || "Unknown type",
    _callsign: callsign || "",
    _typeDesignator: typeDesignator || "",
    _city: city,
    _airport: airport,
    _eventType: eventType || "—",
    _phase: phase || "—",
    _reportDate: reportDate || "—",
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
    _sources: safeParseJsonArray(sourcesJson),
    _media: safeParseJsonArray(mediaJson),
    _aircraftImageUrl: aircraftImageUrl || "",
    _aircraftImageType: (aircraftImageType || "").toLowerCase(),
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

/** ---------- Aircraft image helpers ---------- */
function buildImageSearchLinks(idValue, model) {
  const links = [];
  const idv = norm(idValue);
  const m = norm(model);

  if (idv && !idv.toLowerCase().includes("unknown")) {
    links.push({
      label: `Search photos for ${idv} (actual)`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(idv + " aircraft photo")}&iax=images&ia=images`,
    });
  }
  if (m && !m.toLowerCase().includes("unknown") && m !== "—") {
    links.push({
      label: `Search photos for ${m} (generic type)`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(m + " aircraft")}&iax=images&ia=images`,
    });
  }
  return links;
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

    const narrLabel = document.createElement("div");
    narrLabel.className = "detailLabel";
    narrLabel.textContent = "Narrative";
    narrText.appendChild(narrLabel);

    const narrTextEl = document.createElement("div");
    narrTextEl.className = "narrTextBlock";
    narrTextEl.textContent = it._narrative;
    narrText.appendChild(narrTextEl);

    const sourcesBlock = buildLinksBlock(it._sources);
    const sourcesSection = mkLabeledSection("Sources", sourcesBlock);
    sourcesSection.classList.add("onlyExpanded");
    narrText.appendChild(sourcesSection);

    const mediaBlock = buildLinksBlock(it._media);
    const mediaSection = mkLabeledSection("Media", mediaBlock);
    mediaSection.classList.add("onlyExpanded");
    narrText.appendChild(mediaSection);

    // Aircraft Image
    const imgWrap = document.createElement("div");
    imgWrap.className = "onlyExpanded";

    const imgUrl = norm(it._aircraftImageUrl);
    const imgType = (it._aircraftImageType || "").toLowerCase();

    if (imgUrl) {
      const a = document.createElement("a");
      a.href = imgUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      const label =
        (imgType === "actual") ? "Actual Image" :
        (imgType === "similar") ? "Generic Type Image" :
        "Aircraft Image";

      a.textContent = `View (${label})`;
      imgWrap.appendChild(a);
    } else {
      const links = buildImageSearchLinks(it._tail, it._model);
      if (!links.length) {
        const none = document.createElement("div");
        none.className = "noneText";
        none.textContent = "None";
        imgWrap.appendChild(none);
      } else {
        const ul = document.createElement("ul");
        ul.className = "linkList";
        links.forEach(l => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = l.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = l.label;
          li.appendChild(a);
          ul.appendChild(li);
        });
        imgWrap.appendChild(ul);
      }
    }

    const imgSection = mkLabeledSection("Aircraft Image", imgWrap);
    imgSection.classList.add("onlyExpanded");
    narrText.appendChild(imgSection);

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
    chips.appendChild(mkChip("Phase", it._phase));
    chips.appendChild(mkChip("Type", it._eventType));
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
  const m = els.month ? norm(els.month.value) : "";

  FILTERED = INCIDENTS.filter(it => {
    if (st && it._state !== st) return false;
    if (ev && it._eventType !== ev) return false;
    if (ph && it._phase !== ph) return false;
    if (q && !it._haystack.includes(q)) return false;

    if (y || m) {
      const d = getEventDate(it);
      if (!d) return false;
      if (y && d.getFullYear() !== Number(y)) return false;
      if (m && d.getMonth() !== Number(m)) return false;
    }

    return true;
  });

  const toDate = (it) => {
    const d = getEventDate(it);
    return d ? d.getTime() : 0;
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

    populateYearMonthFilters(INCIDENTS);
    fillSelect(els.state, uniqueSorted(INCIDENTS.map(x => x._state)), "All states");
    fillSelect(els.event, uniqueSorted(INCIDENTS.map(x => x._eventType)), "All event types");
    fillSelect(els.phase, uniqueSorted(INCIDENTS.map(x => x._phase)), "All phases");

    if (els.search) els.search.addEventListener("input", applyFilters);
    [els.state, els.event, els.phase, els.sort, els.year, els.month]
      .filter(Boolean)
      .forEach(el => el.addEventListener("change", applyFilters));

    els.status.textContent = "Loaded OK (narrative column: raw_narrative)";
    els.rowCount.textContent = `Rows detected: ${INCIDENTS.length}`;

    FILTERED = [...INCIDENTS];
    applyFilters();
  } catch (e) {
    console.error(e);
    els.status.textContent = `Load error: ${e.message || e}`;
  }
}

function csvEscape(value) {
  const s = (value ?? "").toString();
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsvFromObjects(objs) {
  if (!objs || !objs.length) return "";
  const cols = Object.keys(objs[0]).filter(k => !k.startsWith("_"));
  const headerLine = cols.map(csvEscape).join(",");
  const lines = objs.map(o => cols.map(c => csvEscape(o[c])).join(","));
  return [headerLine, ...lines].join("\n");
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}

if (els.downloadBtn) {
  els.downloadBtn.addEventListener("click", () => {
    const rows = (FILTERED && FILTERED.length) ? FILTERED : INCIDENTS;

    const exportRows = rows.map(r => {
      const out = {};
      for (const k in r) if (!k.startsWith("_")) out[k] = r[k];
      return out;
    });

    const csv = buildCsvFromObjects(exportRows);
    const stamp = new Date().toISOString().slice(0,10);
    downloadTextFile(`incidents_export_${stamp}.csv`, csv);
  });
}

init();