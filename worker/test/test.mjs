// Tests for the alert service, run with Node (no Cloudflare account needed).
// D1 is stood in for by Node's built-in SQLite; network calls are faked.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { webcrypto, generateKeyPairSync } from "node:crypto";
import worker, { announce, sendBriefing, topicIndex, voteMessage, sha256 } from "../src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = new URL("../../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

// --- D1 stand-in ---
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); }, raw: db };
}

// --- fake network: WeHold data from the repo, Apple/Google push endpoints recorded ---
let votesDoc = read("site/data/votes.json");
const files = { "topics.json": read("site/topics.json"), "stances.json": read("site/stances.json"), "data/recent.json": read("site/data/recent.json") };
const sent = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://app.weholdllc.com/")) {
    const p = u.slice("https://app.weholdllc.com/".length);
    return new Response(JSON.stringify(p === "data/votes.json" ? votesDoc : files[p]), { status: 200 });
  }
  if (u.startsWith("https://api.push.apple.com/3/device/")) { sent.push({ to: "apple", token: u.split("/").pop(), headers: opts.headers, body: JSON.parse(opts.body) }); return new Response("", { status: u.endsWith("deadtoken") ? 410 : 200 }); }
  if (u === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }));
  if (u.startsWith("https://fcm.googleapis.com/")) { sent.push({ to: "google", body: JSON.parse(opts.body) }); return new Response("{}", { status: 200 }); }
  throw new Error("unexpected fetch " + u);
};

// Real keys in the formats Apple and Google issue, so the signing code is exercised for real.
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  DB: d1(), DATA_BASE: "https://app.weholdllc.com/", BRIEFING_CRON: "0 14 * * SUN", APNS_BUNDLE_ID: "com.weholdllc.wehold",
  APNS_KEY: ec.privateKey.export({ type: "pkcs8", format: "pem" }), APNS_KEY_ID: "ABC123", APNS_TEAM_ID: "TEAM123",
  FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "wehold-test", client_email: "push@wehold-test.iam.gserviceaccount.com", private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }) }),
};
const post = (path, body, origin = "capacitor://localhost") => worker.fetch(new Request("https://push.example" + path, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }), env);

let pass = 0;
async function test(name, fn) { await fn(); pass++; console.log("ok", name); }

await test("topic index matches the app's rules", async () => {
  const ix = topicIndex(files["topics.json"].topics, files["stances.json"], votesDoc);
  const v = votesDoc.votes.find((x) => x.id === "S-119-2-258");
  assert.deepEqual(ix.ofVote(v), ["energy"]);
  assert.ok(votesDoc.votes.every((x) => ix.ofVote(x).length > 0), "every key vote maps to a topic");
  assert.match(voteMessage(v, "Energy & environment").body, /^The Senate voted on .*: Motion to Proceed Agreed to, 62–21\.$/);
});

await test("sign-up validates input and stores only token, platform, topics", async () => {
  assert.equal((await post("/subscribe", { token: "x y", platform: "ios", topics: ["energy"] })).status, 400);
  assert.equal((await post("/subscribe", { token: "abc", platform: "windows", topics: ["energy"] })).status, 400);
  const r = await post("/subscribe", { token: "iphonetoken1", platform: "ios", topics: ["energy", "not-a-topic", "farming"], name: "ignored" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "capacitor://localhost");
  await post("/subscribe", { token: "androidtoken1", platform: "android", topics: ["guns"] });
  await post("/subscribe", { token: "deadtoken", platform: "ios", topics: ["energy"] });
  const subs = env.DB.raw.prepare("SELECT topic FROM subs WHERE device = ?").all(await sha256("iphonetoken1")).map((x) => x.topic).sort();
  assert.deepEqual(subs, ["energy", "farming"]);
  assert.deepEqual(Object.keys(env.DB.raw.prepare("SELECT * FROM devices LIMIT 1").get()).sort(), ["id", "platform", "token", "updated"]);
});

await test("first run only remembers existing votes (no blast)", async () => {
  const r = await announce(env, new Date("2026-11-11T15:00:00Z"));
  assert.equal(r.first, true); assert.equal(sent.length, 0);
});

await test("a new energy vote goes only to energy followers; dead tokens are removed", async () => {
  votesDoc = structuredClone(votesDoc);
  votesDoc.votes.unshift({ id: "S-119-2-262", ch: "Senate", date: "2026-11-12", title: "Energy & permitting package (H.R. 2347)", q: "On passage of the bill", result: "Bill Passed", tally: "68–30", tags: ["Energy"], pos: {} });
  const r = await announce(env, new Date("2026-11-12T20:00:00Z"));
  assert.equal(r.notices, 1);
  assert.equal(sent.filter((s) => s.to === "apple").length, 2); // iphonetoken1 + deadtoken
  assert.equal(sent.filter((s) => s.to === "google").length, 0); // android device follows guns only
  const a = sent.find((s) => s.token === "iphonetoken1");
  assert.equal(a.headers["apns-topic"], "com.weholdllc.wehold");
  assert.equal(a.body.href, "#/vote/S-119-2-262");
  assert.match(a.body.aps.alert.body, /voted on Energy & permitting package .*\(on passage of the bill\): Bill Passed, 68–30\./);
  const [h, p, s] = a.headers.authorization.slice(7).split(".");
  assert.equal(JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/"))).kid, "ABC123");
  assert.ok(s.length > 80, "ES256 signature present");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM devices WHERE id = ?").get(await sha256("deadtoken")).n, 0);
  sent.length = 0;
  assert.equal((await announce(env, new Date("2026-11-12T21:00:00Z"))).notices, 0, "never announced twice");
});

await test("a guns vote reaches the Android follower through Firebase", async () => {
  votesDoc.votes.unshift({ id: "H-119-2-330", ch: "House", date: "2026-11-13", title: "Concealed carry reciprocity (H.R. 38)", q: "On passage", result: "Passed", tally: "220–210", tags: ["Guns"], pos: {} });
  await announce(env, new Date("2026-11-13T20:00:00Z"));
  const g = sent.find((s) => s.to === "google");
  assert.equal(g.body.message.token, "androidtoken1");
  assert.equal(g.body.message.data.href, "#/vote/H-119-2-330");
  sent.length = 0;
});

await test("upcoming bills are announced once to followers of their topic", async () => {
  files["stances.json"] = structuredClone(files["stances.json"]);
  const p = files["stances.json"].principles.find((x) => x.topic === "Energy & environment");
  files["stances.json"].upcoming = [{ id: "q-test-upcoming", text: "Test?", expected: "Senate vote expected week of Nov 16", sum: "Would change transmission permitting.", bill: { label: "S. 1" }, tests: [{ p: p.id, yes: "yes" }] }];
  const r = await announce(env, new Date("2026-11-13T21:00:00Z"));
  assert.equal(r.notices, 1);
  assert.match(sent[0].body.aps.alert.title, /^Coming up: Energy & environment$/);
  sent.length = 0;
});

await test("Sunday briefing goes to every signed-up device", async () => {
  const r = await sendBriefing(env, new Date("2026-11-15T14:00:00Z"));
  assert.equal(r.sent, 2);
  assert.ok(sent.every((s) => (s.body.aps ? s.body.href : s.body.message.data.href) === "#/alerts"));
  sent.length = 0;
});

await test("unfollowing everything deletes the device", async () => {
  assert.equal((await post("/subscribe", { token: "iphonetoken1", platform: "ios", topics: [] })).status, 204);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM devices WHERE id = ?").get(await sha256("iphonetoken1")).n, 0);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM subs WHERE device = ?").get(await sha256("iphonetoken1")).n, 0);
});

console.log(`\n${pass} tests passed`);
