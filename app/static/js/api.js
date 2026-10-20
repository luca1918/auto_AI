// API client, session handling and a small cache of the customer's data.

const TOKEN_KEY = "autobank.token";

// Storage can be unavailable (private browsing, blocked site data); the app then keeps the session in memory.
function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(value) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* memory only */ }
}

let token = readToken();
const listeners = new Set();

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const isLoggedIn = () => Boolean(token);
export const onLogout = (fn) => listeners.add(fn);

export function setToken(value) {
  token = value;
  writeToken(value);
}

export function logout(reason) {
  setToken(null);
  store.clear();
  listeners.forEach((fn) => fn(reason));
}

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

async function request(path, { method = "GET", body, idempotent = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  // One key per user action: if the network retries, the server won't move money twice.
  if (idempotent) headers["Idempotency-Key"] = newKey();

  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Fără conexiune la internet", 0);
  }
  if (res.status === 401 && token) {
    logout("Sesiunea a expirat. Autentifică-te din nou.");
    throw new ApiError("Sesiunea a expirat", 401);
  }
  return res;
}

export async function api(path, options) {
  const res = await request(path, options);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = Array.isArray(detail) ? detail.map((d) => d.msg.replace(/^Value error, /, "")).join("; ") : detail;
    throw new ApiError(message || "A apărut o eroare. Încearcă din nou.", res.status);
  }
  return data;
}

export async function download(path, fallbackName) {
  const res = await request(path);
  if (!res.ok) throw new ApiError("Descărcarea a eșuat", res.status);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- cached collections ----------
const ENDPOINTS = {
  me: "/api/auth/me",
  accounts: "/api/accounts",
  goals: "/api/goals",
  cards: "/api/cards",
  beneficiaries: "/api/beneficiaries",
};

const cache = new Map();

export const store = {
  get(name, { fresh = false } = {}) {
    if (fresh || !cache.has(name)) {
      const p = api(ENDPOINTS[name]).catch((e) => { cache.delete(name); throw e; });
      cache.set(name, p);
    }
    return cache.get(name);
  },
  invalidate(...names) { names.forEach((n) => cache.delete(n)); },
  clear() { cache.clear(); },
};
