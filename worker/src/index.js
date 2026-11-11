// WeHold alert service (Cloudflare Worker, free plan).
//
// Phones sign up for anonymous topic channels: the service stores only a push token (from Apple or Google),
// the platform, and the topic ids the person follows. No name, email, location, officials or answers.
//
// Every hour it reads the public WeHold data (app.weholdllc.com), finds key votes and upcoming bills it hasn't
// announced yet, and sends a neutral notice to everyone following that topic. On Sunday it sends a short weekly
// briefing. Personal alerts (how *your* officials voted) stay inside the app, which is the only place that knows.

const MAX_TOPICS = 40;
const NEW_VOTE_DAYS = 3; // don't announce votes older than this (e.g. after a long outage)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/subscribe" && req.method === "POST") return await subscribe(req, env, cors);
      if (url.pathname === "/health") return json({ ok: true }, 200, cors);
      // Manual run for testing: POST /run with header x-admin-key (secret ADMIN_KEY).
      if (url.pathname === "/run" && req.method === "POST" && env.ADMIN_KEY && req.headers.get("x-admin-key") === env.ADMIN_KEY) {
        const kind = url.searchParams.get("kind") || "votes";
        return json(kind === "briefing" ? await sendBriefing(env) : await announce(env), 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: "server error" }, 500, cors);
    }
  },

  async scheduled(event, env, ctx) {
    // Sunday briefing cron is "0 14 * * SUN" (8 or 9am Central); everything else is the hourly vote check.
    if (event.cron === env.BRIEFING_CRON) ctx.waitUntil(sendBriefing(env));
    else ctx.waitUntil(announce(env));
  },
};

// ---------- sign-up ----------
function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "capacitor://localhost,https://localhost,ionic://localhost").split(",");
  return {
    "access-control-allow-origin": allowed.includes(origin) ? origin : allowed[0],
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });

export async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function subscribe(req, env, cors) {
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400, cors); }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const platform = body.platform;
  if (!token || token.length > 4096 || !/^[\w:\-.]+$/.test(token)) return json({ error: "bad token" }, 400, cors);
  if (platform !== "ios" && platform !== "android") return json({ error: "bad platform" }, 400, cors);
  const known = new Set((await loadTopics(env)).map((t) => t.id));
  const topics = [...new Set(Array.isArray(body.topics) ? body.topics : [])].filter((t) => typeof t === "string" && known.has(t)).slice(0, MAX_TOPICS);
  const id = await sha256(token);
  const db = env.DB;
  if (!topics.length) {
    await db.batch([db.prepare("DELETE FROM subs WHERE device = ?").bind(id), db.prepare("DELETE FROM devices WHERE id = ?").bind(id)]);
    return new Response(null, { status: 204, headers: cors });
  }
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO devices (id, token, platform, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, platform = excluded.platform, updated = excluded.updated").bind(id, token, platform, now),
    db.prepare("DELETE FROM subs WHERE device = ?").bind(id),
    ...topics.map((t) => db.prepare("INSERT INTO subs (device, topic) VALUES (?, ?)").bind(id, t)),
  ]);
  return new Response(null, { status: 204, headers: cors });
}

// ---------- public data ----------
async function getJSON(env, path) {
  const r = await fetch((env.DATA_BASE || "https://app.weholdllc.com/") + path, { cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
async function loadTopics(env) { return (await getJSON(env, "topics.json")).topics || []; }

// Same rule as the app: a vote belongs to a topic through its tags, or through a stance question it tests.
export function topicIndex(topicsDoc, stances, votesDoc) {
  const tag = {}, pt = {}, name = {};
  for (const t of topicsDoc) { name[t.id] = t.name; (t.tags || []).forEach((g) => (tag[g.toLowerCase()] = t.id)); (t.principleTopics || []).forEach((g) => (pt[g] = t.id)); }
  const PM = {}; (stances.principles || []).forEach((p) => (PM[p.id] = p));
  const qx = stances.questions || {};
  const qs = (votesDoc.questions || []).map((q) => ({ ...q, tests: q.tests || (qx[q.id] && qx[q.id].tests) || [], status: q.status || (qx[q.id] && qx[q.id].status) || "current" }));
  (stances.upcoming || []).forEach((q) => { if (!qs.some((y) => y.id === q.id)) qs.push({ status: "upcoming", tests: [], votes: [], ...q }); });
  const viaTests = (tests) => tests.map((t) => PM[t.p] && pt[PM[t.p].topic]).filter(Boolean);
  const ofVote = (v) => {
    const out = new Set();
    (v.tags || []).forEach((g) => { const id = tag[g.toLowerCase()]; if (id) out.add(id); });
    for (const q of qs) if ((q.votes || []).some((l) => l.vote === v.id)) viaTests(q.tests).forEach((t) => out.add(t));
    viaTests(v.tests || []).forEach((t) => out.add(t));
    return [...out];
  };
  const ofQuestion = (q) => {
    const out = new Set(viaTests(q.tests || []));
    (q.tags || []).forEach((g) => { const id = tag[g.toLowerCase()]; if (id) out.add(id); });
    return [...out];
  };
  return { ofVote, ofQuestion, name, questions: qs };
}

// Neutral wording only: what happened, never whether it's good.
export function voteMessage(v, topicName) {
  const q = v.q ? ` (${String(v.q).split(" · ")[0].toLowerCase()})` : "";
  return { title: topicName, body: `The ${v.ch} voted on ${v.title}${q}: ${v.result || (v.pass ? "passed" : "failed")}${v.tally ? `, ${v.tally}` : ""}.`, href: `#/vote/${v.id}` };
}
export function upcomingMessage(q, topicName) {
  const what = q.bill && q.bill.label ? q.bill.label : "A bill";
  return { title: `Coming up: ${topicName}`, body: `${q.expected ? q.expected + ": " : ""}${what}${q.sum ? ", " + q.sum : ""}`.slice(0, 230), href: "#/charter" };
}

async function getState(env, k, dflt) { const r = await env.DB.prepare("SELECT v FROM state WHERE k = ?").bind(k).first(); return r ? JSON.parse(r.v) : dflt; }
async function setState(env, k, v) { await env.DB.prepare("INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, JSON.stringify(v)).run(); }

export async function announce(env, now = new Date()) {
  const [topics, stances, votesDoc] = await Promise.all([loadTopics(env), getJSON(env, "stances.json"), getJSON(env, "data/votes.json")]);
  const ix = topicIndex(topics, stances, votesDoc);
  const seen = new Set(await getState(env, "seen", null) || []);
  const first = !(await getState(env, "seen", null));
  const today = now.toISOString().slice(0, 10);
  const age = (d) => (Date.parse(today) - Date.parse(d)) / 864e5;

  const jobs = []; // { key, topics, msg }
  for (const v of votesDoc.votes || []) {
    const key = "v:" + v.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (first || !v.date || age(v.date) > NEW_VOTE_DAYS) continue;
    const ts = ix.ofVote(v); if (ts.length) jobs.push({ key, topics: ts, msg: voteMessage(v, ix.name[ts[0]]) });
  }
  for (const q of ix.questions) {
    if (q.status !== "upcoming") continue;
    const key = `u:${q.id}:${q.expected || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (first) continue;
    const ts = ix.ofQuestion(q); if (ts.length) jobs.push({ key, topics: ts, msg: upcomingMessage(q, ix.name[ts[0]]) });
  }
  let sent = 0;
  for (const j of jobs) sent += await sendToTopics(env, j.topics, j.msg);
  await setState(env, "seen", [...seen]);
  return { first, notices: jobs.length, sent };
}

export async function sendBriefing(env, now = new Date()) {
  const recent = await getJSON(env, "data/recent.json").catch(() => []);
  const today = now.toISOString().slice(0, 10);
  const n = recent.filter((r) => r.date && (Date.parse(today) - Date.parse(r.date)) / 864e5 <= 7).length;
  const msg = { title: "Your weekly WeHold briefing", body: n ? `Congress held ${n} recorded vote${n === 1 ? "" : "s"} this week. See how your officials voted and what's coming up.` : "Congress held no recorded votes this week. See what's coming up.", href: "#/alerts" };
  const rows = (await env.DB.prepare("SELECT id, token, platform FROM devices").all()).results || [];
  return { sent: await deliver(env, rows, msg) };
}

async function sendToTopics(env, topics, msg) {
  const ph = topics.map(() => "?").join(",");
  const rows = (await env.DB.prepare(`SELECT DISTINCT d.id, d.token, d.platform FROM devices d JOIN subs s ON s.device = d.id WHERE s.topic IN (${ph})`).bind(...topics).all()).results || [];
  return deliver(env, rows, msg);
}

async function deliver(env, rows, msg) {
  let ok = 0; const gone = [];
  for (const r of rows) {
    try {
      const res = r.platform === "ios" ? await sendApns(env, r.token, msg) : await sendFcm(env, r.token, msg);
      if (res === "gone") gone.push(r.id); else if (res) ok++;
    } catch (e) { /* one bad send never stops the rest */ }
  }
  // Apple/Google say these tokens are dead (app deleted): forget them.
  for (const id of gone) await env.DB.batch([env.DB.prepare("DELETE FROM subs WHERE device = ?").bind(id), env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(id)]);
  return ok;
}

// ---------- Apple (APNs, token-based auth with a .p8 key) ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));
function pemBody(pem) { return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0)); }
let apnsJwt = null;
async function apnsToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt && now - apnsJwt.iat < 40 * 60) return apnsJwt.jwt; // Apple wants a new one at most hourly
  const key = await crypto.subtle.importKey("pkcs8", pemBody(env.APNS_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const data = b64urlStr(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID })) + "." + b64urlStr(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data));
  apnsJwt = { iat: now, jwt: data + "." + b64url(sig) };
  return apnsJwt.jwt;
}
async function sendApns(env, token, msg) {
  if (!env.APNS_KEY) return false;
  const host = env.APNS_ENV === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const r = await fetch(`${host}/3/device/${token}`, {
    method: "POST",
    headers: { authorization: "bearer " + (await apnsToken(env)), "apns-topic": env.APNS_BUNDLE_ID || "com.weholdllc.wehold", "apns-push-type": "alert", "apns-priority": "5", "content-type": "application/json" },
    body: JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default" }, href: msg.href }),
  });
  if (r.status === 410 || r.status === 400 && /BadDeviceToken|Unregistered/.test(await r.text())) return "gone";
  return r.ok;
}

// ---------- Google (Firebase Cloud Messaging HTTP v1, service-account auth) ----------
let fcmAuth = null;
async function fcmAccess(env) {
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  if (fcmAuth && fcmAuth.exp - now > 300) return { token: fcmAuth.token, project: sa.project_id };
  const key = await crypto.subtle.importKey("pkcs8", pemBody(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const data = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64urlStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + data + "." + b64url(sig) });
  const j = await r.json();
  fcmAuth = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return { token: fcmAuth.token, project: sa.project_id };
}
async function sendFcm(env, token, msg) {
  if (!env.FCM_SERVICE_ACCOUNT) return false;
  const a = await fcmAccess(env);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project}/messages:send`, {
    method: "POST", headers: { authorization: "Bearer " + a.token, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { href: msg.href }, android: { priority: "normal" } } }),
  });
  if (r.status === 404 || r.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(await r.text())) return "gone";
  return r.ok;
}
