/* app.js — static GitHub Pages CSV viewer (no build)
   Expects: ./data/incidents.csv
   Uses narrative column: raw_narrative
*/

const CSV_PATH = "./data/incidents.csv";

// ---------- tiny helpers ----------
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function norm(s) {
  return String(s ?? "").trim();
}

function upper(s) {
  return norm(s).toUpperCase();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseIsoDateMaybe(s) {
  // accepts YYYY-MM-DD or ISO-ish; returns Date or null
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function displayDateFromRow(r) {
  // Prefer event_date, else try event_datetime_z
  const d1 = parseIsoDateMaybe(r.event_date);
  if (d1) return d1.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const d2 = parseIsoDateMaybe(r.event_datetime_z);
  if (d2) return d2.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return "Unknown date";
}

function sortKeyDatetime(r) {
  // Use event_datetime_z primarily; fallback to event_date
  const d = parseIsoDateMaybe(r.event_datetime_z) || parseIsoDateMaybe(r.event_date);
  return d ? d.getTime() : -Infinity;
}

// ---------- robust CSV parser (handles commas + newlines inside quotes) ----------
function parseCsv(text) {
  // Normalizes line endings, then state-machine parse
  const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  // last field
  row.push(field);
  rows.push(row);

  // Trim trailing empty rows
  while (rows.length && rows[rows.length - 1].every((c) => norm(c) === "")) rows.pop();

  return rows;
}

// ---------- DOM wiring ----------
const els = {
  q: $("#q"),
  state: $("#state"),
  eventType: $("#eventType"),
  phase: $("#phase"),
  sort: $("#sort"),
  results: $("#results"),
  status: $("#status"),
  count: $("#count"),
  download: $("#download"),
  reset: $("#reset"),
};

function requireEls() {
  const missing = Object.entries(els)
    .filter(([_, el]) => !el)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing required HTML element id(s): ${missing.join(
        ", "
      )}. Your index.html must have elements with ids: q, state, eventType, phase, sort, results, status, count, download, reset.`
    );
  }
}

// ---------- app state ----------
let allRows = [];
let filteredRows = [];
let headers = [];

function setStatus(msg, ok = true) {
  els.status.textContent = msg;
  els.status.classList.toggle("bad", !ok);
  els.status.classList.toggle("ok", ok);
}

function setCount(n) {
  els.count.textContent = String(n);
}

function uniqSorted(values) {
  const set = new Set(values.filter((v) => norm(v) !== ""));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function fillSelect(selectEl, values, placeholder) {
  const prev = selectEl.value;
  selectEl.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }

  // try to keep prior selection if still present
  if (prev && values.includes(prev)) selectEl.value = prev;
}

function buildIndexableText(r) {
  // search across high-value fields
  return [
    r.raw_narrative,
    r.context_parens,
    r.city,
    r.state,
    r.airport_code,
    r.facility,
    r.aircraft_primary,
    r.aircraft_primary_model,
    r.n_numbers,
    r.phase,
    r.event_type,
    r.damage,
    r.injuries,
    r.pob,
  ]
    .map((x) => norm(x))
    .filter(Boolean)
    .join(" • ")
    .toLowerCase();
}

function applyFilters() {
  const q = norm(els.q.value).toLowerCase();
  const st = norm(els.state.value);
  const et = norm(els.eventType.value);
  const ph = norm(els.phase.value);
  const sort = norm(els.sort.value);

  filteredRows = allRows.filter((r) => {
    if (st && r.state !== st) return false;
    if (et && r.event_type !== et) return false;
    if (ph && r.phase !== ph) return false;
    if (q) {
      const hay = r.__search || "";
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // sort
  if (sort === "oldest") {
    filteredRows.sort((a, b) => sortKeyDatetime(a) - sortKeyDatetime(b));
  } else if (sort === "az") {
    filteredRows.sort((a, b) => (a.__title || "").localeCompare(b.__title || ""));
  } else {
    // newest default
    filteredRows.sort((a, b) => sortKeyDatetime(b) - sortKeyDatetime(a));
  }

  render();
}

function makeTitle(r) {
  const city = norm(r.city) || "Unknown location";
  const state = norm(r.state) || "";
  const dateStr = displayDateFromRow(r);
  return `${city}${state ? ", " + state : ""} — ${dateStr}`;
}

function render() {
  els.results.innerHTML = "";

  setCount(filteredRows.length);

  if (!filteredRows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No results match your filters.";
    els.results.appendChild(empty);
    return;
  }

  for (const r of filteredRows) {
    const card = document.createElement("div");
    card.className = "card";

    const title = makeTitle(r);

    const badgeText = norm(r.event_type) || "EVENT";

    const header = document.createElement("div");
    header.className = "card-header";
    header.innerHTML = `
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="badge">${escapeHtml(badgeText)}</div>
    `;

    const meta = document.createElement("div");
    meta.className = "meta";

    // concise meta line
    const metaParts = [];
    if (r.state) metaParts.push(`<span><b>State:</b> ${escapeHtml(r.state)}</span>`);
    if (r.facility) metaParts.push(`<span><b>Facility:</b> ${escapeHtml(r.facility)}</span>`);
    if (r.airport_code) metaParts.push(`<span><b>Airport:</b> ${escapeHtml(r.airport_code)}</span>`);
    if (r.aircraft_primary) metaParts.push(`<span><b>Tail:</b> ${escapeHtml(r.aircraft_primary)}</span>`);
    if (r.aircraft_primary_model) metaParts.push(`<span><b>Model:</b> ${escapeHtml(r.aircraft_primary_model)}</span>`);
    if (r.phase) metaParts.push(`<span><b>Phase:</b> ${escapeHtml(r.phase)}</span>`);
    if (r.pob) metaParts.push(`<span><b>POB:</b> ${escapeHtml(r.pob)}</span>`);
    if (r.injuries) metaParts.push(`<span><b>Injuries:</b> ${escapeHtml(r.injuries)}</span>`);
    if (r.damage) metaParts.push(`<span><b>Damage:</b> ${escapeHtml(r.damage)}</span>`);

    meta.innerHTML = metaParts.join(" ");

    // narrative (raw_narrative first, else context_parens fallback)
    const narrativeRaw = norm(r.raw_narrative) || norm(r.context_parens) || "No narrative provided.";
    const narrativeClean = narrativeRaw.replace(/\s+\n/g, "\n").trim();

    const narrative = document.createElement("div");
    narrative.className = "narrative";

    const maxLen = 320;
    const isLong = narrativeClean.length > maxLen;

    const shortText = isLong ? narrativeClean.slice(0, maxLen).trimEnd() + "…" : narrativeClean;

    const p = document.createElement("div");
    p.className = "narrative-text";
    p.textContent = shortText;

    narrative.appendChild(p);

    if (isLong) {
      const btn = document.createElement("button");
      btn.className = "btn-secondary";
      btn.type = "button";
      btn.textContent = "View full";

      let expanded = false;
      btn.addEventListener("click", () => {
        expanded = !expanded;
        p.textContent = expanded ? narrativeClean : shortText;
        btn.textContent = expanded ? "Show less" : "View full";
      });

      narrative.appendChild(btn);
    }

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(narrative);

    els.results.appendChild(card);
  }
}

function downloadCsvOriginal() {
  // downloads the exact file we fetched (not re-serialized)
  fetch(CSV_PATH, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("CSV download failed");
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "incidents.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch((e) => alert(e.message || String(e)));
}

function resetFilters() {
  els.q.value = "";
  els.state.value = "";
  els.eventType.value = "";
  els.phase.value = "";
  els.sort.value = "newest";
  applyFilters();
}

// ---------- init ----------
async function init() {
  requireEls();

  // Ensure sort options exist (in case index.html didn't define them)
  // We won't overwrite if already has options.
  if (!els.sort.querySelector("option")) {
    els.sort.innerHTML = `
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="az">A–Z</option>
    `;
  }
  if (!els.sort.value) els.sort.value = "newest";

  setStatus("Loading…", true);

  try {
    const res = await fetch(CSV_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Unable to load CSV at ${CSV_PATH} (HTTP ${res.status})`);
    const csvText = await res.text();

    const rows = parseCsv(csvText);
    if (!rows.length) throw new Error("CSV appears empty");
    headers = rows[0].map((h) => norm(h));

    const dataRows = rows.slice(1).filter((r) => r.some((c) => norm(c) !== ""));
    if (!dataRows.length) throw new Error("CSV has headers but no data rows");

    // Map into objects by header
    allRows = dataRows.map((arr) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = arr[i] ?? ""));

      // Normalize common fields (keep originals too)
      obj.report_date = norm(obj.report_date);
      obj.event_datetime_z = norm(obj.event_datetime_z);
      obj.event_date = norm(obj.event_date);
      obj.event_time_z = norm(obj.event_time_z);
      obj.city = norm(obj.city);
      obj.state = upper(obj.state);
      obj.airport_code = upper(obj.airport_code);
      obj.facility = norm(obj.facility);
      obj.aircraft_primary = norm(obj.aircraft_primary);
      obj.aircraft_primary_model = norm(obj.aircraft_primary_model);
      obj.n_numbers = norm(obj.n_numbers);
      obj.phase = norm(obj.phase);
      obj.event_type = norm(obj.event_type);
      obj.pob = norm(obj.pob);
      obj.injuries = norm(obj.injuries);
      obj.damage = norm(obj.damage);
      obj.context_parens = norm(obj.context_parens);
      obj.raw_narrative = norm(obj.raw_narrative);

      obj.__title = makeTitle(obj);
      obj.__search = buildIndexableText(obj);

      return obj;
    });

    // Fill dropdowns
    fillSelect(els.state, uniqSorted(allRows.map((r) => r.state)), "All states");
    fillSelect(els.eventType, uniqSorted(allRows.map((r) => r.event_type)), "All event types");
    fillSelect(els.phase, uniqSorted(allRows.map((r) => r.phase)), "All phases");

    // Hook events
    els.q.addEventListener("input", applyFilters);
    els.state.addEventListener("change", applyFilters);
    els.eventType.addEventListener("change", applyFilters);
    els.phase.addEventListener("change", applyFilters);
    els.sort.addEventListener("change", applyFilters);

    els.download.addEventListener("click", downloadCsvOriginal);
    els.reset.addEventListener("click", resetFilters);

    setStatus("Loaded OK", true);
    applyFilters();
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Load failed", false);
    els.results.innerHTML = `<div class="empty">Load failed. Check console for details.</div>`;
    setCount(0);
  }
}

init();
