import { api, setToken, store } from "../api.js";
import { $, busy, html, icon, logoMark, raw } from "../ui.js";

export function welcome(el) {
  el.innerHTML = html`<div class="auth welcome">
    <div class="welcome-art">
      ${logoMark(76)}
      <h1>AutoBank</h1>
      <p>Banii tăi, la locul lor. Conturi, carduri virtuale și pușculițe — toate într-o singură aplicație.</p>
    </div>
    <ul class="welcome-points">
      <li>${icon("piggy")} Pușculițe cu rotunjire automată</li>
      <li>${icon("card")} Carduri virtuale pe care le poți îngheța oricând</li>
      <li>${icon("chart")} Statistici pe categorii de cheltuieli</li>
    </ul>
    <div class="stack-btns">
      <a class="btn primary" href="#/register">Deschide un cont</a>
      <a class="btn secondary" href="#/login">Am deja cont</a>
    </div>
  </div>`;
}

function passwordField(name, label, autocomplete) {
  return html`<label class="field"><span>${label}</span><span class="pw">
    <input name="${name}" type="password" required minlength="${name === "password" && autocomplete === "new-password" ? 8 : 1}" autocomplete="${autocomplete}">
    <button type="button" class="icon-btn ghost" data-reveal aria-label="Arată parola">${icon("eye", { size: 20 })}</button></span></label>`;
}

function bindReveal(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reveal]");
    if (!btn) return;
    const input = btn.previousElementSibling;
    input.type = input.type === "password" ? "text" : "password";
    btn.innerHTML = icon(input.type === "password" ? "eye" : "eyeOff", { size: 20 });
  });
}

async function signIn(email, password) {
  const { access_token } = await api("/api/auth/login", { method: "POST", body: { email, password } });
  setToken(access_token);
  store.clear();
  location.hash = "#/";
}

function authLayout(title, subtitle, form) {
  return html`<div class="auth">
    <a class="icon-btn" href="#/welcome" aria-label="Înapoi">${icon("back")}</a>
    <div class="auth-head">${logoMark(48)}<h1>${title}</h1><p class="muted">${subtitle}</p></div>
    ${form}</div>`;
}

export function login(el) {
  el.innerHTML = authLayout("Bine ai revenit", "Intră în contul tău AutoBank.", html`
    <form class="form" novalidate>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" inputmode="email" autofocus></label>
      ${passwordField("password", "Parolă", "current-password")}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Intră în cont</button>
      <p class="center muted small">Nu ai cont? <a href="#/register">Deschide unul acum</a></p>
    </form>`);
  const form = $("form", el);
  bindReveal(form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("[type=submit]", form), async () => {
      try {
        await signIn(form.email.value.trim(), form.password.value);
      } catch (err) {
        const box = $(".form-error", form);
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  });
}

export function register(el) {
  el.innerHTML = authLayout("Cont nou", "Durează mai puțin de un minut.", html`
    <form class="form" novalidate>
      <label class="field"><span>Nume complet</span><input name="full_name" required minlength="2" autocomplete="name" autofocus></label>
      <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" inputmode="email"></label>
      ${passwordField("password", "Parolă (minim 8 caractere)", "new-password")}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">Creează contul</button>
      <p class="center muted small">${raw("Ai deja cont? <a href=\"#/login\">Intră</a>")}</p>
    </form>`);
  const form = $("form", el);
  bindReveal(form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const box = $(".form-error", form);
    busy($("[type=submit]", form), async () => {
      try {
        if (form.password.value.length < 8) throw new Error("Parola trebuie să aibă cel puțin 8 caractere");
        const body = { full_name: form.full_name.value.trim(), email: form.email.value.trim(), password: form.password.value };
        await api("/api/auth/register", { method: "POST", body });
        await signIn(body.email, body.password);
      } catch (err) {
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  });
}
