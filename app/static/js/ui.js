// Rendering helpers, formatting, icons and shared UI pieces (toast, bottom sheet).

// ---------- safe HTML templating ----------
// Every interpolated value is escaped unless it was produced by html`` or raw().
class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(String(s));

export function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderValue(v) {
  if (v == null || v === false) return "";
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += renderValue(v) + strings[i + 1]; });
  return new Safe(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Delegated events: on(root, "click", "[data-action=pay]", (e, el) => ...)
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

// ---------- formatting ----------
const SYMBOL = { RON: "Lei", EUR: "€", USD: "$" };
const numberFmt = new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 });

export const currencySymbol = (c) => SYMBOL[c] || c;

export function money(amount, currency, { sign = false, decimals = true } = {}) {
  const n = Number(amount);
  const body = decimals ? numberFmt.format(Math.abs(n)) : intFmt.format(Math.abs(n));
  const prefix = n < 0 ? "−" : sign && n > 0 ? "+" : "";
  return `${prefix}${body} ${currencySymbol(currency)}`;
}

// Hero balance: big integer part, smaller decimals, currency after.
export function bigMoney(amount, currency) {
  const n = Number(amount);
  const [int, dec] = numberFmt.format(Math.abs(n)).split(",");
  return html`<span class="big-money">${n < 0 ? "−" : ""}${int}<small>${dec !== "00" ? "," + dec : ""}</small><span class="cur">${currencySymbol(currency)}</span></span>`;
}

export function compact(n) {
  const v = Math.abs(n);
  if (v >= 1e6) return `${(n / 1e6).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}M`;
  if (v >= 1e3) return `${(n / 1e3).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}K`;
  return intFmt.format(n);
}

export const groupIban = (iban) => iban.replace(/(.{4})/g, "$1 ").trim();
export const maskIban = (iban) => `•••• ${iban.slice(-4)}`;
export const initials = (name) =>
  (name.match(/\p{L}+/gu) || []).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

const MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august",
  "septembrie", "octombrie", "noiembrie", "decembrie"];
export const monthName = (m) => MONTHS[m - 1];
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(key, { short = false } = {}) {
  const [y, m] = key.split("-").map(Number);
  const name = monthName(m);
  return short ? capitalize(name.slice(0, 3)) : `${capitalize(name)} ${y}`;
}

export function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Astăzi";
  if (same(d, yesterday)) return "Ieri";
  const label = `${d.getDate()} ${monthName(d.getMonth() + 1)}`;
  return d.getFullYear() === today.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

export const timeLabel = (iso) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
export const dateTimeLabel = (iso) => `${dayLabel(iso)}, ${timeLabel(iso)}`;

// Accepts Romanian and plain formats: "12,5", "2.500", "1.234,56", "12.50".
// Returns a normalized "12.50" string or null.
export function parseAmount(input) {
  let s = String(input).trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");   // dot = thousands, comma = decimals
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "2.500" = two thousand five hundred
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n.toFixed(2) : null;
}

// ---------- categories ----------
export const CATEGORIES = {
  groceries: { label: "Cumpărături", icon: "cart" },
  restaurants: { label: "Restaurante", icon: "cup" },
  transport: { label: "Transport", icon: "car" },
  shopping: { label: "Shopping", icon: "bag" },
  entertainment: { label: "Divertisment", icon: "ticket" },
  bills: { label: "Facturi & utilități", icon: "bolt" },
  health: { label: "Sănătate", icon: "heart" },
  travel: { label: "Călătorii", icon: "globe" },
  transfers: { label: "Transferuri", icon: "send" },
  income: { label: "Alimentări", icon: "arrowDownLeft" },
  cash: { label: "Numerar", icon: "banknote" },
  savings: { label: "Economii", icon: "piggy" },
  internal: { label: "Între conturile mele", icon: "swap" },
  other: { label: "Altele", icon: "dots" },
};
export const CARD_CATEGORIES = ["groceries", "restaurants", "transport", "shopping", "entertainment", "bills",
  "health", "travel", "other"];
export const category = (key) => CATEGORIES[key] || CATEGORIES.other;

export const KIND_LABEL = {
  deposit: "Alimentare", withdrawal: "Retragere numerar", transfer_in: "Transfer primit",
  transfer_out: "Transfer trimis", card_payment: "Plată cu cardul", to_savings: "Către pușculiță",
  from_savings: "Din pușculiță",
};

export function txTitle(tx) {
  if (tx.kind === "card_payment") return tx.counterparty_name;
  if (tx.kind === "transfer_in" || tx.kind === "transfer_out") return tx.counterparty_name || KIND_LABEL[tx.kind];
  if (tx.kind === "to_savings" || tx.kind === "from_savings") {
    return tx.description === "Rotunjire" ? "Rotunjire" : tx.counterparty_name;
  }
  return tx.description || KIND_LABEL[tx.kind];
}

// ---------- icons (24×24, stroke) ----------
const P = {
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.5V15h-5v5.5H5A1.5 1.5 0 0 1 3.5 19z"/>',
  arrows: '<path d="M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4-4m-4 4 4 4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  piggy: '<path d="M18.5 11c0-3.3-3-6-7-6-1.4 0-2.7.3-3.8.9L5 4.5v3.3A6 6 0 0 0 3.6 11H2v3.5h1.8a6.6 6.6 0 0 0 2.2 2.8V20h3v-1.4c.8.2 1.6.3 2.5.3s1.7-.1 2.5-.3V20h3v-2.7a5.8 5.8 0 0 0 1.4-1.8"/><path d="M18.5 11h1a1.5 1.5 0 0 1 0 3h-1.4M9.5 8.5h4"/><circle cx="7.3" cy="11" r=".9" fill="currentColor" stroke="none"/>',
  chart: '<path d="M5 20v-7M12 20V5M19 20v-10"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dots: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  arrowDownLeft: '<path d="M17 7 7 17M16 17H7V8"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5zM5 10v7.5M9.7 10v7.5M14.3 10v7.5M19 10v7.5M3 20h18"/>',
  swap: '<path d="M17 4l3 3-3 3M20 7H9M7 20l-3-3 3-3M4 17h11"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  share: '<path d="M12 15V3m-4.5 4.5L12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5M3.6 10.6l3.6-1.1-.7-3.7M20.4 13.4l-3.6 1.1.7 3.7M3.6 13.4l3.6 1.1-.7 3.7M20.4 10.6l-3.6-1.1.7-3.7"/>',
  gauge: '<path d="M4.2 18.5a9 9 0 1 1 15.6 0"/><path d="m12 14 4.5-4.5"/><circle cx="12" cy="14" r="1.3" fill="currentColor" stroke="none"/>',
  bag: '<path d="M5.5 8h13l-1 12.5h-11zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/><path d="M2.5 3.5h2.8l2.4 11.5h11l2-8H6.2"/>',
  cup: '<path d="M4 9h12.5v4.5A5.5 5.5 0 0 1 11 19H9.5A5.5 5.5 0 0 1 4 13.5zM16.5 11h1.3a2.7 2.7 0 0 1 0 5.4h-1.6M8 3v3M12.5 3v3"/>',
  car: '<path d="M4.5 16.5V12l2-5.5h11l2 5.5v4.5zM4.5 12h15"/><circle cx="8" cy="16.5" r="1.8"/><circle cx="16" cy="16.5" r="1.8"/>',
  ticket: '<path d="M3 7.5h18v3a1.8 1.8 0 0 0 0 3.6v2.4H3v-2.4a1.8 1.8 0 0 0 0-3.6zM14.5 7.5v9"/>',
  bolt: '<path d="M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  heart: '<path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 8 2.5C20 15.4 12 20 12 20z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
  send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5-7.5-4z"/>',
  banknote: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14a6.5 6.5 0 0 1 4 6"/>',
  wallet: '<path d="M4 7.5V6a2 2 0 0 1 2-2h11v3.5"/><rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M15.5 13.75h2"/>',
  doc: '<path d="M6 2.5h8.5L19 7v14.5H6zM14 2.5V7.5h5M9 12.5h7M9 16.5h5"/>',
  download: '<path d="M12 3v12m-4.5-4.5L12 15l4.5-4.5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 17l5-5-5-5M20 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/>',
  repeat: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9M19.5 4v5h-5M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15M4.5 20v-5h5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
  alert: '<path d="M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7z"/>',
};

export function icon(name, { size = 22, cls = "" } = {}) {
  return raw(`<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.dots}</svg>`);
}

// ---------- illustrations ----------
function coinStack(x, baseY, count) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const y = baseY - i * 6;
    s += `<path d="M${x - 17} ${y}v4a17 6.5 0 0 0 34 0v-4" fill="#b88a12"/>`;
    s += `<ellipse cx="${x}" cy="${y}" rx="17" ry="6.5" fill="${i === count - 1 ? "#f2c94c" : "#d9a922"}" stroke="#8f6a0c" stroke-width=".8"/>`;
  }
  const top = baseY - (count - 1) * 6;
  s += `<path d="M${x - 5} ${top - 1.5}l5 3 5-3M${x} ${top - 2}v3" stroke="#8f6a0c" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  return s;
}

export function walletArt() {
  return raw(`<svg class="art" viewBox="0 0 260 130" aria-hidden="true">
    <ellipse cx="130" cy="112" rx="100" ry="11" fill="#000" opacity=".28"/>
    ${coinStack(52, 96, 5)}${coinStack(84, 108, 2)}
    <g transform="translate(132 62) rotate(-24) skewX(14)">
      <rect x="-50" y="-34" width="100" height="64" rx="9" fill="#a8860a"/>
      <rect x="-52" y="-37" width="100" height="64" rx="9" fill="#ffd93d"/>
      <rect x="-40" y="-26" width="15" height="11" rx="2.5" fill="#e9c02c" stroke="#a8860a" stroke-width=".8"/>
      <path d="M-40 6h12M-24 6h12M-8 6h12M8 6h12" stroke="#a8860a" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M-40 15h26" stroke="#a8860a" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    </g>
    ${coinStack(204, 92, 6)}${coinStack(226, 110, 2)}
  </svg>`);
}

export function jarArt() {
  return raw(`<svg class="art" viewBox="0 0 160 120" aria-hidden="true">
    <ellipse cx="80" cy="110" rx="56" ry="8" fill="#000" opacity=".28"/>
    <rect x="44" y="18" width="72" height="12" rx="4" fill="#ffd93d"/>
    <path d="M48 30h64c6 6 9 14 9 24v38a14 14 0 0 1-14 14H53a14 14 0 0 1-14-14V54c0-10 3-18 9-24z" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".25" stroke-width="2"/>
    ${coinStack(66, 96, 4)}${coinStack(96, 98, 3)}
    <path d="M58 44c-3 6-4 12-4 20" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round" fill="none"/>
  </svg>`);
}

export function logoMark(size = 56) {
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="18" fill="#ffd93d"/>
    <path d="M18 46 30.5 17h3L46 46" fill="none" stroke="#17181c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M23.5 35h17" stroke="#17181c" stroke-width="6" stroke-linecap="round"/>
  </svg>`);
}

// ---------- toast ----------
let toastTimer;
export function toast(message, { error = false } = {}) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3200);
}

// ---------- bottom sheet ----------
const sheets = [];

export function openSheet({ title, body, onMount, wide = false }) {
  const layer = document.createElement("div");
  layer.className = "sheet-layer";
  layer.innerHTML = html`
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${title || "Dialog"}">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      ${title ? html`<header class="sheet-head"><h2>${title}</h2>
        <button class="icon-btn ghost" data-close aria-label="Închide">${icon("close")}</button></header>` : ""}
      <div class="sheet-body">${body}</div>
    </section>`.toString();
  document.body.appendChild(layer);
  const sheet = $(".sheet", layer);
  const previousFocus = document.activeElement;

  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  const close = (value) => {
    if (!layer.isConnected) return;
    layer.classList.add("closing");
    sheets.splice(sheets.indexOf(close), 1);
    setTimeout(() => layer.remove(), 220);
    previousFocus?.focus?.();
    resolveClosed(value);
  };
  sheets.push(close);

  layer.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });

  // Drag the handle down to dismiss.
  const grab = $(".sheet-grab", layer);
  let startY = null;
  grab.addEventListener("pointerdown", (e) => { startY = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  grab.addEventListener("pointerup", (e) => {
    const dy = e.clientY - (startY ?? e.clientY);
    startY = null;
    sheet.style.transform = "";
    if (dy > 90) close();
  });

  requestAnimationFrame(() => layer.classList.add("open"));
  onMount?.(sheet, close);
  setTimeout(() => ($("[autofocus]", sheet) || sheet).focus?.({ preventScroll: true }), 60);
  return closed;
}

export function closeAllSheets() {
  [...sheets].reverse().forEach((close) => close());
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheets.length) sheets[sheets.length - 1]();
});

export function confirmSheet({ title, message, confirmLabel = "Confirmă", danger = false }) {
  return openSheet({
    title,
    body: html`<p class="sheet-text">${message}</p>
      <div class="stack-btns">
        <button class="btn ${danger ? "danger" : "primary"}" data-ok>${confirmLabel}</button>
        <button class="btn secondary" data-close>Renunță</button>
      </div>`,
    onMount: (el, close) => $("[data-ok]", el).addEventListener("click", () => close(true)),
  }).then(Boolean);
}

// Success screen used after money moves.
export function successSheet({ title, subtitle, amount }) {
  return openSheet({
    body: html`<div class="success">
        <div class="success-mark">${icon("check", { size: 40 })}</div>
        <h2>${title}</h2>
        ${amount ? html`<p class="success-amount">${amount}</p>` : ""}
        ${subtitle ? html`<p class="muted">${subtitle}</p>` : ""}
        <button class="btn primary block" data-close autofocus>Gata</button>
      </div>`,
  });
}

export function skeleton(rows = 3) {
  return html`<div class="skeleton-block">${Array.from({ length: rows }, () => html`
    <div class="sk-row"><span class="sk sk-circle"></span><span class="sk-lines"><span class="sk sk-line w60"></span><span class="sk sk-line w35"></span></span></div>`)}</div>`;
}

export function emptyState(iconName, title, text, action = "") {
  return html`<div class="empty">
    <div class="empty-icon">${icon(iconName, { size: 28 })}</div>
    <h3>${title}</h3>${text ? html`<p>${text}</p>` : ""}${action}</div>`;
}

export async function copyText(text, label = "Copiat") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Nu am putut copia", { error: true });
  }
}

// Disables a button while an async action runs, so double taps don't send twice.
export async function busy(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add("loading");
  try { return await fn(); } finally { button.disabled = false; button.classList.remove("loading"); }
}
