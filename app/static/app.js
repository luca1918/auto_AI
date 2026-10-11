const state = { token: sessionStorage.getItem("token"), accounts: [], selectedId: null, op: "transfer" };
const $ = (sel) => document.querySelector(sel);

const KIND_LABEL = { deposit: "Depunere", withdrawal: "Retragere", transfer_in: "Transfer primit", transfer_out: "Transfer trimis" };

function fmt(amount, currency) {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(Number(amount));
}

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && state.token) logout();
  if (!res.ok) {
    const detail = data?.detail;
    throw new Error(Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : detail || "Eroare");
  }
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setTabs(container, attr, value) {
  container.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset[attr] === value));
}

// ---------- auth ----------
document.querySelectorAll("[data-tab]").forEach((btn) =>
  btn.addEventListener("click", () => {
    setTabs(btn.parentElement, "tab", btn.dataset.tab);
    $("#login-form").hidden = btn.dataset.tab !== "login";
    $("#register-form").hidden = btn.dataset.tab !== "register";
  })
);

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { access_token } = await api("/api/auth/login", { method: "POST", body: formData(e.target) });
    state.token = access_token;
    sessionStorage.setItem("token", access_token);
    e.target.reset();
    await showApp();
  } catch (err) { toast(err.message, true); }
});

$("#register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  try {
    await api("/api/auth/register", { method: "POST", body });
    const { access_token } = await api("/api/auth/login", { method: "POST", body: { email: body.email, password: body.password } });
    state.token = access_token;
    sessionStorage.setItem("token", access_token);
    e.target.reset();
    toast("Cont creat. Bine ai venit!");
    await showApp();
  } catch (err) { toast(err.message, true); }
});

function logout() {
  state.token = null;
  state.selectedId = null;
  sessionStorage.removeItem("token");
  $("#app-view").hidden = true;
  $("#user-box").hidden = true;
  $("#auth-view").hidden = false;
}
$("#logout").addEventListener("click", logout);

// ---------- accounts ----------
async function showApp() {
  const me = await api("/api/auth/me");
  $("#user-name").textContent = me.full_name;
  $("#user-box").hidden = false;
  $("#auth-view").hidden = true;
  $("#app-view").hidden = false;
  await loadAccounts();
}

async function loadAccounts() {
  state.accounts = await api("/api/accounts");
  if (!state.accounts.some((a) => a.id === state.selectedId)) state.selectedId = state.accounts[0]?.id ?? null;
  renderAccounts();
  await renderDetail();
}

function renderAccounts() {
  const box = $("#accounts");
  box.replaceChildren(...state.accounts.map((a) => {
    const btn = document.createElement("button");
    btn.className = "account" + (a.id === state.selectedId ? " selected" : "");
    btn.innerHTML = `<div class="name"></div><div class="amt"></div><div class="sub"></div>`;
    btn.querySelector(".name").textContent = a.name;
    btn.querySelector(".amt").textContent = fmt(a.balance, a.currency);
    btn.querySelector(".sub").textContent = a.iban;
    btn.addEventListener("click", () => { state.selectedId = a.id; renderAccounts(); renderDetail(); });
    return btn;
  }));
}

async function renderDetail() {
  const acc = state.accounts.find((a) => a.id === state.selectedId);
  $("#account-detail").hidden = !acc;
  if (!acc) return;
  $("#detail-title").textContent = `${acc.name} · ${acc.currency}`;
  $("#detail-iban").textContent = acc.iban;
  $("#detail-balance").textContent = fmt(acc.balance, acc.currency);

  const txs = await api(`/api/accounts/${acc.id}/transactions`);
  const list = $("#transactions");
  if (!txs.length) {
    list.innerHTML = `<li class="empty">Nicio tranzacție încă.</li>`;
    return;
  }
  list.replaceChildren(...txs.map((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><div class="desc"></div><div class="meta"></div></div><div class="amt"></div>`;
    li.querySelector(".desc").textContent = t.description || KIND_LABEL[t.kind];
    const when = new Date(t.created_at).toLocaleString("ro-RO");
    li.querySelector(".meta").textContent = [KIND_LABEL[t.kind], t.counterparty_iban, when].filter(Boolean).join(" · ");
    const amt = li.querySelector(".amt");
    amt.textContent = (Number(t.amount) > 0 ? "+" : "") + fmt(t.amount, acc.currency);
    amt.className = "amt " + (Number(t.amount) > 0 ? "pos" : "neg");
    return li;
  }));
}

$("#new-account-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const acc = await api("/api/accounts", { method: "POST", body: formData(e.target) });
    state.selectedId = acc.id;
    toast(`Cont deschis: ${acc.iban}`);
    await loadAccounts();
  } catch (err) { toast(err.message, true); }
});

$("#copy-iban").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#detail-iban").textContent);
    toast("IBAN copiat");
  } catch { toast("Nu am putut copia", true); }
});

// ---------- operations ----------
function setOp(op) {
  state.op = op;
  setTabs($("[data-op]").parentElement, "op", op);
  document.querySelectorAll("[data-only]").forEach((el) => {
    el.hidden = el.dataset.only !== op;
    el.querySelector("input").required = !el.hidden;
  });
  $("#op-submit").textContent = { transfer: "Trimite", deposit: "Depune", withdraw: "Retrage" }[op];
}
document.querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => setOp(b.dataset.op)));

$("#op-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { amount, description, to_iban } = formData(e.target);
  const id = state.selectedId;
  try {
    if (state.op === "transfer") {
      await api("/api/transfers", { method: "POST", body: { from_account_id: id, to_iban, amount, description } });
    } else {
      await api(`/api/accounts/${id}/${state.op}`, { method: "POST", body: { amount, description } });
    }
    toast("Operațiune efectuată");
    e.target.reset();
    await loadAccounts();
  } catch (err) { toast(err.message, true); }
});

setOp("transfer");
if (state.token) showApp().catch(logout);
