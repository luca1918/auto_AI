// Multi-step actions shown in bottom sheets, shared by several screens.
import { api, download, store } from "./api.js";
import {
  $, $$, CARD_CATEGORIES, KIND_LABEL, busy, category, copyText, currencySymbol, dateTimeLabel, dayLabel, groupIban, html,
  icon, initials, money, on, openSheet, parseAmount, raw, successSheet, timeLabel, toast, txTitle,
} from "./ui.js";

export const refresh = () => window.dispatchEvent(new Event("autobank:refresh"));

function afterMoneyMove() {
  store.invalidate("accounts", "goals", "cards");
  refresh();
}

const normalizeIban = (v) => v.replace(/\s+/g, "").toUpperCase();
const looksLikeIban = (v) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v);

// ---------- form pieces ----------
export function amountField(currency, { chips = [], autofocus = true } = {}) {
  return html`
    <label class="amount-field">
      <span class="sr-only">Sumă</span>
      <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" required ${raw(autofocus ? "autofocus" : "")}>
      <span class="amount-cur">${currencySymbol(currency)}</span>
    </label>
    ${chips.length ? html`<div class="chips center">${chips.map((c) => html`<button type="button" class="chip" data-chip="${c}">${c}</button>`)}</div>` : ""}`;
}

function bindChips(root) {
  on(root, "click", "[data-chip]", (e, el) => {
    const input = $("[name=amount]", root);
    input.value = el.dataset.chip;
    input.focus();
  });
}

function accountPicker(accounts, selectedId, name = "account_id", label = "Din contul") {
  return html`<fieldset class="field"><legend>${label}</legend><div class="acc-picker">
    ${accounts.map((a) => html`<label class="acc-option">
      <input type="radio" name="${name}" value="${a.id}" ${raw(a.id === selectedId ? "checked" : "")}>
      <span><b>${a.name}</b><small>${money(a.balance, a.currency)}</small></span></label>`)}
  </div></fieldset>`;
}

function formError() {
  return html`<p class="form-error" role="alert" hidden></p>`;
}

function showError(root, message) {
  const el = $(".form-error", root);
  el.textContent = message;
  el.hidden = false;
}

function readAmount(form) {
  const amount = parseAmount(form.amount.value);
  if (!amount) throw new Error("Introdu o sumă validă, de exemplu 25,50");
  return amount;
}

// ---------- deposit ----------
export function depositFlow(account) {
  return openSheet({
    title: "Adaugă bani",
    body: html`<form class="form" novalidate>
      <p class="sheet-text">În ${account.name} · ${groupIban(account.iban)}</p>
      ${amountField(account.currency, { chips: ["50", "100", "250", "500"] })}
      <p class="hint center">${icon("info", { size: 16 })} Alimentare simulată – în aplicația demo nu se folosesc bani reali.</p>
      ${formError()}
      <button class="btn primary block" type="submit">Adaugă bani</button></form>`,
    onMount(el, close) {
      bindChips(el);
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const amount = readAmount(e.target);
            await api(`/api/accounts/${account.id}/deposit`, { method: "POST", body: { amount }, idempotent: true });
            close();
            afterMoneyMove();
            successSheet({ title: "Bani adăugați", amount: money(amount, account.currency), subtitle: account.name });
          } catch (err) { showError(el, err.message); }
        });
      });
    },
  });
}

// ---------- withdraw ----------
export function withdrawFlow(account) {
  return openSheet({
    title: "Retrage numerar",
    body: html`<form class="form" novalidate>
      <p class="sheet-text">Disponibil: ${money(account.balance, account.currency)}</p>
      ${amountField(account.currency, { chips: ["50", "100", "200"] })}
      ${formError()}
      <button class="btn primary block" type="submit">Retrage</button></form>`,
    onMount(el, close) {
      bindChips(el);
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const amount = readAmount(e.target);
            await api(`/api/accounts/${account.id}/withdraw`, { method: "POST", body: { amount }, idempotent: true });
            close();
            afterMoneyMove();
            successSheet({ title: "Retragere efectuată", amount: money(amount, account.currency) });
          } catch (err) { showError(el, err.message); }
        });
      });
    },
  });
}

// ---------- transfer ----------
export async function transferFlow({ account, beneficiary } = {}) {
  const [accounts, beneficiaries] = await Promise.all([store.get("accounts"), store.get("beneficiaries")]);
  const state = {
    accountId: (account || accounts[0]).id,
    beneficiaryId: beneficiary?.id ?? null,
    iban: beneficiary?.iban ?? "",
    name: beneficiary?.name ?? "",
    amount: "",
    description: "",
    save: false,
  };
  const acc = () => accounts.find((a) => a.id === state.accountId);

  const formView = () => html`<form class="form" novalidate>
    ${accounts.length > 1 ? accountPicker(accounts, state.accountId) : html`<p class="sheet-text">Din ${acc().name} · ${money(acc().balance, acc().currency)}</p>`}
    ${beneficiaries.length ? html`<fieldset class="field"><legend>Beneficiari</legend><div class="ben-scroll">
      ${beneficiaries.map((b) => html`<button type="button" class="ben ${b.id === state.beneficiaryId ? "selected" : ""}" data-ben="${b.id}">
        <span class="avatar">${initials(b.name)}</span><span class="ben-name">${b.name}</span></button>`)}
    </div></fieldset>` : ""}
    <label class="field"><span>IBAN destinatar</span>
      <input name="iban" value="${groupIban(state.iban)}" placeholder="RO00 AUTO 0000 0000 0000 0000" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
    <label class="field"><span>Nume destinatar</span>
      <input name="name" value="${state.name}" placeholder="ex. Maria Ionescu" maxlength="100" autocomplete="off"></label>
    ${amountField(acc().currency, { autofocus: Boolean(beneficiary) })}
    <label class="field"><span>Detalii plată (opțional)</span>
      <input name="description" value="${state.description}" maxlength="140" placeholder="ex. Chirie octombrie"></label>
    <label class="switch-row" data-save-row ${raw(state.beneficiaryId ? "hidden" : "")}>
      <span>Salvează ca beneficiar</span><input type="checkbox" name="save" class="switch" ${raw(state.save ? "checked" : "")}></label>
    ${formError()}
    <button class="btn primary block" type="submit">Continuă</button></form>`;

  const confirmView = () => html`<div class="confirm">
    <div class="confirm-amount">${money(state.amount, acc().currency)}</div>
    <dl class="rows">
      <div><dt>Din</dt><dd>${acc().name}<small>${groupIban(acc().iban)}</small></dd></div>
      <div><dt>Către</dt><dd>${state.name || "Destinatar"}<small>${groupIban(state.iban)}</small></dd></div>
      ${state.description ? html`<div><dt>Detalii</dt><dd>${state.description}</dd></div>` : ""}
      <div><dt>Comision</dt><dd>0,00 ${currencySymbol(acc().currency)}</dd></div>
    </dl>
    ${formError()}
    <div class="stack-btns">
      <button class="btn primary" data-send>Confirmă plata</button>
      <button class="btn secondary" data-back>Înapoi</button>
    </div></div>`;

  return openSheet({
    title: "Transfer",
    body: html`<div data-step></div>`,
    onMount(el, close) {
      const step = $("[data-step]", el);
      const showForm = () => {
        step.innerHTML = formView();
        if (state.amount) $("[name=amount]", step).value = state.amount.replace(".", ",");
        const form = $("form", step);
        on(form, "change", "[name=account_id]", (e, input) => {
          state.accountId = Number(input.value);
          $(".amount-cur", form).textContent = currencySymbol(acc().currency);
        });
        on(form, "click", "[data-ben]", (e, btn) => {
          const b = beneficiaries.find((x) => x.id === Number(btn.dataset.ben));
          const same = state.beneficiaryId === b.id;
          state.beneficiaryId = same ? null : b.id;
          $$("[data-ben]", form).forEach((x) => x.classList.toggle("selected", !same && x === btn));
          form.iban.value = same ? "" : groupIban(b.iban);
          form.name.value = same ? "" : b.name;
          $("[data-save-row]", form).hidden = !same;
          if (!same) form.amount.focus();
        });
        form.iban.addEventListener("input", () => {
          if (state.beneficiaryId) {
            state.beneficiaryId = null;
            $$("[data-ben]", form).forEach((x) => x.classList.remove("selected"));
            $("[data-save-row]", form).hidden = false;
          }
        });
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          try {
            const iban = normalizeIban(form.iban.value);
            if (!looksLikeIban(iban)) throw new Error("Verifică IBAN-ul destinatarului");
            if (iban === acc().iban) throw new Error("Alege alt cont decât cel din care plătești");
            state.iban = iban;
            state.name = form.name.value.trim();
            state.amount = readAmount(form);
            state.description = form.description.value.trim();
            state.save = !state.beneficiaryId && form.save.checked;
            if (state.save && !state.name) throw new Error("Completează numele pentru a salva beneficiarul");
            if (Number(state.amount) > Number(acc().balance)) throw new Error("Fonduri insuficiente în contul selectat");
            showConfirm();
          } catch (err) { showError(form, err.message); }
        });
      };
      const showConfirm = () => {
        step.innerHTML = confirmView();
        $("[data-back]", step).addEventListener("click", showForm);
        $("[data-send]", step).addEventListener("click", (e) => busy(e.currentTarget, async () => {
          try {
            const tx = await api("/api/transfers", {
              method: "POST", idempotent: true,
              body: { from_account_id: state.accountId, to_iban: state.iban, amount: state.amount, description: state.description },
            });
            if (state.save) {
              await api("/api/beneficiaries", { method: "POST", body: { name: state.name, iban: state.iban } }).catch(() => {});
              store.invalidate("beneficiaries");
            }
            close();
            afterMoneyMove();
            successSheet({ title: "Bani trimiși", amount: money(state.amount, acc().currency),
              subtitle: `către ${tx.counterparty_name || state.name || groupIban(state.iban)}` });
          } catch (err) { showError(step, err.message); }
        }));
      };
      showForm();
    },
  });
}

// ---------- move between own accounts ----------
export async function moveFlow(account) {
  const accounts = await store.get("accounts", { fresh: true });
  const from = account || accounts[0];
  const targets = accounts.filter((a) => a.id !== from.id && a.currency === from.currency);
  if (!targets.length) {
    return openSheet({
      title: "Mută bani",
      body: html`<p class="sheet-text">Ai nevoie de încă un cont în ${from.currency} ca să muți bani între conturile tale.</p>
        <button class="btn primary block" data-new>Deschide un cont nou</button>`,
      onMount: (el, close) => $("[data-new]", el).addEventListener("click", () => { close(); newAccountFlow(from.currency); }),
    });
  }
  return openSheet({
    title: "Mută între conturile mele",
    body: html`<form class="form" novalidate>
      <p class="sheet-text">Din ${from.name} · ${money(from.balance, from.currency)}</p>
      ${accountPicker(targets, targets[0].id, "to", "În contul")}
      ${amountField(from.currency)}
      ${formError()}
      <button class="btn primary block" type="submit">Mută banii</button></form>`,
    onMount(el, close) {
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        const form = e.target;
        busy($("[type=submit]", el), async () => {
          try {
            const amount = readAmount(form);
            const to = targets.find((a) => a.id === Number(form.to.value));
            await api("/api/transfers", { method: "POST", idempotent: true,
              body: { from_account_id: from.id, to_iban: to.iban, amount } });
            close();
            afterMoneyMove();
            successSheet({ title: "Bani mutați", amount: money(amount, from.currency), subtitle: `în ${to.name}` });
          } catch (err) { showError(el, err.message); }
        });
      });
    },
  });
}

// ---------- accounts ----------
export async function accountDetailsSheet(account) {
  const me = await store.get("me");
  const rows = [["Titular", me.full_name], ["IBAN", groupIban(account.iban)], ["Monedă", account.currency],
    ["Bancă", "AutoBank (demo)"], ["Cod bancă", "AUTO"]];
  const shareText = `${me.full_name}\nIBAN: ${groupIban(account.iban)}\nAutoBank`;
  return openSheet({
    title: "Detalii cont",
    body: html`<dl class="rows">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      <div class="stack-btns">
        <button class="btn primary" data-copy>${icon("copy", { size: 18 })} Copiază IBAN</button>
        ${navigator.share ? html`<button class="btn secondary" data-share>${icon("share", { size: 18 })} Trimite detaliile</button>` : ""}
      </div>`,
    onMount(el) {
      $("[data-copy]", el).addEventListener("click", () => copyText(account.iban, "IBAN copiat"));
      $("[data-share]", el)?.addEventListener("click", () => navigator.share({ title: "Detalii cont", text: shareText }).catch(() => {}));
    },
  });
}

export function newAccountFlow(currency = "RON") {
  return openSheet({
    title: "Cont nou",
    body: html`<form class="form" novalidate>
      <label class="field"><span>Numele contului</span><input name="name" value="Economii" maxlength="100" required autofocus></label>
      <fieldset class="field"><legend>Moneda</legend><div class="segmented">
        ${["RON", "EUR", "USD"].map((c) => html`<label><input type="radio" name="currency" value="${c}" ${raw(c === currency ? "checked" : "")}><span>${c}</span></label>`)}
      </div></fieldset>
      ${formError()}
      <button class="btn primary block" type="submit">Deschide contul</button></form>`,
    onMount(el, close) {
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        const form = e.target;
        busy($("[type=submit]", el), async () => {
          try {
            const acc = await api("/api/accounts", { method: "POST", body: { name: form.name.value.trim(), currency: form.currency.value } });
            close();
            store.invalidate("accounts");
            refresh();
            toast(`Cont deschis: ${groupIban(acc.iban)}`);
          } catch (err) { showError(el, err.message); }
        });
      });
    },
  });
}

export function renameAccountFlow(account) {
  return openSheet({
    title: "Redenumește contul",
    body: html`<form class="form" novalidate>
      <label class="field"><span>Nume</span><input name="name" value="${account.name}" maxlength="100" required autofocus></label>
      ${formError()}<button class="btn primary block" type="submit">Salvează</button></form>`,
    onMount(el, close) {
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            await api(`/api/accounts/${account.id}`, { method: "PATCH", body: { name: e.target.name.value.trim() } });
            close();
            store.invalidate("accounts");
            refresh();
          } catch (err) { showError(el, err.message); }
        });
      });
    },
  });
}

export function statementFlow(account) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const periods = [
    ["Luna curentă", iso(new Date(today.getFullYear(), today.getMonth(), 1))],
    ["Ultimele 3 luni", iso(new Date(today.getFullYear(), today.getMonth() - 2, 1))],
    ["Tot istoricul", ""],
  ];
  return openSheet({
    title: "Extras de cont",
    body: html`<p class="sheet-text">Fișier CSV pentru Excel / Numbers, pentru ${account.name}.</p>
      <div class="list-actions">${periods.map(([label, from]) => html`
        <button class="list-action" data-from="${from}"><span class="la-icon">${icon("doc")}</span><span>${label}</span>${icon("download", { size: 20, cls: "muted" })}</button>`)}
      </div>`,
    onMount(el, close) {
      on(el, "click", "[data-from]", (e, btn) => busy(btn, async () => {
        const qs = btn.dataset.from ? `?from=${btn.dataset.from}` : "";
        try {
          await download(`/api/accounts/${account.id}/statement.csv${qs}`, "extras.csv");
          close();
        } catch (err) { toast(err.message, { error: true }); }
      }));
    },
  });
}

export function accountMoreSheet(account, { onOpenAccount } = {}) {
  const actions = [
    ["swap", "Mută între conturi", () => moveFlow(account)],
    ["banknote", "Retrage numerar", () => withdrawFlow(account)],
    ["bank", "Detalii cont", () => accountDetailsSheet(account)],
    ["doc", "Extras de cont", () => statementFlow(account)],
    ["pencil", "Redenumește contul", () => renameAccountFlow(account)],
    ...(onOpenAccount ? [["wallet", "Toate tranzacțiile", onOpenAccount]] : []),
    ["plus", "Deschide un cont nou", () => newAccountFlow()],
  ];
  return openSheet({
    title: account.name,
    body: html`<div class="list-actions">${actions.map(([ic, label], i) => html`
      <button class="list-action" data-i="${i}"><span class="la-icon">${icon(ic)}</span><span>${label}</span>${icon("chevronRight", { size: 18, cls: "muted" })}</button>`)}</div>`,
    onMount(el, close) {
      on(el, "click", "[data-i]", (e, btn) => { close(); actions[Number(btn.dataset.i)][2](); });
    },
  });
}

// ---------- transactions ----------
export function txRow(tx, currency) {
  const cat = category(tx.category);
  return html`<button class="tx" data-tx="${tx.id}">
    <span class="tx-icon">${icon(cat.icon, { size: 20 })}</span>
    <span class="tx-main"><span class="tx-title">${txTitle(tx)}</span>
      <span class="tx-sub">${cat.label} · ${timeLabel(tx.created_at)}</span></span>
    <span class="tx-amt ${Number(tx.amount) > 0 ? "pos" : ""}">${money(tx.amount, currency, { sign: true })}</span>
  </button>`;
}

// Renders transactions grouped by day and wires taps to the detail sheet.
export function txList(container, txs, accounts, { grouped = true } = {}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cur = (tx) => byId.get(tx.account_id)?.currency || "RON";
  container.classList.toggle("flat", grouped); // each day gets its own card
  if (!grouped) {
    container.innerHTML = html`<div class="tx-group">${txs.map((t) => txRow(t, cur(t)))}</div>`;
  } else {
    const groups = [];
    for (const tx of txs) {
      const label = dayLabel(tx.created_at);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(tx);
    }
    container.innerHTML = html`${groups.map((g) => html`<h3 class="day">${g.label}</h3>
      <div class="tx-group">${g.items.map((t) => txRow(t, cur(t)))}</div>`)}`;
  }
  const map = new Map(txs.map((t) => [String(t.id), t]));
  container.onclick = (e) => {
    const el = e.target.closest("[data-tx]");
    if (el) txDetailSheet(map.get(el.dataset.tx), byId.get(map.get(el.dataset.tx).account_id));
  };
}

export function txDetailSheet(tx, account) {
  const cat = category(tx.category);
  const currency = account?.currency || "RON";
  const rows = [
    ["Tip", KIND_LABEL[tx.kind] || tx.kind],
    ["Categorie", cat.label],
    ["Data", dateTimeLabel(tx.created_at)],
    ["Cont", account ? `${account.name} · ${groupIban(account.iban)}` : "—"],
    tx.counterparty_name && ["Contrapartidă", tx.counterparty_name],
    tx.counterparty_iban && ["IBAN contrapartidă", groupIban(tx.counterparty_iban)],
    tx.description && tx.description !== tx.counterparty_name && ["Detalii", tx.description],
    ["Sold după", money(tx.balance_after, currency)],
    ["Referință", tx.reference],
  ].filter(Boolean);
  return openSheet({
    body: html`<div class="tx-detail">
      <span class="tx-icon big">${icon(cat.icon, { size: 28 })}</span>
      <h2>${txTitle(tx)}</h2>
      <p class="tx-detail-amt ${Number(tx.amount) > 0 ? "pos" : ""}">${money(tx.amount, currency, { sign: true })}</p>
      <dl class="rows">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      <div class="stack-btns">
        <button class="btn secondary" data-copy>${icon("copy", { size: 18 })} Copiază referința</button>
        <button class="btn secondary" data-close>Închide</button>
      </div></div>`,
    onMount(el) {
      $("[data-copy]", el).addEventListener("click", () => copyText(tx.reference, "Referință copiată"));
    },
  });
}

// ---------- cards ----------
const MERCHANTS = [
  ["Supermarket", "groceries", "86.40"], ["Cafenea", "restaurants", "18.50"], ["Taxi", "transport", "32.70"],
  ["Farmacie", "health", "45.90"], ["Cinema", "entertainment", "38.00"], ["Factură energie", "bills", "212.35"],
];

export function cardPaymentFlow(card) {
  return openSheet({
    title: "Plată de test",
    body: html`<form class="form" novalidate>
      <p class="sheet-text">Simulează o plată la un comerciant cu ${card.label} •••• ${card.last4}.</p>
      <div class="chips">${MERCHANTS.map(([m, c, a], i) => html`<button type="button" class="chip" data-m="${i}">${icon(category(c).icon, { size: 16 })} ${m}</button>`)}</div>
      <label class="field"><span>Comerciant</span><input name="merchant" required maxlength="100" placeholder="ex. Librărie"></label>
      <label class="field"><span>Categorie</span><select name="category">
        ${CARD_CATEGORIES.map((c) => html`<option value="${c}">${category(c).label}</option>`)}</select></label>
      ${amountField(card.currency, { autofocus: false })}
      ${formError()}
      <button class="btn primary block" type="submit">Plătește</button></form>`,
    onMount(el, close) {
      const form = $("form", el);
      on(form, "click", "[data-m]", (e, btn) => {
        const [m, c, a] = MERCHANTS[Number(btn.dataset.m)];
        form.merchant.value = m;
        form.category.value = c;
        form.amount.value = a.replace(".", ",");
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const amount = readAmount(form);
            if (!form.merchant.value.trim()) throw new Error("Completează comerciantul");
            await api(`/api/cards/${card.id}/payments`, { method: "POST", idempotent: true,
              body: { merchant: form.merchant.value.trim(), amount, category: form.category.value } });
            close();
            afterMoneyMove();
            successSheet({ title: "Plată aprobată", amount: money(amount, card.currency), subtitle: form.merchant.value.trim() });
          } catch (err) { showError(el, err.message); }
        });
      });
    },
  });
}

// ---------- beneficiaries ----------
export function beneficiaryFlow(existing) {
  return openSheet({
    title: existing ? "Editează beneficiarul" : "Beneficiar nou",
    body: html`<form class="form" novalidate>
      <label class="field"><span>Nume</span><input name="name" value="${existing?.name || ""}" maxlength="100" required autofocus></label>
      ${existing ? html`<p class="sheet-text">${groupIban(existing.iban)}</p>`
        : html`<label class="field"><span>IBAN</span><input name="iban" placeholder="RO00 AUTO 0000 0000 0000 0000" autocapitalize="characters" spellcheck="false" required></label>`}
      ${formError()}
      <button class="btn primary block" type="submit">Salvează</button>
      ${existing ? html`<button class="btn danger-ghost block" type="button" data-delete>${icon("trash", { size: 18 })} Șterge beneficiarul</button>` : ""}
    </form>`,
    onMount(el, close) {
      const form = $("form", el);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const name = form.name.value.trim();
            if (!name) throw new Error("Completează numele");
            if (existing) {
              await api(`/api/beneficiaries/${existing.id}`, { method: "PATCH", body: { name } });
            } else {
              const iban = normalizeIban(form.iban.value);
              if (!looksLikeIban(iban)) throw new Error("IBAN invalid");
              await api("/api/beneficiaries", { method: "POST", body: { name, iban } });
            }
            close();
            store.invalidate("beneficiaries");
            refresh();
          } catch (err) { showError(el, err.message); }
        });
      });
      $("[data-delete]", el)?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
        await api(`/api/beneficiaries/${existing.id}`, { method: "DELETE" });
        close();
        store.invalidate("beneficiaries");
        refresh();
        toast("Beneficiar șters");
      }));
    },
  });
}

// Lets the user pick one item (account, card...) when an action needs one; resolves to it or undefined.
export function pickSheet(title, items, describe) {
  if (items.length === 1) return Promise.resolve(items[0]);
  let chosen;
  return openSheet({
    title,
    body: html`<div class="list-actions">${items.map((item, i) => {
      const { iconName, label, sub } = describe(item);
      return html`<button class="list-action" data-i="${i}"><span class="la-icon">${icon(iconName)}</span>
        <span>${label}${sub ? html`<small>${sub}</small>` : ""}</span>${icon("chevronRight", { size: 18, cls: "muted" })}</button>`;
    })}</div>`,
    onMount(el, close) {
      on(el, "click", "[data-i]", (e, b) => { chosen = items[Number(b.dataset.i)]; close(); });
    },
  }).then(() => chosen);
}

export const describeAccount = (a) => ({ iconName: "wallet", label: a.name, sub: `${money(a.balance, a.currency)} · ${groupIban(a.iban)}` });
