import { createHmac, timingSafeEqual, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";

export const SESSION_COOKIE = "model_studio_session";
export const SESSION_SECONDS = 8 * 60 * 60;

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(secret, identity = { role: "admin" }, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...identity, exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString("base64url");
  return payload + "." + sign(payload, secret);
}

export async function readSession(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !secret || secret.length < 32) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isInteger(identity.exp) || identity.exp <= Math.floor(now / 1000)) return null;
    if (identity.role !== "admin" && (identity.role !== "client" || typeof identity.clientId !== "string")) return null;
    return identity;
  } catch { return null; }
}

export async function verifySession(token, secret, now = Date.now()) {
  return Boolean(await readSession(token, secret, now));
}

function sameSecret(received, expected) {
  if (typeof received !== "string" || !expected) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === String(host).split(",")[0].trim(); }
  catch { return false; }
}

function getCookie(request, name) {
  return (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1) || "";
}

export default async function authHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).json({ error: "Method not allowed." }); return; }
  if (!isSameOrigin(request)) { response.status(403).json({ error: "This request is not allowed." }); return; }

  const secret = process.env.MODEL_STUDIO_SESSION_SECRET;
  if (!secret || secret.length < 32) { response.status(503).json({ error: "Login is not configured on the server." }); return; }
  const action = request.body?.action;
  if (action === "logout") {
    response.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    response.status(200).json({ ok: true }); return;
  }
  if (action === "login") {
    const role = request.body?.role;
    const adminPassword = process.env.MODEL_STUDIO_PASSWORD;
    if (!adminPassword || adminPassword.length < 8 || !/[A-Za-z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
      response.status(503).json({ error: "Admin login is not configured. Set MODEL_STUDIO_PASSWORD." }); return;
    }
    let identity;
    if (role === "admin") {
      if (!sameSecret(request.body?.password, adminPassword)) { response.status(401).json({ error: "The account or password is incorrect." }); return; }
      identity = { role: "admin" };
    } else if (role === "client") {
      let accounts;
      try { accounts = await loadClients(); }
      catch (error) { response.status(503).json({ error: error.message }); return; }
      const clientId = normalizeClientId(request.body?.clientId);
      const account = accounts.find((client) => (client.clientId || client.email || "").toLowerCase() === clientId && client.active !== false);
      const valid = account && await verifyPassword(request.body?.password, account.salt, account.passwordHash);
      if (!valid) { response.status(401).json({ error: "The account or password is incorrect." }); return; }
      identity = { role: "client", clientId: account.clientId || account.email || account.id, accountId: account.id, name: account.name };
    } else { response.status(400).json({ error: "Choose an account type." }); return; }
    const token = createSession(secret, identity);
    response.setHeader("Set-Cookie", SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS);
    response.status(200).json({ ok: true, role: identity.role }); return;
  }

  const session = await readSession(getCookie(request, SESSION_COOKIE), secret);
  if (!session) { response.status(401).json({ error: "Sign in to continue." }); return; }
  if (action === "session") { response.status(200).json({ role: session.role, name: session.name || "" }); return; }
  if (session.role !== "admin") { response.status(403).json({ error: "Admin access is required." }); return; }

  try {
    const clients = await loadClients();
    const body = request.body || {};
    if (action === "list-clients") { response.status(200).json({ clients: clients.map(publicClient) }); return; }
    if (action === "add-client") {
      const name = cleanName(body.name);
      const clientId = normalizeClientId(body.clientId);
      validateClient(name, clientId, body.password);
      if (clients.some((client) => (client.clientId || client.email || "").toLowerCase() === clientId)) { response.status(409).json({ error: "That client ID is already in use." }); return; }
      const password = await hashPassword(body.password);
      const client = { id: randomUUID(), clientId, name, ...password, createdAt: new Date().toISOString() };
      clients.push(client); await saveClients(clients);
      response.status(201).json({ client: publicClient(client) }); return;
    }
    if (action === "update-client") {
      const index = clients.findIndex((client) => client.id === body.id);
      if (index < 0) { response.status(404).json({ error: "Client not found." }); return; }
      const name = cleanName(body.name);
      const clientId = normalizeClientId(body.clientId);
      validateClient(name, clientId, body.password, true);
      if (clients.some((client, i) => i !== index && (client.clientId || client.email || "").toLowerCase() === clientId)) { response.status(409).json({ error: "That client ID is already in use." }); return; }
      clients[index] = { ...clients[index], name, clientId };
      if (body.password) Object.assign(clients[index], await hashPassword(body.password));
      await saveClients(clients); response.status(200).json({ client: publicClient(clients[index]) }); return;
    }
    if (action === "delete-client") {
      const remaining = clients.filter((client) => client.id !== body.id);
      if (remaining.length === clients.length) { response.status(404).json({ error: "Client not found." }); return; }
      await saveClients(remaining); response.status(200).json({ ok: true }); return;
    }
    response.status(400).json({ error: "Unknown action." });
  } catch (error) { response.status(error.status || 503).json({ error: error.message || "Client account storage is unavailable." }); }
}

function getStoreConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Client account storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  return { url: url.replace(/\/$/, ""), token };
}
async function redisCommand(command) {
  const { url, token } = getStoreConfig();
  const response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(command) });
  if (!response.ok) throw new Error("Could not access client account storage.");
  const result = await response.json();
  if (result.error) throw new Error("Could not access client account storage.");
  return result.result;
}
async function loadClients() { const result = await redisCommand(["GET", "model-studio:clients"]); if (!result) return []; const clients = JSON.parse(result); if (!Array.isArray(clients)) throw new Error("Client account storage contains invalid data."); return clients; }
async function saveClients(clients) { await redisCommand(["SET", "model-studio:clients", JSON.stringify(clients)]); }
function normalizeClientId(value) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function cleanName(name) { return typeof name === "string" ? name.trim().slice(0, 100) : ""; }
function validateClient(name, clientId, password, optionalPassword = false) {
  if (!name) throw Object.assign(new Error("Enter the client name."), { status: 400 });
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(clientId)) throw Object.assign(new Error("Client IDs must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens."), { status: 400 });
  if ((!optionalPassword || password) && (typeof password !== "string" || password.length < 8)) throw Object.assign(new Error("Client passwords must be at least 8 characters."), { status: 400 });
}
async function hashPassword(password) { const salt = randomBytes(16).toString("base64url"); const hash = await scrypt(password, salt); return { salt, passwordHash: hash.toString("base64url") }; }
async function verifyPassword(password, salt, expected) { if (typeof password !== "string" || typeof salt !== "string" || typeof expected !== "string") return false; const actual = await scrypt(password, salt); const wanted = Buffer.from(expected, "base64url"); return actual.length === wanted.length && timingSafeEqual(actual, wanted); }
function scrypt(password, salt) { return new Promise((resolve, reject) => scryptCallback(password, salt, 64, (error, key) => error ? reject(error) : resolve(key))); }
function publicClient({ id, clientId, email, name, createdAt }) { return { id, clientId: clientId || email || id, name, createdAt }; }
