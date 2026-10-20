import { isLoggedIn, onLogout } from "./api.js";
import { closeAllSheets, emptyState, html, icon, toast } from "./ui.js";
import * as accounts from "./views/accounts.js";
import * as auth from "./views/auth.js";
import * as cards from "./views/cards.js";
import * as home from "./views/home.js";
import * as payments from "./views/payments.js";
import * as profile from "./views/profile.js";
import * as savings from "./views/savings.js";
import * as search from "./views/search.js";
import * as stats from "./views/stats.js";

const routes = [
  { path: "/welcome", view: auth.welcome, public: true },
  { path: "/login", view: auth.login, public: true },
  { path: "/register", view: auth.register, public: true },
  { path: "/", view: home.render, tab: "home" },
  { path: "/payments", view: payments.render, tab: "payments" },
  { path: "/cards", view: cards.render, tab: "cards" },
  { path: "/savings", view: savings.render, tab: "savings" },
  { path: "/savings/:id", view: savings.renderGoal, tab: "savings" },
  { path: "/stats", view: stats.render, tab: "stats" },
  { path: "/accounts", view: accounts.renderList },
  { path: "/account/:id", view: accounts.renderAccount },
  { path: "/search", view: search.render },
  { path: "/profile", view: profile.render },
];

const TABS = [
  ["home", "#/", "home", "Acasă"],
  ["payments", "#/payments", "arrows", "Plăți"],
  ["cards", "#/cards", "card", "Carduri"],
  ["savings", "#/savings", "piggy", "Economii"],
  ["stats", "#/stats", "chart", "Statistici"],
];

const tabbar = document.getElementById("tabbar");
tabbar.innerHTML = html`${TABS.map(([key, href, ic, label]) => html`
  <a href="${href}" data-tab="${key}">${icon(ic, { size: 24 })}<span>${label}</span></a>`)}`;

function match(path) {
  const parts = path.split("/").filter(Boolean);
  for (const route of routes) {
    const rparts = route.path.split("/").filter(Boolean);
    if (rparts.length !== parts.length) continue;
    const params = {};
    if (rparts.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) {
      return { route, params };
    }
  }
  return null;
}

let renderSeq = 0;

async function render({ keepScroll = false } = {}) {
  const [rawPath, qs = ""] = (location.hash.slice(1) || "/").split("?");
  const found = match(rawPath) || match("/");
  const { route, params } = found;

  if (!route.public && !isLoggedIn()) { location.replace("#/welcome"); return; }
  if (route.public && isLoggedIn()) { location.replace("#/"); return; }

  const seq = ++renderSeq;
  const scrollY = window.scrollY;
  if (!keepScroll) closeAllSheets();

  tabbar.hidden = !route.tab;
  tabbar.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === route.tab));

  // A fresh container per render drops the previous view's listeners. On a data refresh the new
  // version is built invisibly next to the old one and swapped in when ready, so nothing flashes.
  const old = document.getElementById("view");
  const el = document.createElement("main");
  el.className = keepScroll ? "view staging" : "view enter";
  if (keepScroll) {
    old.after(el);
  } else {
    old.dispatchEvent(new Event("autobank:unmount"));
    el.id = "view";
    old.replaceWith(el);
    window.scrollTo(0, 0);
  }

  try {
    await route.view(el, params, new URLSearchParams(qs));
    if (keepScroll) {
      if (seq !== renderSeq) { el.remove(); return; }
      old.dispatchEvent(new Event("autobank:unmount"));
      old.remove();
      el.id = "view";
      el.classList.remove("staging");
      window.scrollTo(0, scrollY);
    }
  } catch (err) {
    if (keepScroll) { el.remove(); if (err.status !== 401) toast(err.message, { error: true }); return; }
    if (seq !== renderSeq || err.status === 401) return;
    console.error(err);
    el.innerHTML = html`<div class="page">${emptyState("alert", "Nu am putut încărca pagina", err.message,
      html`<button class="btn secondary" data-retry>Încearcă din nou</button>`)}</div>`;
    el.querySelector("[data-retry]").addEventListener("click", () => render());
  }
}

window.addEventListener("hashchange", () => render());
window.addEventListener("autobank:refresh", () => render({ keepScroll: true }));
onLogout((reason) => {
  closeAllSheets();
  if (reason) toast(reason, { error: true });
  location.hash = "#/welcome";
});
window.addEventListener("offline", () => toast("Ești offline. Unele acțiuni nu sunt disponibile.", { error: true }));
window.addEventListener("online", () => toast("Conexiune restabilită"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

render();
