/* app.js — Alaska Aviation Incidents (static, no build, GitHub Pages)
   Expects: index.html has elements with ids:
   q, state, eventType, phase, sort, download, reset, results, shown, loaded, errors
*/

(() => {
  "use strict";

  // ✅ Use this path on GitHub Pages (repo root + /data/incidents.csv)
  const CSV_PATH = "data/incidents.csv";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normStr(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function toLower(v) {
    return normStr(v).toLowerCase();
  }

  function parseDateish(row) {
    // Prefer event_date, else report_date, else event_datetime_z
    const d = normStr(row.event_date || row.report_date || "");
    if (d) return d;

    const dtz = normStr(row.event_datetime_z || "");
    if (dtz) {
      // try to take YYYY-MM-DD from ISO
      const m = dtz.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : dtz;
    }
    return "";
  }

  function sortKeyDate(row) {
    // Convert to sortable timestamp-ish (best effort)
    const iso = normStr(row.event_datetime_z || "");
    if (iso) {
      const t = Date.parse(iso);
      if (!Number.isNaN(t)) return t;
    }
    const d = parseDateish(row);
    const t2 = Date.parse(d);
    return Number.isNaN(t2) ? -Infinity : t2;
  }

  // Robust CSV parser (handles quotes + commas + newlines)
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let i = 0;
    let inQuotes = false;

    const pushField = () => {
      row.push(field);
      field = "";
    };

    const pushRow = () => {
      // ignore totally empty trailing rows
      const allEmpty = row.every((c) => String(c ?? "").trim() === "");
      if (!allEmpty) rows.push(row);
      row = [];
    };

    while (i < text.length) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          // escaped quote?
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }

      if (ch === ",") {
        pushField();
        i += 1;
        continue;
      }

      if (ch === "\n") {
        pushField();
        pushRow();
        i += 1;
        continue;
      }

      if (ch === "\r") {
        // handle CRLF or lone CR
        if (text[i + 1] === "\n") {
          pushField();
          pushRow();
          i += 2;
          continue;
        }
        pushField();
        pushRow();
        i += 1;
        continue;
      }

      field += ch;
      i += 1;
    }

    // last field/row
    pushField();
    pushRow();

    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0].map((h) => normStr(h));

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const arr = rows[r];
      if (!arr || arr.length === 0) continue;

      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c] || `col_${c}`;
        obj[key] = arr[c] ?? "";
      }
      out.push(obj);
    }
    return out;
  }

  function normalizeRow(raw) {
    // Map/alias fields so your UI is consistent across CSV variants
    const r = {};
    for (const [k, v] of Object.entries(raw)) r[k] = normStr(v);

    // Aliases
    r.city = r.city || r.location_city || "";
    r.state = r.state || r.location_state || "";
    r.airport_code = r.airport_code || r.airport || r.airport_id || "";
    r.facility = r.facility || r.facility_id || "";
    r.phase = r.phase || r.flight_phase || "";
    r.event_type = r.event_type || r.event || r.type || "";
    r.pob = r.pob || r.persons_on_board || "";
    r.injuries = r.injuries || r.injury || "";
    r.damage = r.damage || "";
    r.n_numbers = r.n_numbers || r.aircraft_1_nnumber || r.n_number || r.tail_number || "";
    r.aircraft_primary_model = r.aircraft_primary_model || r.aircraft_1_type || r.aircraft_model || "";
    r.aircraft_primary = r.aircraft_primary || r.aircraft || "";

    // ✅ Narrative fix: your CSV uses raw_narrative
    r.narrative = r.narrative || r.raw_narrative || r.description || "";

    // Dates
    r.event_date = r.event_date || parseDateish(r);
    r.event_time_z = r.event_time_z || "";

    // For searching
    r._search = [
      r.city, r.state, r.airport_code, r.facility,
      r.n_numbers, r.aircraft_primary, r.aircraft_primary_model,
      r.phase, r.event_type, r.narrative
    ].map(toLower).join(" ");

    return r;
  }

  function uniqueSorted(values) {
    const set = new Set();
    values.forEach((v) => {
      const s = normStr(v);
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function setOptions(selectEl, values, allLabel) {
    // keep first option as "all"
    const first = selectEl.querySelector("option[value='']");
    selectEl.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = allLabel;
    selectEl.appendChild(optAll);

    values.forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    });
  }

  // ---------- render ----------
  function renderCards(rows) {
    const results = $("results");
    results.innerHTML = "";

    const frag = document.createDocumentFragment();

    rows.forEach((r) => {
      const card = document.createElement("div");
      card.className = "card";

      const titleCity = r.city ? `${r.city}, ${r.state || ""}`.replaceAll(" ,", ",").trim() : "Unknown location";
      const titleDate = r.event_date || "Unknown date";
      const title = `${titleCity} — ${titleDate}`;

      const tag = r.event_type || "Event";

      const fullText = normStr(r.narrative);
      const shortText = fullText ? (fullText.length > 220 ? fullText.slice(0, 220).trim() + "…" : fullText) : "No narrative provided.";

      card.innerHTML = `
        <div class="cardTop">
          <h3 class="title">${escapeHtml(title)}</h3>
          <span class="tag">${escapeHtml(tag)}</span>
        </div>

        <div class="meta">
          <span>State: <b>${escapeHtml(r.state || "—")}</b></span>
          <span>Airport: <b>${escapeHtml(r.airport_code || "—")}</b></span>
          <span>Facility: <b>${escapeHtml(r.facility || "—")}</b></span>
          <span>Tail: <b>${escapeHtml(r.n_numbers || "—")}</b></span>
          <span>Model: <b>${escapeHtml(r.aircraft_primary_model || r.aircraft_primary || "—")}</b></span>
          <span>Phase: <b>${escapeHtml(r.phase || "—")}</b></span>
          <span>POB: <b>${escapeHtml(r.pob || "—")}</b></span>
          <span>Injuries: <b>${escapeHtml(r.injuries || "—")}</b></span>
          <span>Damage: <b>${escapeHtml(r.damage || "—")}</b></span>
        </div>

        <div class="narr">${escapeHtml(shortText)}</div>
      `;

      if (fullText && fullText.length > 220) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "view-full";
        btn.textContent = "View full";
        let expanded = false;

        btn.addEventListener("click", () => {
          expanded = !expanded;
          const narrEl = card.querySelector(".narr");
          narrEl.textContent = expanded ? fullText : shortText;
          btn.textContent = expanded ? "Show less" : "View full";
        });

        card.appendChild(btn);
      }

      frag.appendChild(card);
    });

    results.appendChild(frag);
  }

  // ---------- filtering/sorting ----------
  function applyFilters(allRows) {
    const q = toLower($("q").value);
    const state = normStr($("state").value);
    const eventType = normStr($("eventType").value);
    const phase = normStr($("phase").value);
    const sort = normStr($("sort").value);

    let rows = allRows;

    if (q) rows = rows.filter((r) => r._search.includes(q));
    if (state) rows = rows.filter((r) => r.state === state);
    if (eventType) rows = rows.filter((r) => r.event_type === eventType);
    if (phase) rows = rows.filter((r) => r.phase === phase);

    if (sort === "newest") {
      rows = rows.slice().sort((a, b) => sortKeyDate(b) - sortKeyDate(a));
    } else if (sort === "oldest") {
      rows = rows.slice().sort((a, b) => sortKeyDate(a) - sortKeyDate(b));
    } else if (sort === "city") {
      rows = rows.slice().sort((a, b) => (a.city || "").localeCompare(b.city || ""));
    }

    return rows;
  }

  function downloadCsv(rows) {
    if (!rows.length) return;

    const cols = [
      "report_date","event_datetime_z","event_date","event_time_z",
      "city","state","airport_code","facility",
      "aircraft_primary","aircraft_primary_model","n_numbers",
      "phase","event_type","pob","injuries","damage",
      "form_8020_9","group_id","group_size","context_parens",
      "narrative"
    ];

    const esc = (v) => {
      const s = normStr(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
        return `"${s.replaceAll('"', '""')}"`;
      }
      return s;
    };

    const lines = [];
    lines.push(cols.join(","));
    rows.forEach((r) => {
      lines.push(cols.map((c) => esc(r[c] ?? "")).join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "incidents_filtered.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  // ---------- init ----------
  let ALL = [];

  function setLoaded(statusText) {
    $("loaded").textContent = statusText;
  }

  function setShown(n) {
    $("shown").textContent = String(n);
  }

  function setError(msg) {
    const box = $("errors");
    if (!msg) {
      box.style.display = "none";
      box.textContent = "";
      return;
    }
    box.style.display = "";
    box.textContent = msg;
  }

  function wireUi() {
    const rerender = () => {
      const filtered = applyFilters(ALL);
      setShown(filtered.length);
      renderCards(filtered);
    };

    ["q","state","eventType","phase","sort"].forEach((id) => {
      $(id).addEventListener("input", rerender);
      $(id).addEventListener("change", rerender);
    });

    $("reset").addEventListener("click", () => {
      $("q").value = "";
      $("state").value = "";
      $("eventType").value = "";
      $("phase").value = "";
      $("sort").value = "newest";
      rerender();
    });

    $("download").addEventListener("click", () => {
      const filtered = applyFilters(ALL);
      downloadCsv(filtered);
    });

    rerender();
  }

  async function init() {
    try {
      setError("");
      setLoaded("Loading…");

      const resp = await fetch(CSV_PATH, { cache: "no-store" });
      if (!resp.ok) throw new Error(`CSV fetch failed (${resp.status}) at ${CSV_PATH}`);

      const text = await resp.text();
      const rows = parseCsv(text);
      const objs = rowsToObjects(rows).map(normalizeRow);

      if (!objs.length) throw new Error("CSV parsed but produced 0 rows (check file content/headers).");

      ALL = objs;

      // Populate dropdowns
      setOptions($("state"), uniqueSorted(ALL.map((r) => r.state)), "State (all)");
      setOptions($("eventType"), uniqueSorted(ALL.map((r) => r.event_type)), "Event type (all)");
      setOptions($("phase"), uniqueSorted(ALL.map((r) => r.phase)), "Phase (all)");

      setLoaded("OK");
      wireUi();
    } catch (e) {
      console.error(e);
      setLoaded("Error");
      setShown(0);
      renderCards([]);
      setError(e?.message || String(e));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
