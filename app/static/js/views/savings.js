import { api, store } from "../api.js";
import { amountField, refresh } from "../flows.js";
import {
  $, bigMoney, busy, confirmSheet, currencySymbol, dateTimeLabel, emptyState, html, icon, jarArt, money, on, openSheet,
  parseAmount, raw, skeleton, successSheet, toast,
} from "../ui.js";

const EMOJIS = ["🎯", "🏖️", "✈️", "🏠", "🚗", "💻", "🎓", "💍", "🎁", "🐶", "🩺", "📱"];
const ENTRY = {
  deposit: ["plus", "Depunere"], withdrawal: ["arrowUpRight", "Retragere"], roundup: ["repeat", "Rotunjire"],
};

const pct = (g) => Math.min(100, Math.round((Number(g.balance) / Number(g.target)) * 100));
const deadlineLabel = (d) => new Date(`${d}T00:00`).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" });

function formErrorBox(root, message) {
  const box = $(".form-error", root);
  box.textContent = message;
  box.hidden = false;
}

function emojiPicker(selected) {
  return html`<fieldset class="field"><legend>Alege o pictogramă</legend><div class="emoji-grid">
    ${EMOJIS.map((e) => html`<label><input type="radio" name="emoji" value="${e}" ${raw(e === selected ? "checked" : "")}><span>${e}</span></label>`)}
  </div></fieldset>`;
}

// ---------- flows ----------
export async function goalCreateFlow({ roundup = false } = {}) {
  const accounts = await store.get("accounts");
  return openSheet({
    title: "Pușculiță nouă",
    body: html`<form class="form" novalidate>
      ${emojiPicker("🏖️")}
      <label class="field"><span>Pentru ce economisești?</span><input name="name" maxlength="60" placeholder="ex. Vacanță la mare" required></label>
      <label class="field"><span>Suma țintă</span><input name="target" inputmode="decimal" placeholder="ex. 3.000" required></label>
      ${accounts.length > 1 ? html`<label class="field"><span>Contul din care economisești</span><select name="account_id">
        ${accounts.map((a) => html`<option value="${a.id}">${a.name} · ${a.currency}</option>`)}</select></label>` : ""}
      <label class="field"><span>Termen (opțional)</span><input name="deadline" type="date"></label>
      <label class="switch-row"><span><b>Rotunjire automată</b><small>Plățile cu cardul se rotunjesc în sus, iar restul intră aici.</small></span>
        <input type="checkbox" name="roundup" class="switch" ${raw(roundup ? "checked" : "")}></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Creează pușculița</button></form>`,
    onMount(el, close) {
      const form = $("form", el);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const target = parseAmount(form.target.value);
            if (!form.name.value.trim()) throw new Error("Dă un nume pușculiței");
            if (!target) throw new Error("Introdu o sumă țintă validă");
            const goal = await api("/api/goals", { method: "POST", body: {
              name: form.name.value.trim(), emoji: form.emoji.value, target,
              account_id: Number(form.account_id?.value || accounts[0].id),
              deadline: form.deadline.value || null, roundup_enabled: form.roundup.checked,
            } });
            close();
            store.invalidate("goals");
            location.hash = `#/savings/${goal.id}`;
          } catch (err) { formErrorBox(el, err.message); }
        });
      });
    },
  });
}

function goalMoneyFlow(goal, mode) {
  const deposit = mode === "deposit";
  return openSheet({
    title: deposit ? `Adaugă în ${goal.name}` : `Retrage din ${goal.name}`,
    body: html`<form class="form" novalidate>
      <p class="sheet-text">${deposit ? "Banii se mută din contul asociat." : `În pușculiță: ${money(goal.balance, goal.currency)}`}</p>
      ${amountField(goal.currency, { chips: deposit ? ["10", "50", "100", "200"] : [] })}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">${deposit ? "Adaugă" : "Retrage"}</button></form>`,
    onMount(el, close) {
      el.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-chip]");
        if (chip) $("[name=amount]", el).value = chip.dataset.chip;
      });
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const amount = parseAmount(e.target.amount.value);
            if (!amount) throw new Error("Introdu o sumă validă");
            await api(`/api/goals/${goal.id}/${mode}`, { method: "POST", body: { amount }, idempotent: true });
            close();
            store.invalidate("goals", "accounts");
            refresh();
            successSheet({ title: deposit ? "Ai pus bani deoparte" : "Bani retrași", amount: money(amount, goal.currency),
              subtitle: deposit ? `în ${goal.name}` : "în contul asociat" });
          } catch (err) { formErrorBox(el, err.message); }
        });
      });
    },
  });
}

function goalEditFlow(goal) {
  return openSheet({
    title: "Editează pușculița",
    body: html`<form class="form" novalidate>
      ${emojiPicker(goal.emoji)}
      <label class="field"><span>Nume</span><input name="name" value="${goal.name}" maxlength="60" required></label>
      <label class="field"><span>Suma țintă (${currencySymbol(goal.currency)})</span><input name="target" inputmode="decimal" value="${String(goal.target).replace(".", ",")}" required></label>
      <label class="field"><span>Termen</span><input name="deadline" type="date" value="${goal.deadline || ""}"></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Salvează</button></form>`,
    onMount(el, close) {
      const form = $("form", el);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          try {
            const target = parseAmount(form.target.value);
            if (!target) throw new Error("Introdu o sumă țintă validă");
            await api(`/api/goals/${goal.id}`, { method: "PATCH", body: {
              name: form.name.value.trim(), emoji: form.emoji.value, target, deadline: form.deadline.value || null,
            } });
            close();
            store.invalidate("goals");
            refresh();
          } catch (err) { formErrorBox(el, err.message); }
        });
      });
    },
  });
}

// ---------- list ----------
export async function render(el) {
  el.innerHTML = html`<div class="page">${skeleton(4)}</div>`;
  const goals = await store.get("goals");
  const totals = {};
  goals.forEach((g) => { totals[g.currency] = (totals[g.currency] || 0) + Number(g.balance); });
  const totalList = Object.entries(totals);

  el.innerHTML = html`<div class="page">
    <header class="page-head"><h1>Economii</h1>
      <button class="icon-btn primary" data-new aria-label="Pușculiță nouă">${icon("plus")}</button></header>

    <section class="hero-card savings-hero">
      <div>
        <span class="muted small">Total economisit</span>
        ${totalList.length ? totalList.map(([c, v]) => html`<div class="hero-amount">${bigMoney(v, c)}</div>`)
          : html`<div class="hero-amount">${bigMoney(0, "RON")}</div>`}
        <span class="muted small">${goals.length === 1 ? "într-o pușculiță" : `în ${goals.length} pușculițe`}</span>
      </div>
      ${jarArt()}
    </section>

    ${goals.length ? html`<div class="goal-list">${goals.map((g) => html`
      <a class="goal-card" href="#/savings/${g.id}">
        <span class="goal-emoji lg">${g.emoji}</span>
        <div class="goal-info">
          <div class="goal-top"><b>${g.name}</b>
            ${g.roundup_enabled ? html`<span class="badge" title="Rotunjire activă">${icon("repeat", { size: 13 })} Auto</span>` : ""}
            <span>${pct(g)}%</span></div>
          <span class="progress" role="progressbar" aria-valuenow="${pct(g)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct(g)}%"></span></span>
          <div class="goal-meta"><span>${money(g.balance, g.currency)} din ${money(g.target, g.currency, { decimals: false })}</span></div>
        </div>
      </a>`)}</div>`
      : emptyState("piggy", "Nicio pușculiță încă", "Pune deoparte bani pentru vacanțe, gadgeturi sau un fond de urgență.",
        html`<button class="btn primary" data-new>Creează prima pușculiță</button>`)}
  </div>`;
  on(el, "click", "[data-new]", () => goalCreateFlow());
}

// ---------- detail ----------
const entryRow = (currency) => (e) => html`<div class="tx static">
  <span class="tx-icon">${icon(ENTRY[e.kind][0], { size: 20 })}</span>
  <span class="tx-main"><span class="tx-title">${ENTRY[e.kind][1]}</span><span class="tx-sub">${dateTimeLabel(e.created_at)}</span></span>
  <span class="tx-amt ${Number(e.amount) > 0 ? "pos" : ""}">${money(e.amount, currency, { sign: true })}</span>
</div>`;

function ring(percent) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return raw(`<svg class="ring" viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="80" r="${r}" class="ring-track"/>
    <circle cx="80" cy="80" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - percent / 100)}"/>
  </svg>`);
}

export async function renderGoal(el, { id }) {
  el.innerHTML = html`<div class="page">${skeleton(4)}</div>`;
  let goal;
  try {
    goal = await api(`/api/goals/${id}`);
  } catch {
    el.innerHTML = html`<div class="page"><header class="page-head"><a class="icon-btn" href="#/savings" aria-label="Înapoi">${icon("back")}</a></header>
      ${emptyState("piggy", "Pușculița nu există", "Poate a fost închisă.")}</div>`;
    return;
  }
  const HISTORY_PAGE = 20;
  const [entries, accounts] = await Promise.all([api(`/api/goals/${id}/entries?limit=${HISTORY_PAGE}`), store.get("accounts")]);
  const account = accounts.find((a) => a.id === goal.account_id);
  const row = entryRow(goal.currency);
  const remaining = Math.max(0, Number(goal.target) - Number(goal.balance));

  el.innerHTML = html`<div class="page">
    <header class="page-head">
      <a class="icon-btn" href="#/savings" aria-label="Înapoi">${icon("back")}</a>
      <h1 class="center-title">${goal.name}</h1>
      <button class="icon-btn" data-edit aria-label="Editează">${icon("pencil")}</button>
    </header>

    <section class="goal-hero">
      <div class="ring-wrap">${ring(pct(goal))}<span class="ring-emoji">${goal.emoji}</span></div>
      <div class="hero-amount">${bigMoney(goal.balance, goal.currency)}</div>
      <p class="muted">${pct(goal)}% din ${money(goal.target, goal.currency, { decimals: false })}
        ${remaining ? ` · mai ai ${money(remaining, goal.currency)}` : " · obiectiv atins 🎉"}</p>
      ${goal.deadline ? html`<p class="muted small">${icon("calendar", { size: 15 })} până la ${deadlineLabel(goal.deadline)}</p>` : ""}
      <div class="acc-actions">
        <button data-add><span class="sq">${icon("plus", { size: 26 })}</span>Adaugă</button>
        <button data-withdraw ${raw(Number(goal.balance) ? "" : "disabled")}><span class="sq outline">${icon("arrowUpRight", { size: 26 })}</span>Retrage</button>
      </div>
    </section>

    <label class="switch-row card">
      <span><b>Rotunjire automată</b><small>Plățile cu cardul din ${account?.name || "cont"} se rotunjesc la leu întreg, iar diferența intră aici.</small></span>
      <input type="checkbox" class="switch" data-roundup ${raw(goal.roundup_enabled ? "checked" : "")}>
    </label>

    <section class="section">
      <div class="section-head"><h2>Istoric</h2></div>
      ${entries.length ? html`<div class="card-list" data-history>${entries.map(row)}</div>
        <button class="btn secondary block" data-more-history ${raw(entries.length < HISTORY_PAGE ? "hidden" : "")}>Vezi mai mult</button>`
        : emptyState("sparkle", "Încă nu ai pus bani deoparte", "Începe cu o sumă mică – contează consecvența.")}
    </section>

    <button class="btn danger-ghost block" data-close-goal>${icon("trash", { size: 18 })} Închide pușculița</button>
  </div>`;

  let loaded = entries.length;
  on(el, "click", "[data-more-history]", (e, btn) => busy(btn, async () => {
    const more = await api(`/api/goals/${id}/entries?limit=${HISTORY_PAGE}&offset=${loaded}`);
    loaded += more.length;
    $("[data-history]", el).insertAdjacentHTML("beforeend", html`${more.map(row)}`.toString());
    btn.hidden = more.length < HISTORY_PAGE;
  }));
  on(el, "click", "[data-add]", () => goalMoneyFlow(goal, "deposit"));
  on(el, "click", "[data-withdraw]", () => goalMoneyFlow(goal, "withdraw"));
  on(el, "click", "[data-edit]", () => goalEditFlow(goal));
  $("[data-roundup]", el).addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    try {
      await api(`/api/goals/${goal.id}`, { method: "PATCH", body: { roundup_enabled: enabled } });
      store.invalidate("goals");
      toast(enabled ? "Rotunjirea e activă pentru această pușculiță" : "Rotunjire dezactivată");
    } catch (err) {
      e.target.checked = !enabled;
      toast(err.message, { error: true });
    }
  });
  on(el, "click", "[data-close-goal]", async () => {
    const ok = await confirmSheet({
      title: "Închizi pușculița?",
      message: Number(goal.balance)
        ? `${money(goal.balance, goal.currency)} se vor întoarce în ${account?.name || "cont"}.`
        : "Pușculița va fi ștearsă din listă.",
      confirmLabel: "Închide pușculița", danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/goals/${goal.id}`, { method: "DELETE" });
      store.invalidate("goals", "accounts");
      toast("Pușculiță închisă");
      location.hash = "#/savings";
    } catch (err) { toast(err.message, { error: true }); }
  });
}
