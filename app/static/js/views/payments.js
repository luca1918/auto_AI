import { api, store } from "../api.js";
import {
  beneficiaryFlow, cardPaymentFlow, depositFlow, describeAccount, moveFlow, pickSheet, transferFlow, txList,
} from "../flows.js";
import { emptyState, groupIban, html, icon, initials, on, skeleton, toast } from "../ui.js";

const ACTIONS = [
  ["transfer", "send", "Transfer", "Către orice cont AutoBank"],
  ["move", "swap", "Între conturi", "Instant, fără comision"],
  ["add", "plus", "Adaugă bani", "Alimentează un cont"],
  ["card", "bag", "Plată cu cardul", "Simulează o cumpărătură"],
];

export async function render(el) {
  el.innerHTML = html`<div class="page">${skeleton(4)}</div>`;
  const [accounts, beneficiaries, recent] = await Promise.all([
    store.get("accounts"), store.get("beneficiaries"), api("/api/transactions?category=transfers&limit=10"),
  ]);

  el.innerHTML = html`<div class="page">
    <header class="page-head"><h1>Plăți</h1>
      <a class="icon-btn" href="#/search" aria-label="Caută">${icon("search")}</a></header>

    <div class="action-grid">${ACTIONS.map(([key, ic, title, sub]) => html`
      <button class="action-tile" data-a="${key}"><span class="sq small">${icon(ic, { size: 22 })}</span>
        <b>${title}</b><small>${sub}</small></button>`)}</div>

    <section class="section">
      <div class="section-head"><h2>Beneficiari</h2><button class="link-btn" data-add-ben>${icon("plus", { size: 16 })} Adaugă</button></div>
      ${beneficiaries.length ? html`<div class="card-list">${beneficiaries.map((b) => html`
        <div class="ben-row">
          <span class="avatar">${initials(b.name)}</span>
          <span class="tx-main"><span class="tx-title">${b.name}</span><span class="tx-sub mono">${groupIban(b.iban)}</span></span>
          <button class="icon-btn ghost sm" data-edit-ben="${b.id}" aria-label="Editează ${b.name}">${icon("pencil", { size: 18 })}</button>
          <button class="pill-btn" data-send="${b.id}">Trimite</button>
        </div>`)}</div>`
        : emptyState("users", "Niciun beneficiar salvat", "Salvează persoanele cărora le trimiți des bani.",
          html`<button class="btn secondary" data-add-ben>Adaugă beneficiar</button>`)}
    </section>

    <section class="section">
      <div class="section-head"><h2>Transferuri recente</h2></div>
      <div class="card-list" data-recent></div>
    </section>
  </div>`;

  const recentBox = el.querySelector("[data-recent]");
  if (recent.length) txList(recentBox, recent, accounts);
  else recentBox.innerHTML = emptyState("send", "Niciun transfer încă", "");

  const byId = (id) => beneficiaries.find((b) => b.id === Number(id));
  on(el, "click", "[data-a]", async (e, btn) => {
    const action = btn.dataset.a;
    if (action === "transfer") return transferFlow();
    if (action === "move") {
      const account = await pickSheet("Din ce cont muți?", accounts, describeAccount);
      if (account) moveFlow(account);
    }
    if (action === "add") {
      const account = await pickSheet("În ce cont adaugi?", accounts, describeAccount);
      if (account) depositFlow(account);
    }
    if (action === "card") {
      const cards = (await store.get("cards")).filter((c) => !c.frozen);
      if (!cards.length) {
        toast("Ai nevoie de un card activ – emite unul din secțiunea Carduri");
        location.hash = "#/cards";
        return;
      }
      const card = await pickSheet("Cu ce card plătești?", cards,
        (c) => ({ iconName: "card", label: c.label, sub: `•••• ${c.last4}` }));
      if (card) cardPaymentFlow(card);
    }
  });
  on(el, "click", "[data-add-ben]", () => beneficiaryFlow());
  on(el, "click", "[data-edit-ben]", (e, b) => beneficiaryFlow(byId(b.dataset.editBen)));
  on(el, "click", "[data-send]", (e, b) => transferFlow({ beneficiary: byId(b.dataset.send) }));
}
