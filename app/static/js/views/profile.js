import { api, logout, store } from "../api.js";
import { $, busy, html, icon, initials, logoMark, monthName, on, openSheet, toast } from "../ui.js";

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });

function changePasswordFlow() {
  return openSheet({
    title: "Schimbă parola",
    body: html`<form class="form" novalidate>
      <label class="field"><span>Parola curentă</span><input name="current" type="password" autocomplete="current-password" required autofocus></label>
      <label class="field"><span>Parola nouă (minim 8 caractere)</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Schimbă parola</button></form>`,
    onMount(el, close) {
      const form = $("form", el);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($("[type=submit]", form), async () => {
          try {
            if (form.next.value.length < 8) throw new Error("Parola nouă trebuie să aibă cel puțin 8 caractere");
            await api("/api/auth/change-password", { method: "POST", body: { current_password: form.current.value, new_password: form.next.value } });
            close();
            toast("Parola a fost schimbată");
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

function installFlow() {
  if (deferredInstall) {
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(() => { deferredInstall = null; });
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openSheet({
    title: "Instalează AutoBank",
    body: html`<ol class="steps">
      ${ios ? html`<li>Deschide pagina în <b>Safari</b>.</li><li>Atinge butonul ${icon("share", { size: 18 })} <b>Partajează</b>.</li><li>Alege <b>Adaugă pe ecranul principal</b>.</li>`
        : html`<li>Deschide meniul browserului (⋮).</li><li>Alege <b>Instalează aplicația</b> sau <b>Adaugă pe ecranul de pornire</b>.</li>`}
    </ol><p class="muted small">Aplicația se va deschide pe tot ecranul, fără bara browserului.</p>`,
  });
}

function aboutSheet() {
  openSheet({
    title: "Despre AutoBank",
    body: html`<div class="about">${logoMark(56)}<p><b>AutoBank 0.3</b></p>
      <p class="muted">Aplicație bancară demonstrativă. Depunerile, cardurile și plățile sunt simulate – nu se folosesc bani reali.</p></div>`,
  });
}

export async function render(el) {
  const me = await store.get("me");
  const since = new Date(me.created_at);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const items = [
    ["wallet", "Conturile mele", "#/accounts"],
    ["users", "Beneficiari", "#/payments"],
    ["chart", "Statistici", "#/stats"],
    ["lock", "Schimbă parola", "password"],
    ...(standalone ? [] : [["phone", "Instalează aplicația", "install"]]),
    ["info", "Despre AutoBank", "about"],
  ];
  el.innerHTML = html`<div class="page">
    <header class="page-head"><a class="icon-btn" href="#/" aria-label="Înapoi">${icon("back")}</a><h1 class="center-title">Profil</h1><span></span></header>
    <section class="profile-hero">
      <span class="avatar xl">${initials(me.full_name)}</span>
      <h2>${me.full_name}</h2>
      <p class="muted">${me.email}</p>
      <span class="badge">Client din ${monthName(since.getMonth() + 1)} ${since.getFullYear()}</span>
    </section>
    <div class="list-actions boxed">${items.map(([ic, label, target]) => target.startsWith("#")
      ? html`<a class="list-action" href="${target}"><span class="la-icon">${icon(ic)}</span><span>${label}</span>${icon("chevronRight", { size: 18, cls: "muted" })}</a>`
      : html`<button class="list-action" data-do="${target}"><span class="la-icon">${icon(ic)}</span><span>${label}</span>${icon("chevronRight", { size: 18, cls: "muted" })}</button>`)}
    </div>
    <button class="btn danger-ghost block" data-logout>${icon("logout", { size: 18 })} Ieșire din cont</button>
  </div>`;
  on(el, "click", "[data-do=password]", changePasswordFlow);
  on(el, "click", "[data-do=install]", installFlow);
  on(el, "click", "[data-do=about]", aboutSheet);
  on(el, "click", "[data-logout]", () => logout());
}
