import { api, store } from "../api.js";
import {
  accountDetailsSheet, accountMoreSheet, depositFlow, moveFlow, newAccountFlow, txList,
} from "../flows.js";
import { $, bigMoney, copyText, emptyState, groupIban, html, icon, money, on, skeleton } from "../ui.js";

export async function renderList(el) {
  el.innerHTML = html`<div class="page">${skeleton(3)}</div>`;
  const accounts = await store.get("accounts");
  const totals = {};
  accounts.forEach((a) => { totals[a.currency] = (totals[a.currency] || 0) + Number(a.balance); });

  el.innerHTML = html`<div class="page">
    <header class="page-head"><a class="icon-btn" href="#/" aria-label="Înapoi">${icon("back")}</a>
      <h1 class="center-title">Conturi</h1>
      <button class="icon-btn primary" data-new aria-label="Cont nou">${icon("plus")}</button></header>
    <section class="hero-card"><span class="muted small">Sold total</span>
      ${Object.entries(totals).map(([c, v]) => html`<div class="hero-amount">${bigMoney(v, c)}</div>`)}</section>
    <div class="card-list">${accounts.map((a) => html`
      <a class="acc-row" href="#/account/${a.id}">
        <span class="tx-icon">${icon("wallet", { size: 20 })}</span>
        <span class="tx-main"><span class="tx-title">${a.name}</span><span class="tx-sub mono">${groupIban(a.iban)}</span></span>
        <span class="tx-amt">${money(a.balance, a.currency)}</span>
      </a>`)}</div>
  </div>`;
  on(el, "click", "[data-new]", () => newAccountFlow());
}

const PAGE = 30;

export async function renderAccount(el, { id }) {
  el.innerHTML = html`<div class="page">${skeleton(4)}</div>`;
  const accounts = await store.get("accounts");
  const account = accounts.find((a) => a.id === Number(id));
  if (!account) {
    el.innerHTML = html`<div class="page"><header class="page-head"><a class="icon-btn" href="#/" aria-label="Înapoi">${icon("back")}</a></header>
      ${emptyState("wallet", "Contul nu există", "")}</div>`;
    return;
  }

  el.innerHTML = html`<div class="page account-page">
    <header class="page-head"><a class="icon-btn" href="#/" aria-label="Înapoi">${icon("back")}</a>
      <a class="icon-btn" href="#/search?account=${account.id}" aria-label="Caută în cont">${icon("search")}</a></header>
    <section class="account-hero">
      <p class="muted">${account.name} · ${account.currency}</p>
      <div class="hero-amount xl">${bigMoney(account.balance, account.currency)}</div>
      <button class="iban-line" data-copy-iban>${icon("bank", { size: 18 })} ${groupIban(account.iban)}</button>
      <div class="circle-actions">
        <button data-add><span class="circle">${icon("plus")}</span>Adaugă bani</button>
        <button data-move><span class="circle">${icon("swap")}</span>Mută</button>
        <button data-details><span class="circle">${icon("bank")}</span>Detalii</button>
        <button data-more><span class="circle">${icon("dots")}</span>Mai multe</button>
      </div>
    </section>
    <section class="section"><div class="card-list flat" data-txs>${skeleton(4)}</div>
      <button class="btn secondary block" data-load-more hidden>Încarcă mai multe</button></section>
  </div>`;

  const box = $("[data-txs]", el);
  const more = $("[data-load-more]", el);
  let txs = [];
  async function load() {
    const page = await api(`/api/accounts/${account.id}/transactions?limit=${PAGE}&offset=${txs.length}`);
    txs = txs.concat(page);
    if (txs.length) txList(box, txs, accounts);
    else box.innerHTML = emptyState("wallet", "Nicio tranzacție încă", "Adaugă bani ca să începi.");
    more.hidden = page.length < PAGE;
  }
  more.addEventListener("click", load);
  on(el, "click", "[data-copy-iban]", () => copyText(account.iban, "IBAN copiat"));
  on(el, "click", "[data-add]", () => depositFlow(account));
  on(el, "click", "[data-move]", () => moveFlow(account));
  on(el, "click", "[data-details]", () => accountDetailsSheet(account));
  on(el, "click", "[data-more]", () => accountMoreSheet(account));
  await load();
}
