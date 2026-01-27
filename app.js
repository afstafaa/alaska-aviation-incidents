/* app.js
   Loads: data/incidents.csv
   Expects CSV headers exactly like:
   report_date,event_datetime_z,event_date,event_time_z,city,state,airport_code,facility,
   aircraft_primary,aircraft_primary_model,n_numbers,phase,event_type,pob,injuries,damage,
   form_8020_9,group_id,group_size,context_parens,raw_narrative
*/

const CSV_URL = "data/incidents.csv";

/** Robust CSV parser (handles quoted fields + commas + newlines in quotes) */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
      if (c === "\r" && next === "\n") i++; // handle CRLF
      row.push(field);
      field = "";

      if (c === "\n" || c === "\r") {
        // Skip entirely empty trailing lines
        const isEmptyRow = row.length === 1 && row[0] === "";
        if (!isEmptyRow) rows.push(row);
        row = [];
      }
      continue;
    }

    field += c;
  }

  // last field
  row.push(field);
  if (!(row.length === 1 && row[0] === "")) rows.push(row);

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => (h || "").trim());
  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    const cols = rows[r];
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cols[c] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const ch of children) node.appendChild(ch);
  return node;
}

function ensureUI() {
  // If your existing index.html already has these, we reuse them.
  let root = document.getElementById("app");
  if (!root) {
    root = el("div", { id: "app" });
    document.body.appendChild(root);
  }

  let searchInput = document.getElementById("searchInput");
  let list = document.getElementById("incidentsList");
  let count = document.getElementById("resultCount");

  if (!searchInput || !list) {
    root.innerHTML = "";

    const header = el("div", { class: "topbar" }, [
      el("div", { class: "titlewrap" }, [
        el("h1", { class: "title", text: "Alaska Aviation Incidents" }),
        el("div", {
          class: "subtitle",
          text: "Searchable view of incident CSV narratives and fields",
        }),
      ]),
      el("div", { class: "controls" }, [
        el("input", {
          id: "searchInput",
          type: "search",
          placeholder:
            "Search city, airport, N-number(s), model, phase, narrative…",
          autocomplete: "off",
        }),
        el("div", { id: "resultCount", class: "count", text: "" }),
      ]),
    ]);

    list = el("div", { id: "incidentsList", class: "list" });

    root.appendChild(header);
    root.appendChild(list);

    searchInput = document.getElementById("searchInput");
    count = document.getElementById("resultCount");
  }

  return { root, searchInput, list, count };
}

const FIELD_LABELS = [
  ["report_date", "Report Date"],
  ["event_datetime_z", "Event Date/Time (Z)"],
  ["event_date", "Event Date"],
  ["event_time_z", "Event Time (Z)"],
  ["city", "City"],
  ["state", "State"],
  ["airport_code", "Airport Code"],
  ["facility", "Facility"],
  ["aircraft_primary", "Aircraft"],
  ["aircraft_primary_model", "Model"],
  ["n_numbers", "N-number(s)"],
  ["phase", "Phase"],
  ["event_type", "Event Type"],
  ["pob", "POB"],
  ["injuries", "Injuries"],
  ["damage", "Damage"],
  ["form_8020_9", "Form 8020-9"],
  ["group_id", "Group ID"],
  ["group_size", "Group Size"],
  ["context_parens", "Context (parens)"],
];

function formatValue(key, val) {
  if (!val) return "";
  if (key === "form_8020_9") {
    // Normalize booleans-ish values
    const v = val.toLowerCase();
    if (["y", "yes", "true", "1"].includes(v)) return "Yes";
    if (["n", "no", "false", "0"].includes(v)) return "No";
  }
  return val;
}

function recordMatches(rec, q) {
  if (!q) return true;
  const hay = [
    rec.report_date,
    rec.event_datetime_z,
    rec.event_date,
    rec.event_time_z,
    rec.city,
    rec.state,
    rec.airport_code,
    rec.facility,
    rec.aircraft_primary,
    rec.aircraft_primary_model,
    rec.n_numbers,
    rec.phase,
    rec.event_type,
    rec.pob,
    rec.injuries,
    rec.damage,
    rec.group_id,
    rec.group_size,
    rec.context_parens,
    rec.raw_narrative,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return hay.includes(q);
}

function buildCard(rec) {
  // Top line title: City, ST — N-number(s) — Date
  const titleBits = [];
  const loc = [rec.city, rec.state].filter(Boolean).join(", ");
  if (loc) titleBits.push(loc);
  if (rec.airport_code) titleBits.push(rec.airport_code);
  const nnums = rec.n_numbers ? rec.n_numbers : "";
  const date = rec.event_date ? rec.event_date : rec.report_date ? rec.report_date : "";
  const title = [titleBits.join(" — "), nnums, date].filter(Boolean).join(" — ");

  const metaGrid = el("div", { class: "meta" });
  for (const [key, label] of FIELD_LABELS) {
    const v = formatValue(key, rec[key]);
    if (!v) continue;

    metaGrid.appendChild(
      el("div", { class: "metaRow" }, [
        el("div", { class: "metaLabel", text: label }),
        el("div", { class: "metaValue", text: v }),
      ])
    );
  }

  const narrative = (rec.raw_narrative || "").trim();
  const narrativeBlock = el("div", { class: "narrative" }, [
    el("div", { class: "narrLabel", text: "Narrative" }),
    el("div", {
      class: "narrText",
      text: narrative ? narrative : "No narrative provided.",
    }),
  ]);

  return el("article", { class: "card" }, [
    el("div", { class: "cardHeader" }, [
      el("h2", { class: "cardTitle", text: title || "Incident" }),
      el("div", {
        class: "cardSub",
        text: [rec.aircraft_primary, rec.aircraft_primary_model]
          .filter(Boolean)
          .join(" — "),
      }),
    ]),
    metaGrid,
    narrativeBlock,
  ]);
}

function render(listEl, countEl, records, query) {
  listEl.innerHTML = "";
  const q = (query || "").trim().toLowerCase();

  const filtered = records.filter((r) => recordMatches(r, q));
  countEl.textContent = `${filtered.length.toLocaleString()} result${
    filtered.length === 1 ? "" : "s"
  }`;

  const frag = document.createDocumentFragment();
  for (const rec of filtered) frag.appendChild(buildCard(rec));
  listEl.appendChild(frag);
}

async function init() {
  const { searchInput, list, count } = ensureUI();

  let records = [];
  try {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    records = parseCSV(text);
  } catch (e) {
    list.innerHTML = "";
    list.appendChild(
      el("div", { class: "error" }, [
        el("div", { class: "errorTitle", text: "Could not load incidents.csv" }),
        el("div", { class: "errorText", text: String(e) }),
        el("div", {
          class: "errorText",
          text: `Check that ${CSV_URL} exists in your repo and GitHub Pages is serving it.`,
        }),
      ])
    );
    if (count) count.textContent = "";
    return;
  }

  // Optional: sanity check for expected headers
  const expected = new Set([
    "report_date",
    "event_datetime_z",
    "event_date",
    "event_time_z",
    "city",
    "state",
    "airport_code",
    "facility",
    "aircraft_primary",
    "aircraft_primary_model",
    "n_numbers",
    "phase",
    "event_type",
    "pob",
    "injuries",
    "damage",
    "form_8020_9",
    "group_id",
    "group_size",
    "context_parens",
    "raw_narrative",
  ]);
  const have = records[0] ? Object.keys(records[0]) : [];
  const missing = [...expected].filter((h) => !have.includes(h));
  if (missing.length) {
    console.warn("CSV missing expected headers:", missing);
  }

  render(list, count, records, "");

  let t = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => render(list, count, records, searchInput.value), 80);
  });
}

document.addEventListener("DOMContentLoaded", init);
