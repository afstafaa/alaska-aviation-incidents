// app.js
(() => {
  const CSV_PATH = "./data/incidents.csv";

  const el = (id) => document.getElementById(id);
  const resultsEl = el("results");
  const statusEl = el("statusMessage");
  const rowCountEl = el("rowCount");

  const searchEl = el("search");
  const stateFilterEl = el("stateFilter");
  const eventFilterEl = el("eventFilter");
  const phaseFilterEl = el("phaseFilter");
  const sortOrderEl = el("sortOrder");

  let allRows = [];
  let filteredRows = [];

  // --- Helpers: column mapping (handles different header names) ---
  const pick = (row, ...keys) => {
    for (const k of keys) {
      if (!k) continue;
      if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
    }
    return "";
  };

  const boolishYesNo = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) return "Unknown";
    if (["yes", "y", "true", "1"].includes(s)) return "Yes";
    if (["no", "n", "false", "0"].includes(s)) return "No";
    return String(v).trim();
  };

  // Robust CSV parser that supports commas/newlines inside quotes
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    // normalize line endings but keep real newlines for parsing
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (c === '"' && next === '"') { // escaped quote
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
          rows.push(row);
          row = [];
          field = "";
        } else if (c === "\r") {
          // ignore \r
        } else {
          field += c;
        }
      }
    }

    // flush last row
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function toObjects(table) {
    if (!table.length) return [];
    const headers = table[0].map(h => (h ?? "").trim());
    const out = [];

    for (let r = 1; r < table.length; r++) {
      const line = table[r];
      if (!line || line.every(v => String(v ?? "").trim() === "")) continue;

      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c] || `col_${c}`;
        obj[key] = (line[c] ?? "").trim();
      }
      out.push(obj);
    }
    return out;
  }

  // Date helpers
  const pad2 = (n) => String(n).padStart(2, "0");

  function parseZDate(row) {
    // Prefer ISO Z date-time
    const iso = pick(row, "event_datetime_z", "event_datetime_utc", "event_time_utc", "event_dt_z");
    if (iso) {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }

    // Fallback: event_date + event_time_z like "8/23/2025" + "2018Z"
    const dStr = pick(row, "event_date", "date", "eventDate");
    const tStr = pick(row, "event_time_z", "time_z", "eventTimeZ");
    if (dStr && tStr) {
      // try to build "YYYY-MM-DDTHH:MM:SSZ" (but we only have HHMMZ)
      const cleaned = String(tStr).toUpperCase().replace("Z", "").trim();
      const hh = cleaned.slice(0, 2);
      const mm = cleaned.slice(2, 4);
      const date = new Date(`${dStr} 00:00:00`);
      if (!isNaN(date.getTime()) && hh && mm) {
        // construct in UTC
        const y = date.getFullYear();
        const m = pad2(date.getMonth() + 1);
        const day = pad2(date.getDate());
        const iso2 = `${y}-${m}-${day}T${hh}:${mm}:00Z`;
        const d2 = new Date(iso2);
        if (!isNaN(d2.getTime())) return d2;
      }
    }
    return null;
  }

  function formatAnchorageTime(dateObj) {
    if (!dateObj) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Anchorage",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName: "short"
      }).formatToParts(dateObj);

      const hh = parts.find(p => p.type === "hour")?.value ?? "";
      const mm = parts.find(p => p.type === "minute")?.value ?? "";
      const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "AK";
      return `${hh}:${mm} ${tz}`;
    } catch {
      return "";
    }
  }

  function formatMDY(dateObj) {
    if (!dateObj) return "";
    const m = dateObj.getUTCMonth() + 1;
    const d = dateObj.getUTCDate();
    const y = dateObj.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }

  function formatZHHMM(dateObj, row) {
    // If CSV already provides 2018Z, prefer it
    const t = pick(row, "event_time_z", "time_z");
    if (t) {
      const cleaned = String(t).trim();
      return cleaned.toUpperCase().endsWith("Z") ? cleaned.toUpperCase() : `${cleaned}Z`;
    }
    if (!dateObj) return "";
    const hh = pad2(dateObj.getUTCHours());
    const mm = pad2(dateObj.getUTCMinutes());
    return `${hh}${mm}Z`;
  }

  // Narrative: MUST use raw_narrative (with fallback)
  function getNarrative(row) {
    return pick(
      row,
      "raw_narrative",
      "narrative",
      "context_parens",
      "context",
      "description"
    );
  }

  // Card lines
  function getLine1(row) {
    const n = pick(row, "aircraft_primary", "aircraft_1_nnumber", "n_number", "n_numbers", "tail", "tail_number");
    const model = pick(row, "aircraft_primary_model", "aircraft_1_type", "aircraft_model", "model");
    const left = n || "Unknown aircraft";
    const right = model || "Unknown model";
    return `${left} • ${right}`;
  }

  function getLine2(row, zDate) {
    const airportName = pick(row, "airport_name");
    const city = pick(row, "city");
    const state = pick(row, "state");
    const airportCode = pick(row, "airport_code");

    // Prefer "Airport Name, ST" if present, else "City, ST"
    let place = "";
    if (airportName && state) place = `${airportName}, ${state}`;
    else if (city && state) place = `${city}, ${state}`;
    else if (airportName) place = airportName;
    else if (city) place = city;
    else place = "Unknown location";

    // If you prefer showing airport code too, uncomment:
    // if (airportCode) place = `${place} (${airportCode})`;

    const dateMDY = formatMDY(zDate) || pick(row, "event_date") || "Unknown date";
    const zHHMM = formatZHHMM(zDate, row);
    const ak = formatAnchorageTime(zDate);

    // Example: Merrill Field, AK • 8/23/2025 (2018Z / 11:18 AKDT)
    const timePart = zHHMM || ak ? ` (${[zHHMM, ak].filter(Boolean).join(" / ")})` : "";
    return `${place} • ${dateMDY}${timePart}`;
  }

  // Metadata chips (exactly what you requested)
  function buildMetaChips(row) {
    const report = pick(row, "report_date", "report_dt", "report");
    const phase = pick(row, "phase");
    const type = pick(row, "event_type", "type", "event");
    const pob = pick(row, "pob", "persons_on_board", "persons_onboard");
    const injuries = pick(row, "injuries", "injury", "injury_level");
    const damage = pick(row, "damage", "aircraft_damage");
    const f8020 = pick(row, "form_8020_9", "8020_9", "form8020_9", "faa_form_8020_9");

    const items = [
      ["Report", report || "Unknown"],
      ["Phase", phase || "Unknown"],
      ["Type", type || "Unknown"],
      ["POB", pob || "Unknown"],
      ["Injuries", injuries || "Unknown"],
      ["Damage", damage || "Unknown"],
      ["8020-9", f8020 ? boolishYesNo(f8020) : "Unknown"],
    ];

    const wrap = document.createElement("div");
    wrap.className = "metaLine";

    for (const [label, value] of items) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`;
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Filters/options
  function uniqueSorted(values) {
    return [...new Set(values.filter(v => String(v ?? "").trim() !== ""))]
      .map(v => String(v).trim())
      .sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(selectEl, labelAll, values) {
    selectEl.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = labelAll;
    selectEl.appendChild(optAll);

    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    }
  }

  function applyFilters() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const st = stateFilterEl.value;
    const ev = eventFilterEl.value;
    const ph = phaseFilterEl.value;
    const sort = sortOrderEl.value;

    filteredRows = allRows.filter(r => {
      const state = pick(r, "state");
      const eventType = pick(r, "event_type", "type");
      const phase = pick(r, "phase");

      if (st && state !== st) return false;
      if (ev && eventType !== ev) return false;
      if (ph && phase !== ph) return false;

      if (!q) return true;

      const hay = [
        getNarrative(r),
        pick(r, "city"),
        pick(r, "airport_name"),
        pick(r, "airport_code"),
        pick(r, "facility"),
        pick(r, "aircraft_primary"),
        pick(r, "aircraft_primary_model"),
        pick(r, "n_numbers"),
        pick(r, "aircraft_1_nnumber"),
      ].join(" | ").toLowerCase();

      return hay.includes(q);
    });

    // sort by event_datetime_z if possible, else event_date
    filteredRows.sort((a, b) => {
      const da = parseZDate(a);
      const db = parseZDate(b);
      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      return sort === "oldest" ? ta - tb : tb - ta;
    });

    render();
  }

  function render() {
    resultsEl.innerHTML = "";

    rowCountEl.textContent = `Rows detected: ${allRows.length}`;
    statusEl.textContent = `Loaded OK (narrative column: raw_narrative)`;

    if (!filteredRows.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.textContent = "No results match your filters.";
      resultsEl.appendChild(empty);
      return;
    }

    for (const row of filteredRows) {
      const zDate = parseZDate(row);
      const narrativeRaw = getNarrative(row);
      const previewText = narrativeRaw || "No narrative provided.";

      const card = document.createElement("article");
      card.className = "card";

      const line1 = document.createElement("div");
      line1.className = "line1";
      line1.textContent = getLine1(row);

      const line2 = document.createElement("div");
      line2.className = "line2";
      line2.textContent = getLine2(row, zDate);

      const narrRow = document.createElement("div");
      narrRow.className = "narrRow";

      const narrPreview = document.createElement("div");
      narrPreview.className = "narrPreview";
      narrPreview.textContent = previewText;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "expandBtn";
      btn.textContent = "Expand";

      const narrFull = document.createElement("div");
      narrFull.className = "narrFull";
      narrFull.textContent = narrativeRaw || "No narrative provided.";

      const meta = buildMetaChips(row);

      btn.addEventListener("click", () => {
        const expanded = card.classList.toggle("expanded");
        btn.textContent = expanded ? "Collapse" : "Expand";
        if (expanded) {
          // ensure full text visible/scroll friendly
          narrFull.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });

      narrRow.appendChild(narrPreview);
      narrRow.appendChild(btn);

      card.appendChild(line1);
      card.appendChild(line2);
      card.appendChild(narrRow);
      card.appendChild(narrFull);
      card.appendChild(meta);

      resultsEl.appendChild(card);
    }
  }

  function wireEvents() {
    const onChange = () => applyFilters();
    searchEl.addEventListener("input", onChange);
    stateFilterEl.addEventListener("change", onChange);
    eventFilterEl.addEventListener("change", onChange);
    phaseFilterEl.addEventListener("change", onChange);
    sortOrderEl.addEventListener("change", onChange);
  }

  async function init() {
    try {
      statusEl.textContent = `Loading ${CSV_PATH}…`;

      const resp = await fetch(CSV_PATH, { cache: "no-store" });
      if (!resp.ok) throw new Error(`Unable to load CSV (${resp.status})`);

      const csvText = await resp.text();
      const table = parseCsv(csvText);
      const objs = toObjects(table);

      allRows = objs;
      rowCountEl.textContent = `Rows detected: ${allRows.length}`;

      // Fill filter dropdowns
      fillSelect(stateFilterEl, "All states", uniqueSorted(allRows.map(r => pick(r, "state"))));
      fillSelect(eventFilterEl, "All event types", uniqueSorted(allRows.map(r => pick(r, "event_type", "type"))));
      fillSelect(phaseFilterEl, "All phases", uniqueSorted(allRows.map(r => pick(r, "phase"))));

      statusEl.textContent = "Loaded OK";

      filteredRows = [...allRows];
      applyFilters();
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Error: ${err.message || err}`;
    }
  }

  wireEvents();
  init();
})();
