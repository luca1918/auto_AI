// Small SVG chart builders. Labels are inserted with textContent (never innerHTML).
import { compact, money, monthLabel } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function niceStep(max, ticks) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

// Column with a 4px rounded data-end and a square base on the baseline.
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Grouped columns: one group per month, one column per series.
 * series: [{ key, label, cssVar }]; rows: [{ month, [key]: "123.45" }]
 */
export function groupedColumns(container, rows, series, { currency, selected, onSelect } = {}) {
  container.replaceChildren();
  container.classList.add("chart");

  const legend = document.createElement("div");
  legend.className = "legend";
  for (const s of series) {
    const item = document.createElement("span");
    const sw = document.createElement("i");
    sw.style.background = `var(${s.cssVar})`;
    item.append(sw, document.createTextNode(s.label));
    legend.appendChild(item);
  }
  container.appendChild(legend);

  const width = Math.max(280, container.clientWidth);
  const height = 190;
  const m = { top: 10, right: 4, bottom: 26, left: 40 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const values = rows.flatMap((r) => series.map((s) => Number(r[s.key])));
  const step = niceStep(Math.max(...values, 1), 4);
  const yMax = step * Math.ceil(Math.max(...values, 1) / step);
  const y = (v) => m.top + plotH - (v / yMax) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img",
    "aria-label": `Grafic ${series.map((s) => s.label.toLowerCase()).join(" și ")} pe ultimele ${rows.length} luni` });
  container.appendChild(svg);

  for (let v = 0; v <= yMax + 1e-9; v += step) {
    svgEl("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }, svg);
    const t = svgEl("text", { x: m.left - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, svg);
    t.textContent = compact(v);
  }

  const band = plotW / rows.length;
  const gap = 2;
  const colW = Math.min(20, (band * 0.6 - gap) / series.length);
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.hidden = true;
  container.appendChild(tooltip);

  rows.forEach((row, i) => {
    const x0 = m.left + band * i;
    const groupW = colW * series.length + gap * (series.length - 1);
    const g = svgEl("g", { class: `band${row.month === selected ? " selected" : ""}` }, svg);
    svgEl("rect", { x: x0 + 2, y: m.top, width: band - 4, height: plotH, rx: 8, class: "band-bg" }, g);
    series.forEach((s, j) => {
      const v = Number(row[s.key]);
      const h = Math.max(0, m.top + plotH - y(v));
      if (h > 0) {
        svgEl("path", { d: columnPath(x0 + (band - groupW) / 2 + j * (colW + gap), y(v), colW, h),
          fill: `var(${s.cssVar})` }, g);
      }
    });
    const label = svgEl("text", { x: x0 + band / 2, y: height - 8, class: "tick month", "text-anchor": "middle" }, g);
    label.textContent = monthLabel(row.month, { short: true });

    const hit = svgEl("rect", { x: x0, y: 0, width: band, height, fill: "transparent", tabindex: 0, class: "hit",
      "aria-label": `${monthLabel(row.month)}: ${series.map((s) => `${s.label} ${money(row[s.key], currency)}`).join(", ")}` }, g);
    const show = () => {
      tooltip.replaceChildren();
      const title = document.createElement("b");
      title.textContent = monthLabel(row.month);
      tooltip.appendChild(title);
      for (const s of series) {
        const line = document.createElement("div");
        const key = document.createElement("i");
        key.style.background = `var(${s.cssVar})`;
        const val = document.createElement("strong");
        val.textContent = money(row[s.key], currency);
        const name = document.createElement("span");
        name.textContent = s.label;
        line.append(key, val, name);
        tooltip.appendChild(line);
      }
      tooltip.hidden = false;
      const left = Math.min(Math.max(x0 + band / 2 - tooltip.offsetWidth / 2, 0), width - tooltip.offsetWidth);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${legend.offsetHeight + 4}px`;
      g.classList.add("hover");
    };
    const hide = () => { tooltip.hidden = true; g.classList.remove("hover"); };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
    hit.addEventListener("click", () => onSelect?.(row.month));
    hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(row.month); } });
  });

  // Table view: every value reachable without hovering.
  const details = document.createElement("details");
  details.className = "table-view";
  const summary = document.createElement("summary");
  summary.textContent = "Vezi ca tabel";
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  ["Luna", ...series.map((s) => s.label)].forEach((h) => { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); });
  const body = table.createTBody();
  rows.forEach((r) => {
    const tr = body.insertRow();
    tr.insertCell().textContent = monthLabel(r.month);
    series.forEach((s) => { tr.insertCell().textContent = money(r[s.key], currency); });
  });
  details.append(summary, table);
  container.appendChild(details);
}
