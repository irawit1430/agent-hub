const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// Set HUB_SECRET to lock the hub. All requests must present it
// (header "x-hub-secret", body "secret", or query "?secret=").
const HUB_SECRET = process.env.HUB_SECRET || "";

app.use((req, res, next) => {
  if (!HUB_SECRET) return next();
  const given =
    req.get("x-hub-secret") ||
    (req.body && req.body.secret) ||
    req.query.secret ||
    "";
  // timing-safe compare so response time can't leak the secret
  const a = Buffer.from(String(given));
  const b = Buffer.from(HUB_SECRET);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    if (req.body) delete req.body.secret;
    return next();
  }
  return res.status(401).json({ error: "invalid or missing hub secret" });
});
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_INBOX = 200;
const HISTORY_LIMIT = 500;

// name -> { token, lastSeen, inbox: [] }
const agents = new Map();
// shared room history: { id, from, to, text, ts }
const history = [];

function isOnline(a) {
  return a && Date.now() - a.lastSeen < HEARTBEAT_TIMEOUT_MS;
}

function auth(name, token) {
  const a = agents.get(name);
  return a && a.token === token ? a : null;
}

function touch(a) {
  a.lastSeen = Date.now();
}

function pushHistory(msg) {
  history.push(msg);
  if (history.length > HISTORY_LIMIT) history.shift();
}

// ---------- register ----------
app.post("/register", (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_-]{2,32}$/.test(name)) {
    return res.status(400).json({
      error: "name required: 2-32 chars, letters/numbers/_/- only",
    });
  }
  const existing = agents.get(name);
  if (existing && isOnline(existing)) {
    return res.status(409).json({ error: `name "${name}" already taken by an online agent` });
  }
  const token = crypto.randomBytes(16).toString("hex");
  agents.set(name, { token, lastSeen: Date.now(), inbox: [] });
  pushHistory({ id: crypto.randomUUID(), from: "hub", to: "*", text: `${name} joined the hub`, ts: Date.now() });
  console.log(`[+] ${name} registered`);
  res.json({ ok: true, name, token, hint: "Send this token with every request. POST /send to message others, GET /inbox to receive." });
});

// ---------- heartbeat / presence ----------
app.post("/heartbeat", (req, res) => {
  const { name, token } = req.body || {};
  const a = auth(name, token);
  if (!a) return res.status(401).json({ error: "unknown agent or bad token" });
  touch(a);
  res.json({ ok: true });
});

app.get("/agents", (_req, res) => {
  const now = Date.now();
  const list = [...agents.entries()].map(([name, a]) => ({
    name,
    online: now - a.lastSeen < HEARTBEAT_TIMEOUT_MS,
    lastSeenAgoSec: Math.round((now - a.lastSeen) / 1000),
    pendingMessages: a.inbox.length,
  }));
  res.json({ agents: list });
});

// ---------- send ----------
app.post("/send", (req, res) => {
  const { from, token, to, text } = req.body || {};
  const sender = auth(from, token);
  if (!sender) return res.status(401).json({ error: "unknown agent or bad token" });
  touch(sender);
  if (!text || typeof text !== "string") return res.status(400).json({ error: "text required" });

  const msg = {
    id: crypto.randomUUID(),
    from,
    to: to || "*",
    text: String(text).slice(0, 8000),
    ts: Date.now(),
  };

  if (!to || to === "*") {
    for (const [name, a] of agents) {
      if (name !== from && isOnline(a)) {
        a.inbox.push(msg);
        if (a.inbox.length > MAX_INBOX) a.inbox.shift();
      }
    }
  } else {
    const target = agents.get(to);
    if (!target) return res.status(404).json({ error: `agent "${to}" not found` });
    target.inbox.push(msg);
    if (target.inbox.length > MAX_INBOX) target.inbox.shift();
  }

  pushHistory(msg);
  console.log(`[${from}] -> [${msg.to}]: ${msg.text.slice(0, 80)}`);
  res.json({ ok: true, id: msg.id });
});

// ---------- receive (long-poll) ----------
app.get("/inbox/:name", async (req, res) => {
  const { name } = req.params;
  const { token, wait } = req.query;
  const a = auth(name, token);
  if (!a) return res.status(401).json({ error: "unknown agent or bad token" });

  const waitMs = Math.min(parseInt(wait) || 0, 25000);
  const deadline = Date.now() + waitMs;

  while (a.inbox.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  touch(a);
  const messages = a.inbox.splice(0, a.inbox.length);
  res.json({ messages });
});

// ---------- recent history (context for newcomers) ----------
app.get("/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, HISTORY_LIMIT);
  res.json({ history: history.slice(-limit) });
});

app.get("/", (_req, res) => {
  res.json({
    service: "agent-hub",
    endpoints: {
      "POST /register": "{name}",
      "POST /heartbeat": "{name,token}",
      "GET  /agents": "list agents + online status",
      "POST /send": "{from,token,to,text}  (to omitted or '*' = broadcast)",
      "GET  /inbox/:name?token=..&wait=25": "long-poll up to 25s",
      "GET  /history?limit=50": "recent room history",
    },
  });
});

setInterval(() => {
  for (const [name, a] of agents) {
    if (!isOnline(a)) agents.delete(name);
  }
}, 60 * 1000);

app.listen(PORT, () => console.log(`agent-hub listening on :${PORT}`));
