/* app.js — Static CSV-powered incident browser for GitHub Pages
   - Fetches ./data/incidents.csv
   - Robust CSV parsing (quoted fields, commas, newlines)
   - Search + filter + sort + download
   - Flexible field mapping (context/narrative/issue_1... etc.)
*/

(() => {
  const CSV_PATH = "./data/incidents.csv";

  // ---------- tiny helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const norm = (v) => String(v ?? "").trim();
  const has = (v) => norm(v).length > 0;

  function pick(obj, ...keys) {
    for (const k of keys) {
      if (k in obj && has(obj[k])) return norm(obj[k]);
      // also try case-insensitive match
      const key2 = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
      if (key2 && has(obj[key2])) return norm(obj[key2]);
    }
    return "";
  }

  function toNumberMaybe(v) {
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
  }

  // ---------- robust CSV parser (handles quotes/newlines) ----------
  function parseCsv(text) {
    // Normalize newlines
    const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < s.length; i++) {
      const c = s[i];

      if (inQuotes) {
        if (c === '"') {
          // escaped quote?
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        continue;
      }

      if (c === ",") {
        row.push(field);
        field = "";
        continue;
      }

      if (c === "\n") {
        row.push(field);
        field = "";
        // ignore completely empty trailing row
        if (row.some((x) => String(x).trim().length > 0)) rows.push(row);
        row = [];
        continue;
      }

      field += c;
    }

    // final field
    row.push(field);
    if (row.some((x) => String(x).trim().length > 0)) rows.push(row);

    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0].map((h) => norm(h));
    const out = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      // allow short rows
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]] = r[c] ?? "";
      }
      out.push(obj);
    }
    return out;
  }

  // ---------- date handling ----------
  function parseDateKey(obj) {
    // Prefer event_date, then event_datetime_z, then report_date
    const eventDate = pick(obj, "event_date");
    const eventDT = pick(obj, "event_datetime_z", "event_datetime", "event_datetime_utc", "event_time_utc");
    const reportDate = pick(obj, "report_date", "report_datetime", "date");

    // event_date might be like 8/18/2025
    if (has(eventDate)) {
      const d = new Date(eventDate);
      if (!isNaN(d.getTime())) return d.getTime();
      // try MM/DD/YYYY manually
      const m = eventDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mm = Number(m[1]), dd = Number(m[2]), yy = Number(m[3]);
        const d2 = new Date(Date.UTC(yy, mm - 1, dd));
        if (!isNaN(d2.getTime())) return d2.getTime();
      }
    }

    // ISO
    if (has(eventDT)) {
      const d = new Date(eventDT);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    if (has(reportDate)) {
      const d = new Date(reportDate);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    return 0;
  }

  function formatDateForTitle(obj) {
    const eventDate = pick(obj, "event_date");
    const eventDT = pick(obj, "event_datetime_z", "event_datetime");
    const reportDate = pick(obj, "report_date");

    // use event_date if exists
    if (has(eventDate)) return eventDate;

    if (has(eventDT)) {
      const d = new Date(eventDT);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    }
    if (has(reportDate)) return reportDate;
    return "";
  }

  // ---------- normalize to display model ----------
  function toDisplayModel(obj) {
    const city = pick(obj, "city", "location_city");
    const state = pick(obj, "state", "location_state");
    const airport = pick(obj, "airport_code", "airport", "apt", "icao", "iata");
    const facility = pick(obj, "facility", "facility_name");
    const phase = pick(obj, "phase", "flight_phase");
    const eventType = pick(obj, "event_type", "eventType", "type", "occurrence", "occurrence_type");

    const tail = pick(obj, "n_numbers", "aircraft_1_nnumber", "aircraft_nnumber", "tail", "tail_number", "registration");
    const model = pick(obj, "aircraft_primary_model", "aircraft_1_type", "aircraft_type", "model");
    const operator = pick(obj, "operator", "air_carrier", "company", "operator_name");

    const pob = pick(obj, "pob", "persons_on_board", "personsOnBoard");
    const injuries = pick(obj, "injuries", "injury", "injuries_total");
    const damage = pick(obj, "damage", "aircraft_damage", "damage_level");

    // --- narrative: prefer context/narrative-like columns; else join issue_*
    const issueParts = Object.keys(obj)
      .filter((k) => /^issue[_\s-]?\d+$/i.test(k) || /^issue[_\s-]?(one|two|three|four|five)$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((k) => norm(obj[k]))
      .filter(Boolean);

    const narrative =
      pick(
        obj,
        "context",
        "narrative",
        "remarks",
        "description",
        "details",
        "synopsis",
        "event_description",
        "event_description_text",
        "summary",
        "text",
        "note",
        "notes",
        "probable_cause",
        "sequence_of_events"
      ) || (issueParts.length ? issueParts.join(" ") : "");

    const when = formatDateForTitle(obj);
    const dateKey = parseDateKey(obj);

    const titleLeft = has(city) ? `${city}${has(state) ? `, ${state}` : ""}` : (has(state) ? state : "Unknown location");
    const title = `${titleLeft}${has(when) ? ` — ${when}` : ""}`;

    return {
      raw: obj,
      title,
      dateKey,
      city,
      state,
      airport,
      facility,
      phase,
      eventType,
      tail,
      model,
      operator,
      pob,
      injuries,
      damage,
      narrative: has(narrative) ? narrative : "No narrative provided.",
    };
  }

  // ---------- UI bootstrap (creates elements if missing) ----------
  function ensureUI() {
    // If your index.html already has these, we use them.
    // Otherwise we inject a minimal working UI.
    const needed = ["#q", "#state", "#eventType", "#phase", "#sort", "#downloadBtn", "#resetBtn", "#status", "#count", "#results"];
    const missing = needed.some((sel) => !$(sel));

    if (!missing) return;

    document.body.innerHTML = `
      <main style="max-width:1100px;margin:32px auto;padding:0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
        <h1 style="margin:0 0 8px;">Alaska Aviation Incidents</h1>
        <div style="margin:0 0 16px;color:#555;">Search & filter your <code>${escapeHtml(CSV_PATH)}</code> (client-side)</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px;border:1px solid #ddd;border-radius:12px;">
          <input id="q" placeholder="Search narrative, city, airport, tail..." style="flex:1;min-width:260px;padding:10px;border-radius:10px;border:1px solid #ccc;">
          <select id="state" style="padding:10px;border-radius:10px;border:1px solid #ccc;min-width:140px;"></select>
          <select id="eventType" style="padding:10px;border-radius:10px;border:1px solid #ccc;min-width:160px;"></select>
          <select id="phase" style="padding:10px;border-radius:10px;border:1px solid #ccc;min-width:160px;"></select>
          <select id="sort" style="padding:10px;border-radius:10px;border:1px solid #ccc;min-width:140px;">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <button id="downloadBtn" style="padding:10px 14px;border-radius:10px;border:1px solid #0b5;cursor:pointer;background:#0b5;color:white;">Download CSV</button>
          <button id="resetBtn" style="padding:10px 14px;border-radius:10px;border:1px solid #ccc;cursor:pointer;background:#fff;">Reset</button>
        </div>

        <div style="display:flex;gap:12px;align-items:center;margin:12px 0 18px;color:#555;">
          <div id="status">Loading…</div>
          <div id="count"></div>
        </div>

        <div id="results"></div>
      </main>
    `;
  }

  function setSelectOptions(selectEl, values, labelAll) {
    const sel = selectEl;
    const cur = sel.value;
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = labelAll;
    sel.appendChild(opt0);

    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }

    // keep selection if still valid
    if (cur && values.includes(cur)) sel.value = cur;
  }

  function downloadCSV(filename, headers, rows) {
    const esc = (v) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    const lines = [];
    lines.push(headers.map(esc).join(","));
    for (const r of rows) {
      lines.push(headers.map((h) => esc(r[h])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderCard(item) {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.style.cssText = `
      border:1px solid #e5e7eb;border-radius:16px;padding:14px 14px 12px;
      margin:0 0 12px;background:#fff;box-shadow:0 1px 0 rgba(0,0,0,.02);
    `;

    const top = document.createElement("div");
    top.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:10px;";

    const h = document.createElement("div");
    h.innerHTML = `<div style="font-weight:800;font-size:18px;margin:0 0 6px;">${escapeHtml(item.title)}</div>`;

    const tag = document.createElement("div");
    tag.style.cssText = `
      font-size:12px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;
      padding:6px 10px;border-radius:999px;background:#eef2ff;color:#3730a3;
      white-space:nowrap;align-self:flex-start;
    `;
    tag.textContent = item.eventType || "Event";

    top.appendChild(h);
    top.appendChild(tag);

    const metaBits = [];
    if (has(item.state)) metaBits.push(`<span><b>State:</b> ${escapeHtml(item.state)}</span>`);
    if (has(item.airport)) metaBits.push(`<span><b>Airport:</b> ${escapeHtml(item.airport)}</span>`);
    if (has(item.facility)) metaBits.push(`<span><b>Facility:</b> ${escapeHtml(item.facility)}</span>`);
    if (has(item.tail)) metaBits.push(`<span><b>Tail:</b> ${escapeHtml(item.tail)}</span>`);
    if (has(item.model)) metaBits.push(`<span><b>Model:</b> ${escapeHtml(item.model)}</span>`);
    if (has(item.phase)) metaBits.push(`<span><b>Phase:</b> ${escapeHtml(item.phase)}</span>`);
    if (has(item.pob)) metaBits.push(`<span><b>POB:</b> ${escapeHtml(item.pob)}</span>`);
    if (has(item.injuries)) metaBits.push(`<span><b>Injuries:</b> ${escapeHtml(item.injuries)}</span>`);
    if (has(item.damage)) metaBits.push(`<span><b>Damage:</b> ${escapeHtml(item.damage)}</span>`);

    const meta = document.createElement("div");
    meta.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;color:#374151;font-size:13px;margin:8px 0 10px;";
    meta.innerHTML = metaBits.join("");

    const narrative = document.createElement("div");
    narrative.style.cssText = "color:#111827;font-size:14px;line-height:1.4;white-space:pre-wrap;";

    const fullText = item.narrative || "";
    const shortText = fullText.length > 220 ? fullText.slice(0, 220).trim() + "…" : fullText;
    let expanded = false;
    narrative.textContent = shortText;

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "margin-top:10px;display:flex;gap:10px;align-items:center;";

    if (fullText.length > 220) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.style.cssText = "border:1px solid #d1d5db;background:#fff;padding:7px 10px;border-radius:10px;cursor:pointer;font-weight:600;";
      toggle.textContent = "View full";
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        narrative.textContent = expanded ? fullText : shortText;
        toggle.textContent = expanded ? "Show less" : "View full";
      });
      btnRow.appendChild(toggle);
    }

    wrap.appendChild(top);
    wrap.appendChild(meta);
    wrap.appendChild(narrative);
    if (btnRow.children.length) wrap.appendChild(btnRow);

    return wrap;
  }

  // ---------- main ----------
  async function main() {
    ensureUI();

    const qEl = $("#q");
    const stateEl = $("#state");
    const typeEl = $("#eventType");
    const phaseEl = $("#phase");
    const sortEl = $("#sort");
    const downloadBtn = $("#downloadBtn");
    const resetBtn = $("#resetBtn");
    const statusEl = $("#status");
    const countEl = $("#count");
    const resultsEl = $("#results");

    let rawRows = [];
    let items = [];

    function setStatus(msg, ok = true) {
      statusEl.textContent = msg;
      statusEl.style.color = ok ? "#065f46" : "#b91c1c";
      statusEl.style.fontWeight = "700";
    }

    function rebuildFilters() {
      const states = Array.from(new Set(items.map((x) => x.state).filter(has))).sort();
      const types = Array.from(new Set(items.map((x) => x.eventType).filter(has))).sort();
      const phases = Array.from(new Set(items.map((x) => x.phase).filter(has))).sort();

      setSelectOptions(stateEl, states, "All states");
      setSelectOptions(typeEl, types, "All event types");
      setSelectOptions(phaseEl, phases, "All phases");
    }

    function applyFilters() {
      const q = norm(qEl.value).toLowerCase();
      const st = stateEl.value;
      const ty = typeEl.value;
      const ph = phaseEl.value;
      const sort = sortEl.value || "newest";

      let list = items.slice();

      if (st) list = list.filter((x) => x.state === st);
      if (ty) list = list.filter((x) => x.eventType === ty);
      if (ph) list = list.filter((x) => x.phase === ph);

      if (q) {
        list = list.filter((x) => {
          const hay = [
            x.narrative,
            x.city,
            x.state,
            x.airport,
            x.facility,
            x.tail,
            x.model,
            x.operator,
            x.eventType,
            x.phase,
          ]
            .filter(has)
            .join(" | ")
            .toLowerCase();
          return hay.includes(q);
        });
      }

      list.sort((a, b) => {
        if (sort === "oldest") return (a.dateKey || 0) - (b.dateKey || 0);
        return (b.dateKey || 0) - (a.dateKey || 0);
      });

      return list;
    }

    function render() {
      const list = applyFilters();
      resultsEl.innerHTML = "";
      countEl.textContent = `${list.length} shown`;

      for (const item of list) {
        resultsEl.appendChild(renderCard(item));
      }
    }

    function onAnyChange() {
      render();
    }

    // wire listeners
    [qEl, stateEl, typeEl, phaseEl, sortEl].forEach((el) => {
      el.addEventListener("input", onAnyChange);
      el.addEventListener("change", onAnyChange);
    });

    resetBtn.addEventListener("click", () => {
      qEl.value = "";
      stateEl.value = "";
      typeEl.value = "";
      phaseEl.value = "";
      sortEl.value = "newest";
      render();
    });

    downloadBtn.addEventListener("click", () => {
      const list = applyFilters();
      if (!rawRows.length) return;

      // Download the ORIGINAL raw objects (not the display model)
      const raw = list.map((x) => x.raw);

      // Use original headers based on first row
      const headers = Object.keys(rawRows[0] || {});
      downloadCSV("filtered_incidents.csv", headers, raw);
    });

    // fetch CSV
    try {
      const res = await fetch(CSV_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const csvText = await res.text();

      const rows = parseCsv(csvText);
      rawRows = rowsToObjects(rows);

      // Remove rows that are totally empty
      rawRows = rawRows.filter((o) => Object.values(o).some((v) => String(v ?? "").trim().length > 0));

      if (!rawRows.length) {
        setStatus("CSV loaded but appears empty.", false);
        countEl.textContent = "0 shown";
        return;
      }

      items = rawRows.map(toDisplayModel);

      // If narrative still looks empty across most rows, surface warning
      const narrativeCount = items.filter((x) => x.narrative && x.narrative !== "No narrative provided.").length;
      const pct = Math.round((narrativeCount / items.length) * 100);

      rebuildFilters();

      if (pct < 20) {
        setStatus(`Loaded OK (but narrative missing in many rows: ${pct}% have text)`, false);
      } else {
        setStatus("Loaded OK", true);
      }

      render();
    } catch (err) {
      console.error(err);
      setStatus(`Error loading CSV: ${err.message}`, false);
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
