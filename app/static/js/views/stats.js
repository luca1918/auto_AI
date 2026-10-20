import { api, store } from "../api.js";
import { groupedColumns } from "../charts.js";
import { $, category, emptyState, html, icon, money, monthLabel, monthName, on, skeleton } from "../ui.js";

const SERIES = [
  { key: "income", label: "Venituri", cssVar: "--series-income" },
  { key: "expenses", label: "Cheltuieli", cssVar: "--series-expenses" },
];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function delta(stats) {
  const prev = Number(stats.previous_expenses);
  const cur = Number(stats.total_expenses);
  const prevName = monthName(Number(shiftMonth(stats.month, -1).slice(5)));
  if (!prev) return html`<span class="delta">Nicio cheltuială în ${prevName}</span>`;
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return html`<span class="delta">La fel ca în ${prevName}</span>`;
  // For spending, going up is the bad direction.
  const up = change > 0;
  return html`<span class="delta ${up ? "bad" : "good"}">${icon(up ? "arrowUpRight" : "arrowDownLeft", { size: 16 })}
    <span>${up ? "+" : "−"}${Math.abs(change)}% față de ${prevName}</span></span>`;
}

export async function render(el, params, query) {
  el.innerHTML = html`<div class="page">${skeleton(5)}</div>`;
  const accounts = await store.get("accounts");
  const state = {
    account: accounts.find((a) => a.id === Number(query.get("account"))) || accounts[0],
    month: /^\d{4}-\d{2}$/.test(query.get("month") || "") ? query.get("month") : currentMonth(),
  };

  el.innerHTML = html`<div class="page stats-page">
    <header class="page-head"><h1>Statistici</h1></header>
    <div class="filters">
      ${accounts.length > 1 ? html`<div class="h-scroll chips">${accounts.map((a) => html`
        <button class="chip" data-account="${a.id}">${a.name} · ${a.currency}</button>`)}</div>` : ""}
      <div class="month-stepper">
        <button class="icon-btn ghost" data-month="-1" aria-label="Luna anterioară">${icon("chevronLeft")}</button>
        <b data-month-label></b>
        <button class="icon-btn ghost" data-month="1" aria-label="Luna următoare">${icon("chevronRight")}</button>
      </div>
    </div>
    <div data-content></div>
  </div>`;

  const content = $("[data-content]", el);
  let seq = 0;

  async function load() {
    const mine = ++seq;
    history.replaceState(null, "", `#/stats?account=${state.account.id}&month=${state.month}`);
    el.querySelectorAll("[data-account]").forEach((b) => b.classList.toggle("active", Number(b.dataset.account) === state.account.id));
    $("[data-month-label]", el).textContent = monthLabel(state.month);
    $("[data-month='1']", el).disabled = state.month >= currentMonth();
    content.classList.add("refreshing");

    const stats = await api(`/api/stats?account_id=${state.account.id}&month=${state.month}&months=6`);
    if (mine !== seq) return;
    content.classList.remove("refreshing");
    const cur = stats.currency;
    const hasHistory = stats.months.some((m) => Number(m.income) || Number(m.expenses));
    const maxCat = Math.max(...stats.categories.map((c) => Number(c.amount)), 1);

    content.innerHTML = html`
      <div class="stat-tiles">
        <section class="stat-tile hero">
          <span class="label">Cheltuieli în ${monthName(Number(stats.month.slice(5)))}</span>
          <span class="value">${money(stats.total_expenses, cur)}</span>
          ${delta(stats)}
        </section>
        <section class="stat-tile">
          <span class="label">Venituri</span>
          <span class="value sm">${money(stats.total_income, cur)}</span>
          <span class="delta">Fără mutările între conturile tale</span>
        </section>
      </div>

      <section class="card-block">
        <h2>Venituri și cheltuieli</h2>
        <p class="muted small">Ultimele 6 luni · atinge o lună ca s-o selectezi</p>
        ${hasHistory ? html`<div data-chart></div>` : emptyState("chart", "Încă nu sunt date", "Statisticile apar după primele tranzacții.")}
      </section>

      <section class="card-block">
        <h2>Pe categorii</h2>
        ${stats.categories.length ? html`<div class="cat-bars">${stats.categories.map((c) => {
          const meta = category(c.category);
          return html`<a class="cat-row" href="#/search?category=${c.category}&account=${state.account.id}">
            <span class="tx-icon">${icon(meta.icon, { size: 20 })}</span>
            <span class="cat-main">
              <span class="cat-top"><span>${meta.label}</span><b>${money(c.amount, cur)}</b></span>
              <span class="cat-bar"><span style="width:${(Number(c.amount) / maxCat) * 100}%"></span></span>
              <span class="cat-sub">${c.count} ${c.count === 1 ? "plată" : "plăți"} · ${Math.round(c.share * 100)}% din total</span>
            </span></a>`;
        })}</div>` : emptyState("bag", "Nicio cheltuială în această lună", "")}
      </section>`;

    const chart = $("[data-chart]", content);
    if (chart) {
      const draw = () => groupedColumns(chart, stats.months, SERIES, {
        currency: cur, selected: state.month,
        onSelect: (month) => { if (month !== state.month) { state.month = month; load(); } },
      });
      draw();
      chart._redraw = draw;
    }
  }

  on(el, "click", "[data-account]", (e, b) => {
    state.account = accounts.find((a) => a.id === Number(b.dataset.account));
    load();
  });
  on(el, "click", "[data-month]", (e, b) => {
    state.month = shiftMonth(state.month, Number(b.dataset.month));
    load();
  });
  const onResize = () => $("[data-chart]", content)?._redraw?.();
  window.addEventListener("resize", onResize);
  el.addEventListener("autobank:unmount", () => window.removeEventListener("resize", onResize), { once: true });
  await load();
}
