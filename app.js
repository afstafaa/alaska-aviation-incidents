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
  // items: [{title,url,publisher,date,type,platform}]
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

  // If everything got filtered due to missing URLs:
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

  // Sources / Media / Aircraft image
  const sourcesJson = getAny(row, ["sources_json"]);
  const mediaJson = getAny(row, ["media_json"]);
  const aircraftImageUrl = getAny(row, ["aircraft_image_url"]);
  const aircraftImageType = getAny(row, ["aircraft_image_type"]); // actual | similar

  const localTime = formatLocalFromISO(eventISO, state);

  const line2Left = [city || (airport ? airport : ""), state].filter(Boolean).join(", ");
  const line2Right = [eventDate || "", eventTimeZ ? `${eventTimeZ}` : "", localTime ? `${localTime}` : ""].filter(Boolean);

  const line2 = line2Right.length
    ? `${line2Left} • ${line2Right[0]} (${line2Right.slice(1).join(" / ")})`
    : (line2Left || "Unknown location • Unknown date");

  const haystack = [
    tail, model, city, state, airport, eventType, phase,
    reportDate, pob, injuries, damage, form8020,
    eventDate, eventTimeZ, narrative, sourcesJson, mediaJson, aircraftImageUrl, aircraftImageType,
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

    // Narrative label (always visible)
    const narrLabel = document.createElement("div");
    narrLabel.className = "detailLabel";
    narrLabel.textContent = "Narrative";
    narrText.appendChild(narrLabel);

    // Narrative text (one element; clamped until expanded)
    const narrTextEl = document.createElement("div");
    narrTextEl.className = "narrTextBlock";
    narrTextEl.textContent = it._narrative;
    narrText.appendChild(narrTextEl);

    // Sources (expanded only)
    const sourcesBlock = buildLinksBlock(it._sources);
    const sourcesSection = mkLabeledSection("Sources", sourcesBlock);
    sourcesSection.classList.add("onlyExpanded");
    narrText.appendChild(sourcesSection);

    // Media (expanded only)
    const mediaBlock = buildLinksBlock(it._media);
    const mediaSection = mkLabeledSection("Media", mediaBlock);
    mediaSection.classList.add("onlyExpanded");
    narrText.appendChild(mediaSection);

    // Aircraft Image (expanded only)
    const imgWrap = document.createElement("div");
    imgWrap.className = "onlyExpanded";

    const imgUrl = norm(it._aircraftImageUrl);
    const imgType = (it._aircraftImageType || "").toLowerCase();

    if (!imgUrl) {
      const none = document.createElement("div");
      none.className = "noneText";
      none.textContent = "None";
      imgWrap.appendChild(none);
    } else {
      const a = document.createElement("a");
      a.href = imgUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      const label = (imgType === "actual") ? "Actual Image"
                  : (imgType === "similar") ? "Similar Aircraft"
                  : "Aircraft Image";

      a.textContent = `View (${label})`;
      imgWrap.appendChild(a);
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

    // Populate dropdowns
    populateYearMonthFilters(INCIDENTS);
    fillSelect(els.state, uniqueSorted(INCIDENTS.map(x => x._state)), "All states");
    fillSelect(els.event, uniqueSorted(INCIDENTS.map(x => x._eventType)), "All event types");
    fillSelect(els.phase, uniqueSorted(INCIDENTS.map(x => x._phase)), "All phases");

    // Hook events
    if (els.search) els.search.addEventListener("input", applyFilters);
    [els.state, els.event, els.phase, els.sort, els.year, els.month]
      .filter(Boolean)
      .forEach(el => el.addEventListener("change", applyFilters));

    els.status.textContent = "Loaded OK (narrative column: raw_narrative)";
    els.rowCount.textContent = `Rows detected: ${INCIDENTS.length}`;

    // initial render
    FILTERED = [...INCIDENTS];
    applyFilters();
  } catch (e) {
    console.error(e);
    els.status.textContent = `Load error: ${e.message || e}`;
  }
}

function csvEscape(value) {
  const s = (value ?? "").toString();
  // wrap in quotes if it contains comma, quote, or newline
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsvFromObjects(objs) {
  if (!objs || !objs.length) return "";

  // Use the original CSV headers if possible (from first object keys)
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

// Download filtered CSV
if (els.downloadBtn) {
  els.downloadBtn.addEventListener("click", () => {
    const rows = (FILTERED && FILTERED.length) ? FILTERED : INCIDENTS;

    // Export ONLY original CSV columns (no _fields)
    const exportRows = rows.map(r => {
      const out = {};
      for (const k in r) {
        if (!k.startsWith("_")) out[k] = r[k];
      }
      return out;
    });

    const csv = buildCsvFromObjects(exportRows);
    const stamp = new Date().toISOString().slice(0,10);
    downloadTextFile(`incidents_export_${stamp}.csv`, csv);
  });
}

init();
