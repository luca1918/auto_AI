import { api, store } from "../api.js";
import { txList } from "../flows.js";
import { $, CATEGORIES, emptyState, html, icon, on, raw } from "../ui.js";

const FILTERS = ["groceries", "restaurants", "transport", "shopping", "bills", "transfers", "savings", "income"];

export async function render(el, params, query) {
  const accounts = await store.get("accounts");
  const accountId = query.get("account");
  const state = { q: query.get("q") || "", category: query.get("category") || "" };

  el.innerHTML = html`<div class="page">
    <header class="search-head">
      <a class="icon-btn" href="#/" data-back aria-label="Înapoi">${icon("back")}</a>
      <label class="search-box">${icon("search", { size: 20 })}<span class="sr-only">Caută</span>
        <input type="search" placeholder="Comerciant, persoană, IBAN sau sumă" value="${state.q}" autofocus enterkeyhint="search"></label>
    </header>
    <div class="h-scroll chips">${FILTERS.map((c) => html`
      <button class="chip ${state.category === c ? "active" : ""}" data-cat="${c}">${icon(CATEGORIES[c].icon, { size: 16 })} ${CATEGORIES[c].label}</button>`)}</div>
    ${accountId ? html`<p class="muted small">În ${accounts.find((a) => a.id === Number(accountId))?.name || "cont"}</p>` : ""}
    <div class="card-list flat" data-results></div>
  </div>`;

  $("[data-back]", el).addEventListener("click", (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  const results = $("[data-results]", el);
  let seq = 0;
  async function run() {
    const mine = ++seq;
    if (!state.q && !state.category) {
      results.innerHTML = emptyState("search", "Caută în tranzacții", "Scrie numele unui comerciant, al unei persoane, un IBAN sau o sumă (ex. 23,45).");
      return;
    }
    const qs = new URLSearchParams({ limit: "100" });
    if (state.q) qs.set("q", state.q);
    if (state.category) qs.set("category", state.category);
    if (accountId) qs.set("account_id", accountId);
    const txs = await api(`/api/transactions?${qs}`);
    if (mine !== seq) return;
    if (txs.length) txList(results, txs, accounts);
    else results.innerHTML = emptyState("search", "Niciun rezultat", raw("Încearcă alt termen sau altă categorie."));
  }

  let timer;
  $("input", el).addEventListener("input", (e) => {
    state.q = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  on(el, "click", "[data-cat]", (e, b) => {
    state.category = state.category === b.dataset.cat ? "" : b.dataset.cat;
    el.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("active", x.dataset.cat === state.category));
    run();
  });
  run();
}
