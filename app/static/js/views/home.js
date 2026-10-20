import { api, store } from "../api.js";
import { accountMoreSheet, depositFlow, newAccountFlow, statementFlow, transferFlow, txList } from "../flows.js";
import {
  $, $$, bigMoney, category, emptyState, html, icon, initials, money, monthName, on, skeleton, walletArt,
} from "../ui.js";
import { goalCreateFlow } from "./savings.js";

const SELECTED_KEY = "autobank.homeAccount";
const TIP_KEY = "autobank.tipDismissed";

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

const tiles = [
  ["wallet", "Conturi", "#/accounts"],
  ["piggy", "Pușculițe", "#/savings"],
  ["card", "Carduri", "#/cards"],
  ["users", "Beneficiari", "#/payments"],
  ["chart", "Statistici", "#/stats"],
  ["doc", "Extras", "statement"],
];

function accountSlide(a) {
  return html`<article class="acc-slide" data-acc="${a.id}">
    ${walletArt()}
    <div class="acc-balance">${bigMoney(a.balance, a.currency)}</div>
    <a class="acc-name" href="#/account/${a.id}">${a.name} · ${a.currency} ${icon("chevronRight", { size: 16 })}</a>
    <div class="acc-actions">
      <button data-act="pay"><span class="sq">${icon("arrowUpRight", { size: 26 })}</span>Plătește</button>
      <button data-act="add"><span class="sq">${icon("plus", { size: 26 })}</span>Adaugă bani</button>
      <button data-act="more"><span class="sq outline">${icon("dots", { size: 26 })}</span>Mai multe</button>
    </div>
  </article>`;
}

function goalsRow(goals, accounts) {
  const cur = (g) => accounts.find((a) => a.id === g.account_id)?.currency || g.currency;
  return html`<div class="h-scroll goals-row">
    ${goals.map((g) => {
      const pct = Math.min(100, Math.round((Number(g.balance) / Number(g.target)) * 100));
      return html`<a class="goal-chip" href="#/savings/${g.id}">
        <span class="goal-emoji">${g.emoji}</span>
        <b>${g.name}</b>
        <small>${money(g.balance, cur(g), { decimals: false })} din ${money(g.target, cur(g), { decimals: false })}</small>
        <span class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></span>
      </a>`;
    })}
    <button class="goal-chip add" data-new-goal><span class="goal-emoji">${icon("plus")}</span><b>Pușculiță nouă</b><small>Economisește pentru un obiectiv</small></button>
  </div>`;
}

function tipCard(goals) {
  if (storageGet(TIP_KEY)) return "";
  const hasRoundup = goals.some((g) => g.roundup_enabled);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const tip = !hasRoundup
    ? { icon: "repeat", title: "Economisește fără să te gândești", text: "Activează rotunjirea: fiecare plată cu cardul e rotunjită, iar restul ajunge în pușculiță.", cta: "Creează o pușculiță", action: "goal" }
    : !standalone
      ? { icon: "phone", title: "AutoBank pe ecranul principal", text: "Instalează aplicația pe telefon pentru acces rapid, ca o aplicație nativă.", cta: "Vezi cum", action: "install" }
      : null;
  if (!tip) return "";
  return html`<section class="tip-card">
    <button class="icon-btn ghost tip-close" data-tip-close aria-label="Ascunde">${icon("close", { size: 18 })}</button>
    <div class="tip-icon">${icon(tip.icon, { size: 26 })}</div>
    <div><h3>${tip.title}</h3><p>${tip.text}</p><button class="pill-btn" data-tip="${tip.action}">${tip.cta}</button></div>
  </section>`;
}

export async function render(el) {
  el.innerHTML = html`<div class="page home">${skeleton(4)}</div>`;
  const [me, accounts, goals] = await Promise.all([store.get("me"), store.get("accounts"), store.get("goals")]);
  const firstName = me.full_name.split(/\s+/)[0];
  let index = Math.min(Number(storageGet(SELECTED_KEY)) || 0, accounts.length - 1);

  el.innerHTML = html`<div class="page home">
    <header class="top">
      <a class="hello" href="#/profile"><span class="avatar">${initials(me.full_name)}</span>
        <span>Bună, ${firstName}!</span>${icon("chevronDown", { size: 20, cls: "accent" })}</a>
      <a class="icon-btn" href="#/search" aria-label="Caută">${icon("search")}</a>
    </header>

    <nav class="h-scroll tiles" aria-label="Scurtături">
      ${tiles.map(([ic, label, href]) => href.startsWith("#")
        ? html`<a class="tile" href="${href}">${icon(ic, { size: 26 })}<span>${label}</span></a>`
        : html`<button class="tile" data-tile="${href}">${icon(ic, { size: 26 })}<span>${label}</span></button>`)}
    </nav>

    <div class="carousel" data-carousel>
      ${accounts.map(accountSlide)}
      <article class="acc-slide new" data-new-account>
        <div class="new-plus">${icon("plus", { size: 34 })}</div>
        <h3>Cont nou</h3><p class="muted">În RON, EUR sau USD, gratuit.</p>
      </article>
    </div>
    <div class="dots" role="tablist" aria-label="Conturi">
      ${[...accounts, null].map((_, i) => html`<button class="dot" data-dot="${i}" aria-label="Contul ${i + 1}"></button>`)}
    </div>

    ${tipCard(goals)}

    <section class="section">
      <div class="section-head"><h2>Pușculițele tale</h2><a href="#/savings">Vezi toate</a></div>
      ${goalsRow(goals, accounts)}
    </section>

    <section class="section" data-insight></section>

    <section class="section">
      <div class="section-head"><h2>Tranzacții recente</h2><a data-all href="#/account/${accounts[index].id}">Vezi toate</a></div>
      <div class="card-list" data-recent>${skeleton(3)}</div>
    </section>
  </div>`;

  const carousel = $("[data-carousel]", el);
  const dots = $$("[data-dot]", el);
  let loadToken = 0;

  async function showAccount(i) {
    const account = accounts[i];
    dots.forEach((d, j) => d.classList.toggle("active", j === i));
    if (!account) return;
    storageSet(SELECTED_KEY, i);
    $("[data-all]", el).href = `#/account/${account.id}`;
    const token = ++loadToken;
    const [txs, stats] = await Promise.all([
      api(`/api/accounts/${account.id}/transactions?limit=5`),
      api(`/api/stats?account_id=${account.id}&months=2`),
    ]);
    if (token !== loadToken) return;
    const recent = $("[data-recent]", el);
    if (txs.length) txList(recent, txs, accounts, { grouped: false });
    else recent.innerHTML = emptyState("wallet", "Nicio tranzacție încă", "Adaugă bani în cont ca să începi.");

    const top = stats.categories[0];
    const month = monthName(Number(stats.month.slice(5)));
    $("[data-insight]", el).innerHTML = html`<a class="insight" href="#/stats?account=${account.id}">
      <div><span class="muted small">Cheltuieli în ${month}</span>
        <b>${money(stats.total_expenses, account.currency)}</b>
        <span class="muted small">${top
          ? `${Math.round(top.share * 100)}% pe ${category(top.category).label.toLowerCase()}`
          : "Nicio cheltuială luna aceasta"}</span></div>
      <span class="insight-icon">${icon("chart", { size: 24 })}</span></a>`;
  }

  // Track the slide in view to update the dots and the account-specific sections.
  let current = -1;
  const onScroll = () => {
    const step = carousel.firstElementChild.offsetWidth + 12; // slide width + gap
    const clamped = Math.max(0, Math.min(Math.round(carousel.scrollLeft / step), accounts.length));
    if (clamped !== current) {
      current = clamped;
      showAccount(clamped);
    }
  };
  carousel.addEventListener("scroll", () => requestAnimationFrame(onScroll), { passive: true });

  const slideTo = (i, smooth = true) => {
    const slide = carousel.children[i];
    carousel.scrollTo({ left: slide.offsetLeft - carousel.firstElementChild.offsetLeft, behavior: smooth ? "smooth" : "instant" });
  };
  on(el, "click", "[data-dot]", (e, d) => slideTo(Number(d.dataset.dot)));

  on(carousel, "click", "[data-act]", (e, btn) => {
    const account = accounts.find((a) => a.id === Number(btn.closest("[data-acc]").dataset.acc));
    const act = btn.dataset.act;
    if (act === "pay") transferFlow({ account });
    if (act === "add") depositFlow(account);
    if (act === "more") accountMoreSheet(account, { onOpenAccount: () => { location.hash = `#/account/${account.id}`; } });
  });
  on(carousel, "click", "[data-new-account]", () => newAccountFlow());
  on(el, "click", "[data-new-goal]", () => goalCreateFlow());
  on(el, "click", "[data-tile=statement]", () => statementFlow(accounts[Math.min(current, accounts.length - 1)] || accounts[0]));
  on(el, "click", "[data-tip-close]", (e, btn) => { storageSet(TIP_KEY, "1"); btn.closest(".tip-card").remove(); });
  on(el, "click", "[data-tip=goal]", () => goalCreateFlow({ roundup: true }));
  on(el, "click", "[data-tip=install]", () => { location.hash = "#/profile"; });

  slideTo(index, false);
  current = index;
  showAccount(index);
}
