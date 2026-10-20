import { api, store } from "../api.js";
import { cardPaymentFlow, refresh, txList } from "../flows.js";
import {
  $, $$, busy, confirmSheet, copyText, emptyState, html, icon, logoMark, money, on, openSheet, parseAmount, raw,
  skeleton, toast,
} from "../ui.js";

const SELECTED_KEY = "autobank.card";
const pad = (n) => String(n).padStart(2, "0");
const expiry = (c) => `${pad(c.expiry_month)}/${String(c.expiry_year).slice(-2)}`;

function cardVisual(c) {
  return html`<article class="vcard ${c.frozen ? "frozen" : ""}" data-card="${c.id}" aria-label="${c.label}, se termină în ${c.last4}">
    <div class="vcard-top"><span class="vcard-logo">${logoMark(30)}</span><span class="vcard-label">${c.label}</span></div>
    <div class="vcard-chip"></div>
    <div class="vcard-num">•••• •••• •••• ${c.last4}</div>
    <div class="vcard-bottom">
      <span class="vcard-holder">${c.holder_name}</span>
      <span class="vcard-exp"><small>Expiră</small>${expiry(c)}</span>
      <span class="vcard-brand">VIRTUAL<br>DEBIT</span>
    </div>
    ${c.frozen ? html`<div class="vcard-frozen">${icon("snow", { size: 34 })}<b>Card înghețat</b></div>` : ""}
  </article>`;
}

function limitMeter(c) {
  const spent = Number(c.spent_this_month);
  if (c.monthly_limit == null) {
    return html`<div class="meter-card"><div class="meter-head"><span>Cheltuit luna aceasta</span><b>${money(spent, c.currency)}</b></div>
      <p class="muted small">Fără limită lunară. Setează una ca să-ți ții cheltuielile sub control.</p></div>`;
  }
  const limit = Number(c.monthly_limit);
  const ratio = Math.min(1, spent / limit);
  const level = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warn" : "";
  return html`<div class="meter-card">
    <div class="meter-head"><span>Cheltuit luna aceasta</span><b>${money(spent, c.currency)} <small class="muted">din ${money(limit, c.currency, { decimals: false })}</small></b></div>
    <span class="meter ${level}" role="meter" aria-valuenow="${spent}" aria-valuemin="0" aria-valuemax="${limit}"><span style="width:${ratio * 100}%"></span></span>
    <p class="muted small">${ratio >= 1 ? html`${icon("alert", { size: 14 })} Limita lunară a fost atinsă.`
      : `Mai poți cheltui ${money(limit - spent, c.currency)} luna aceasta.`}</p>
  </div>`;
}

function detailsFlow(card) {
  return openSheet({
    title: "Detaliile cardului",
    body: html`<div data-details>${skeleton(2)}</div>`,
    async onMount(el, close) {
      const box = $("[data-details]", el);
      try {
        const d = await api(`/api/cards/${card.id}/details`);
        const pan = d.pan.replace(/(.{4})/g, "$1 ").trim();
        let seconds = 30;
        box.innerHTML = html`<dl class="rows card-secret">
            <div><dt>Număr card</dt><dd class="mono">${pan} <button class="icon-btn ghost sm" data-copy="${d.pan}" aria-label="Copiază numărul">${icon("copy", { size: 18 })}</button></dd></div>
            <div><dt>Expiră</dt><dd class="mono">${pad(d.expiry_month)}/${d.expiry_year}</dd></div>
            <div><dt>CVV</dt><dd class="mono">${d.cvv} <button class="icon-btn ghost sm" data-copy="${d.cvv}" aria-label="Copiază CVV">${icon("copy", { size: 18 })}</button></dd></div>
            <div><dt>Titular</dt><dd>${card.holder_name}</dd></div>
          </dl>
          <p class="hint">${icon("lock", { size: 15 })} Se ascund automat în <b data-left>${seconds}</b> s. Nu le trimite nimănui.</p>`;
        on(box, "click", "[data-copy]", (e, b) => copyText(b.dataset.copy));
        const timer = setInterval(() => {
          seconds -= 1;
          const left = $("[data-left]", box);
          if (!left || seconds <= 0) { clearInterval(timer); close(); return; }
          left.textContent = seconds;
        }, 1000);
      } catch (err) {
        box.innerHTML = html`<p class="form-error">${err.message}</p>`;
      }
    },
  });
}

function limitFlow(card) {
  return openSheet({
    title: "Limită lunară",
    body: html`<form class="form" novalidate>
      <p class="sheet-text">Plățile care ar depăși limita în luna curentă sunt refuzate.</p>
      <label class="amount-field"><span class="sr-only">Limită</span>
        <input name="amount" inputmode="decimal" placeholder="0" value="${card.monthly_limit ? String(Number(card.monthly_limit)) : ""}" autofocus>
        <span class="amount-cur">${card.currency === "RON" ? "Lei" : card.currency}</span></label>
      <div class="chips center">${["500", "1000", "2500", "5000"].map((c) => html`<button type="button" class="chip" data-chip="${c}">${c}</button>`)}</div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Setează limita</button>
      ${card.monthly_limit ? html`<button class="btn secondary block" type="button" data-remove>Elimină limita</button>` : ""}
    </form>`,
    onMount(el, close) {
      const form = $("form", el);
      on(form, "click", "[data-chip]", (e, b) => { form.amount.value = b.dataset.chip; });
      const save = (monthly_limit) => api(`/api/cards/${card.id}`, { method: "PATCH", body: { monthly_limit } })
        .then(() => { close(); store.invalidate("cards"); refresh(); toast(monthly_limit ? "Limită actualizată" : "Limită eliminată"); });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", form), async () => {
          const amount = parseAmount(form.amount.value);
          if (!amount) {
            const box = $(".form-error", form);
            box.textContent = "Introdu o limită validă";
            box.hidden = false;
            return;
          }
          await save(amount);
        });
      });
      $("[data-remove]", form)?.addEventListener("click", (e) => busy(e.currentTarget, () => save(null)));
    },
  });
}

async function newCardFlow() {
  const accounts = await store.get("accounts");
  return openSheet({
    title: "Card virtual nou",
    body: html`<form class="form" novalidate>
      <p class="sheet-text">Gata de folosit imediat pentru plăți online. Îl poți îngheța sau închide oricând.</p>
      <label class="field"><span>Nume card</span><input name="label" value="Card virtual" maxlength="40" required></label>
      <label class="field"><span>Cont asociat</span><select name="account_id">
        ${accounts.map((a) => html`<option value="${a.id}">${a.name} · ${a.currency}</option>`)}</select></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Emite cardul</button></form>`,
    onMount(el, close) {
      const form = $("form", el);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", form), async () => {
          try {
            const card = await api("/api/cards", { method: "POST", body: { label: form.label.value.trim(), account_id: Number(form.account_id.value) } });
            try { localStorage.setItem(SELECTED_KEY, card.id); } catch { /* ignore */ }
            close();
            store.invalidate("cards");
            refresh();
            toast("Card emis");
          } catch (err) {
            const box = $(".form-error", form);
            box.textContent = err.message;
            box.hidden = false;
          }
        });
      });
    },
  });
}

function renameFlow(card) {
  return openSheet({
    title: "Redenumește cardul",
    body: html`<form class="form" novalidate><label class="field"><span>Nume</span>
      <input name="label" value="${card.label}" maxlength="40" required autofocus></label>
      <button class="btn primary block" type="submit">Salvează</button></form>`,
    onMount(el, close) {
      $("form", el).addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", el), async () => {
          await api(`/api/cards/${card.id}`, { method: "PATCH", body: { label: e.target.label.value.trim() } });
          close();
          store.invalidate("cards");
          refresh();
        });
      });
    },
  });
}

export async function render(el) {
  el.innerHTML = html`<div class="page">${skeleton(4)}</div>`;
  const [cards, accounts] = await Promise.all([store.get("cards"), store.get("accounts")]);

  if (!cards.length) {
    el.innerHTML = html`<div class="page">
      <header class="page-head"><h1>Carduri</h1></header>
      <div class="vcard placeholder">${icon("card", { size: 40 })}</div>
      ${emptyState("card", "Niciun card încă", "Emite un card virtual gratuit pentru cumpărături online – îl poți îngheța dintr-o atingere.",
        html`<button class="btn primary" data-new>Emite un card virtual</button>`)}
    </div>`;
    on(el, "click", "[data-new]", newCardFlow);
    return;
  }

  let saved;
  try { saved = Number(localStorage.getItem(SELECTED_KEY)); } catch { saved = 0; }
  let card = cards.find((c) => c.id === saved) || cards[0];

  el.innerHTML = html`<div class="page">
    <header class="page-head"><h1>Carduri</h1>
      <button class="icon-btn primary" data-new aria-label="Card nou">${icon("plus")}</button></header>
    <div class="carousel cards-carousel ${cards.length === 1 ? "single" : ""}" data-carousel>${cards.map(cardVisual)}</div>
    ${cards.length > 1 ? html`<div class="dots">${cards.map((c) => html`<button class="dot" data-dot="${c.id}" aria-label="${c.label}"></button>`)}</div>` : ""}
    <div data-card-body></div>
  </div>`;

  const body = $("[data-card-body]", el);
  const account = () => accounts.find((a) => a.id === card.account_id);

  async function showCard(c) {
    card = c;
    try { localStorage.setItem(SELECTED_KEY, c.id); } catch { /* ignore */ }
    $$("[data-dot]", el).forEach((d) => d.classList.toggle("active", Number(d.dataset.dot) === c.id));
    body.innerHTML = html`
      <div class="circle-actions">
        <button data-freeze><span class="circle ${c.frozen ? "on" : ""}">${icon("snow")}</span>${c.frozen ? "Dezgheață" : "Îngheață"}</button>
        <button data-details><span class="circle">${icon("eye")}</span>Detalii</button>
        <button data-limit><span class="circle">${icon("gauge")}</span>Limită</button>
        <button data-pay ${raw(c.frozen ? "disabled" : "")}><span class="circle">${icon("bag")}</span>Plată test</button>
      </div>
      ${limitMeter(c)}
      <p class="muted small center">Legat de ${account()?.name || "cont"} · ${money(account()?.balance ?? 0, c.currency)} disponibil</p>
      <section class="section">
        <div class="section-head"><h2>Plăți cu acest card</h2></div>
        <div class="card-list" data-txs>${skeleton(2)}</div>
      </section>
      <div class="list-actions boxed">
        <button class="list-action" data-rename><span class="la-icon">${icon("pencil")}</span><span>Redenumește cardul</span>${icon("chevronRight", { size: 18, cls: "muted" })}</button>
        <button class="list-action danger" data-close-card><span class="la-icon">${icon("trash")}</span><span>Închide cardul</span>${icon("chevronRight", { size: 18, cls: "muted" })}</button>
      </div>`;
    const txs = await api(`/api/cards/${c.id}/transactions?limit=20`);
    if (card.id !== c.id) return;
    const box = $("[data-txs]", body);
    if (txs.length) txList(box, txs, accounts);
    else box.innerHTML = emptyState("bag", "Nicio plată încă", "Încearcă „Plată test” ca să vezi cum funcționează.");
  }

  const carousel = $("[data-carousel]", el);
  carousel.addEventListener("scroll", () => requestAnimationFrame(() => {
    const step = carousel.firstElementChild.offsetWidth + 12;
    const c = cards[Math.max(0, Math.min(cards.length - 1, Math.round(carousel.scrollLeft / step)))];
    if (c.id !== card.id) showCard(c);
  }), { passive: true });
  const slideTo = (c, smooth) => {
    const node = $(`[data-card="${c.id}"]`, carousel);
    carousel.scrollTo({ left: node.offsetLeft - carousel.firstElementChild.offsetLeft, behavior: smooth ? "smooth" : "instant" });
  };
  on(el, "click", "[data-dot]", (e, d) => slideTo(cards.find((c) => c.id === Number(d.dataset.dot)), true));

  on(el, "click", "[data-new]", newCardFlow);
  on(body, "click", "[data-freeze]", (e, btn) => busy(btn, async () => {
    try {
      await api(`/api/cards/${card.id}`, { method: "PATCH", body: { frozen: !card.frozen } });
      toast(card.frozen ? "Card dezghețat" : "Card înghețat – plățile sunt blocate");
      store.invalidate("cards");
      refresh();
    } catch (err) { toast(err.message, { error: true }); }
  }));
  on(body, "click", "[data-details]", () => detailsFlow(card));
  on(body, "click", "[data-limit]", () => limitFlow(card));
  on(body, "click", "[data-pay]", () => cardPaymentFlow(card));
  on(body, "click", "[data-rename]", () => renameFlow(card));
  on(body, "click", "[data-close-card]", async () => {
    const ok = await confirmSheet({ title: "Închizi cardul?", danger: true, confirmLabel: "Închide cardul",
      message: `${card.label} •••• ${card.last4} nu va mai putea fi folosit. Acțiunea nu poate fi anulată.` });
    if (!ok) return;
    try {
      await api(`/api/cards/${card.id}`, { method: "DELETE" });
      store.invalidate("cards");
      toast("Card închis");
      refresh();
    } catch (err) { toast(err.message, { error: true }); }
  });

  slideTo(card, false);
  showCard(card);
}
