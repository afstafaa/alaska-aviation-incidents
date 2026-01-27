const removeExtraNodes = (selector) => {
  const nodes = Array.from(document.querySelectorAll(selector));
  nodes.slice(1).forEach((node) => node.remove());
  return nodes[0] ?? null;
};

removeExtraNodes("main");
removeExtraNodes(".site-header");

const stateFilter = removeExtraNodes("#stateFilter");
const eventFilter = removeExtraNodes("#eventFilter");
const phaseFilter = removeExtraNodes("#phaseFilter");
const sortOrder = removeExtraNodes("#sortOrder");
const searchInput = removeExtraNodes("#search");
const statusMessage = removeExtraNodes("#statusMessage");
const rowCount = removeExtraNodes("#rowCount");
const results = removeExtraNodes("#results");

let incidentRows = [];

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        field += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "\r") {
      continue;
    }

    if (char === "\n" && !insideQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const normalize = (value) => value?.trim() ?? "";

const buildOptionList = (select, values) => {
  select.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
  const unique = Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  unique.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
};

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const pickSortDate = (row) =>
  row.event_datetime_z || row.event_date || row.report_date || "";

const pickDisplayDate = (row) => row.event_date || row.event_datetime_z || row.report_date || "";

const pickNarrative = (row) =>
  row.context || row.narrative || row.description || "No narrative provided.";

const renderResults = () => {
  const term = searchInput.value.trim().toLowerCase();
  const state = stateFilter.value;
  const eventType = eventFilter.value;
  const phase = phaseFilter.value;
  const order = sortOrder.value;

  const filtered = incidentRows
    .filter((row) => (state ? row.state === state : true))
    .filter((row) => (eventType ? row.event_type === eventType : true))
    .filter((row) => (phase ? row.phase === phase : true))
    .filter((row) => {
      if (!term) return true;
      return (
        pickNarrative(row).toLowerCase().includes(term) ||
        row.city.toLowerCase().includes(term) ||
        row.airport_code.toLowerCase().includes(term) ||
        row.n_numbers.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      const aDate = new Date(pickSortDate(a)).getTime();
      const bDate = new Date(pickSortDate(b)).getTime();
      if (Number.isNaN(aDate) || Number.isNaN(bDate)) return 0;
      return order === "newest" ? bDate - aDate : aDate - bDate;
    });

  results.innerHTML = "";
  rowCount.textContent = `Rows detected: ${filtered.length}`;

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "no-results";
    empty.textContent = "No incidents match your current filters.";
    results.appendChild(empty);
    return;
  }

  filtered.forEach((row) => {
    const card = document.createElement("article");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "card-header";

    const title = document.createElement("h3");
    title.className = "card-title";
    const locationParts = [row.city, row.state].filter(Boolean).join(", ");
    title.textContent = `${locationParts || "Unknown location"} — ${formatDate(
      pickDisplayDate(row)
    )}`;

    const badge = document.createElement("span");
    badge.className = "pill";
    badge.textContent = row.event_type || "Unknown event";

    header.appendChild(title);
    header.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span><strong>Airport:</strong> ${row.airport_code || "Unknown"}</span>
      <span><strong>Facility:</strong> ${row.facility || "Unknown"}</span>
      <span><strong>Aircraft:</strong> ${row.aircraft_primary || "Unknown"}</span>
      <span><strong>Model:</strong> ${row.aircraft_primary_model || "Unknown"}</span>
      <span><strong>N-number(s):</strong> ${row.n_numbers || "Unknown"}</span>
      <span><strong>Phase:</strong> ${row.phase || "Unknown"}</span>
      <span><strong>POB:</strong> ${row.pob || "Unknown"}</span>
      <span><strong>Injuries:</strong> ${row.injuries || "Unknown"}</span>
      <span><strong>Damage:</strong> ${row.damage || "Unknown"}</span>
    `;

    const narrative = document.createElement("p");
    narrative.className = "narrative";
    const fullText = pickNarrative(row);
    const shortText = fullText.length > 160 ? `${fullText.slice(0, 160)}…` : fullText;
    narrative.textContent = shortText;

    const toggle = document.createElement("button");
    toggle.className = "view-full";
    toggle.type = "button";
    toggle.textContent = fullText.length > 160 ? "View full" : "Full narrative";

    let expanded = false;
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      narrative.textContent = expanded ? fullText : shortText;
      toggle.textContent = expanded ? "Show less" : "View full";
    });

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(narrative);
    if (fullText.length > 160) {
      card.appendChild(toggle);
    }

    results.appendChild(card);
  });
};

const init = async () => {
  try {
    const response = await fetch("./data/incidents.csv");
    if (!response.ok) {
      throw new Error("Unable to load CSV");
    }

    const csvText = await response.text();
    const rows = parseCsv(csvText).filter((row) => row.length > 0);
    if (rows.length === 0) {
      throw new Error("CSV is empty");
    }

    const headers = rows[0].map((header) => header.trim());
    const dataRows = rows.slice(1);

    incidentRows = dataRows.map((row) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = normalize(row[index]);
      });
      entry.context = entry.context || "";
      entry.narrative = entry.narrative || "";
      entry.description = entry.description || "";
      entry.city = entry.city || "Unknown city";
      entry.state = entry.state || "";
      entry.airport_code = entry.airport_code || "";
      entry.facility = entry.facility || "";
      entry.aircraft_primary = entry.aircraft_primary || "";
      entry.aircraft_primary_model = entry.aircraft_primary_model || "";
      entry.n_numbers = entry.n_numbers || "";
      entry.phase = entry.phase || "";
      entry.pob = entry.pob || "";
      entry.injuries = entry.injuries || "";
      entry.damage = entry.damage || "";
      return entry;
    });

    buildOptionList(
      stateFilter,
      incidentRows.map((row) => row.state)
    );
    buildOptionList(
      eventFilter,
      incidentRows.map((row) => row.event_type)
    );
    buildOptionList(
      phaseFilter,
      incidentRows.map((row) => row.phase)
    );

    statusMessage.textContent = "Loaded OK";
    rowCount.textContent = `Rows detected: ${incidentRows.length}`;

    [stateFilter, eventFilter, phaseFilter, sortOrder, searchInput].forEach((input) => {
      input.addEventListener("input", renderResults);
    });

    renderResults();
  } catch (error) {
    statusMessage.textContent = "Unable to load data.";
    rowCount.textContent = "Rows detected: 0";
    results.innerHTML = "<div class=\"no-results\">Please check the CSV file path.</div>";
    console.error(error);
  }
};

init();
