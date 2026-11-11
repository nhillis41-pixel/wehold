/* WeHold — the power. Plain JavaScript, no build step. */
(() => {
  "use strict";

  // ---------- small helpers ----------
  const main = document.getElementById("main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const PARTY = { R: "Republican", D: "Democrat", I: "Independent", L: "Libertarian" };
  const LABEL = { Yea: "Yea", Nay: "Nay", NV: "Not voting", Present: "Present", Other: "Voted" };
  const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands", PR: "Puerto Rico", VI: "U.S. Virgin Islands" };
  const FIPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI" };
  const NO_SENATORS = new Set(["DC", "AS", "GU", "MP", "PR", "VI"]);

  const store = {
    get() { try { return JSON.parse(localStorage.getItem("wehold") || "{}"); } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem("wehold", JSON.stringify(v)); } catch (e) { /* private mode: keep in memory */ } },
  };
  const S = Object.assign({ answers: {}, exceptions: {} }, store.get());
  if (!S.exceptions) S.exceptions = {};
  const save = () => store.set(S);

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  // ---------- data ----------
  const D = { members: [], byId: {}, votes: [], questions: [], principles: [], PM: {}, att: null, meta: {}, rolls: null };
  // In the phone app, data comes live from app.weholdllc.com so it's as current as the website;
  // the copy bundled with the app is used only if that can't be reached.
  async function getJSON(path) {
    const remote = window.WEHOLD_NATIVE && window.WEHOLD_REMOTE && !/^https?:/.test(path);
    if (remote) {
      try {
        const r = await fetch(window.WEHOLD_REMOTE + path, { cache: "no-cache" });
        if (r.ok) return r.json();
      } catch (e) { /* offline: fall back to the bundled copy */ }
    }
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }
  async function loadData() {
    const [m, v, a, meta, stn, tp] = await Promise.allSettled([getJSON("data/members.json"), getJSON("data/votes.json"), getJSON("data/attendance.json"), getJSON("data/meta.json"), getJSON("stances.json"), getJSON("topics.json")]);
    if (m.status === "fulfilled") { D.members = m.value; D.members.forEach((x) => (D.byId[x.id] = x)); }
    if (v.status === "fulfilled") { D.votes = v.value.votes || []; D.questions = v.value.questions || []; }
    if (a.status === "fulfilled") D.att = a.value;
    if (meta.status === "fulfilled") D.meta = meta.value;
    // Broad stance questions, plus status and principle links for bill questions (site/stances.json).
    const sx = stn.status === "fulfilled" ? stn.value : {};
    D.principles = sx.principles || [];
    D.principles.forEach((p) => (D.PM[p.id] = p));
    const qx = sx.questions || {};
    D.questions.forEach((q) => { const x = qx[q.id] || {}; q.status = q.status || x.status || "current"; q.tests = q.tests || x.tests || []; q.votes = q.votes || []; });
    (sx.upcoming || []).forEach((q) => { if (!D.questions.some((y) => y.id === q.id)) D.questions.push(Object.assign({ status: "upcoming", tests: [], votes: [] }, q)); });
    D.topics = tp.status === "fulfilled" ? tp.value.topics || [] : [];
    indexTopics();
    const up = document.getElementById("updated");
    if (up && D.meta.updated) up.textContent = "Votes checked " + new Date(D.meta.updated).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  async function loadRolls() { if (!D.rolls) D.rolls = await getJSON("data/rolls.json").catch(() => ({})); return D.rolls; }

  // ---------- domain logic ----------
  const placeName = (st, d) => (st === "DC" || NO_SENATORS.has(st) ? STATES[st] : `${STATES[st] || st}${d ? ", District " + d : " (at large)"}`);
  function delegation() {
    if (!S.state) return [];
    const cur = D.members.filter((m) => m.current && m.state === S.state);
    const sen = cur.filter((m) => m.chamber === "Senate").sort((a, b) => a.last.localeCompare(b.last));
    const rep = cur.filter((m) => m.chamber === "House" && (m.district || 0) === (S.district || 0));
    return [...sen, ...rep];
  }
  const honor = (m) => (m.chamber === "Senate" ? "Sen." : m.title === "Representative" ? "Rep." : m.title === "Delegate" ? "Del." : "Res. Comm.");
  function seatLine(m) {
    if (m.chamber === "Senate") return `U.S. Senator · ${STATES[m.state]}`;
    const where = m.district ? `${m.state}-${m.district}` : `${m.state} at large`;
    return `U.S. ${m.title} · ${where}`;
  }
  function upForElection(m) {
    const ed = D.meta.electionDay; if (!ed || !m.current) return false;
    const today = new Date().toISOString().slice(0, 10);
    return today <= ed && m.end === `${Number(ed.slice(0, 4)) + 1}-01-03`;
  }
  const yn = (a) => a === "yes" || a === "no";
  const YN = (a) => (a === "yes" ? "Yes" : "No");
  const flipPos = (p) => (p === "Yea" ? "Nay" : "Yea");
  function linkFor(voteId) { for (const q of D.questions) for (const l of q.votes) if (l.vote === voteId) return { q, yes: l.yes }; return null; }
  // The user's own answer that applies to a vote: their answer on the bill question first,
  // otherwise their answer on a broad question that the bill directly tests. Never a guess.
  function userStance(v) {
    const L = linkFor(v.id);
    if (L && yn(S.answers[L.q.id])) return { a: S.answers[L.q.id], yesPos: L.yes, label: `You said ${YN(S.answers[L.q.id])}` };
    if (L) for (const t of L.q.tests || []) {
      const p = D.PM[t.p], a = S.answers[t.p];
      if (p && yn(a)) return { a, yesPos: t.yes === "yes" ? L.yes : flipPos(L.yes), label: `You said ${YN(a)} on #${p.n}` };
    }
    for (const t of v.tests || []) {
      const p = D.PM[t.p], a = S.answers[t.p];
      if (p && yn(a)) return { a, yesPos: t.yes, label: `You said ${YN(a)} on #${p.n}` };
    }
    return null;
  }
  function compare(m, v) {
    const u = userStance(v); if (!u) return null;
    const p = v.pos[m.id]; if (!p) return null;
    if (p !== "Yea" && p !== "Nay") return { ...u, p, kind: "miss" };
    return { ...u, p, kind: (p === u.yesPos) === (u.a === "yes") ? "agree" : "diff" };
  }
  // Suggested answer on a bill question, from the user's broad answers. Shown as a suggestion only; never counted.
  function leanFor(q) {
    for (const t of q.tests || []) { const p = D.PM[t.p], a = S.answers[t.p]; if (p && yn(a)) return { lean: a === t.yes ? "yes" : "no", p }; }
    return null;
  }
  function matchStats(m) {
    const cmp = D.votes.map((v) => ({ v, c: compare(m, v) })).filter((x) => x.c);
    return { agree: cmp.filter((x) => x.c.kind === "agree"), diff: cmp.filter((x) => x.c.kind === "diff"), miss: cmp.filter((x) => x.c.kind === "miss") };
  }
  const attOf = (m) => (D.att && D.att.members[m.id]) || null;
  function attendanceLine(m) {
    const a = attOf(m);
    if (!D.att) return `<span class="muted">Attendance appears after the first data update.</span>`;
    if (!a && D.meta.unavailable && D.meta.unavailable[m.chamber]) return `<span class="muted">${m.chamber} attendance isn't available yet. It needs every ${m.chamber} vote, and the ${m.chamber}'s website doesn't currently allow the automated downloads that requires. Key votes are below.</span>`;
    if (!a) return `<span class="muted">No recorded votes yet this Congress.</span>`;
    const med = D.att.chambers[m.chamber].medianPct;
    return `Missed <strong>${num(a.missed)}</strong> of ${num(a.eligible)} votes (${a.pct}%)${med != null ? ` · ${m.chamber} median ${med}%` : ""}`;
  }
  const answeredCount = () => [...D.principles.map((p) => p.id), ...D.questions.map((q) => q.id)].filter((id) => yn(S.answers[id])).length;

  // ---------- shared bits ----------
  const SEAL = `<svg class="seal" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width=".8"/>${Array.from({ length: 13 }, (_, k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 13; const x = 60 + 45 * Math.cos(a), y = 60 + 45 * Math.sin(a); const pts = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 1.45 : 3.6, b = -Math.PI / 2 + (i * Math.PI) / 5; return `${(x + r * Math.cos(b)).toFixed(1)},${(y + r * Math.sin(b)).toFixed(1)}`; }).join(" "); return `<polygon points="${pts}" fill="currentColor"/>`; }).join("")}<path d="M40 86C50 66 66 48 88 32C84 50 70 68 46 84Z" fill="currentColor"/><path d="M40 86L33 95" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M30 90H78" stroke="currentColor"/></svg>`;
  const vpill = (p) => `<span class="v ${esc(p)}">${esc(LABEL[p] || p)}</span>`;
  const initials = (m) => ((m.name || "").replace(/["“”].*?["“”]\s*/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).filter((c) => /[A-Z]/.test(c)).slice(0, 1).join("") + (m.last || "")[0]).toUpperCase();
  function memberCard(m) {
    const ms = matchStats(m), n = ms.agree.length + ms.diff.length;
    const a = attOf(m), med = D.att && D.att.chambers[m.chamber] ? D.att.chambers[m.chamber].medianPct : null;
    const matchFact = n
      ? `<div class="fact"><span class="n">${ms.agree.length}<span class="muted" style="font-size:16px"> / ${n}</span></span><span class="t">votes matched your stance</span><div class="bar" aria-hidden="true" style="margin-top:6px"><i style="width:${(ms.agree.length / n) * 100}%"></i><b style="width:${(ms.diff.length / n) * 100}%"></b></div></div>`
      : `<a class="fact" href="#/charter" style="text-decoration:none;color:inherit"><span class="n" style="font-size:18px;color:var(--navy)">Set your stances →</span><span class="t">${answeredCount() ? `None have come to a ${m.chamber} vote yet` : `See how often ${esc(m.last)} votes your way`}</span></a>`;
    const attFact = a
      ? `<div class="fact"><span class="n">${a.pct}%</span><span class="t">of votes missed<br>${num(a.missed)} of ${num(a.eligible)}${med != null ? ` · median ${med}%` : ""}</span></div>`
      : `<div class="fact"><span class="n" style="font-size:18px">—</span><span class="t">${D.meta.unavailable && D.meta.unavailable[m.chamber] ? `${m.chamber} attendance coming soon` : "No recorded votes yet"}</span></div>`;
    return `<article class="card member">
      <div class="head">
        <span class="mono" aria-hidden="true">${esc(initials(m))}</span>
        <div class="stack" style="gap:2px;min-width:0;flex:1">
          <a class="mtitle" href="#/member/${esc(m.id)}">${honor(m)} ${esc(m.name)}</a>
          <span class="muted" style="font-size:14px">${esc(seatLine(m))}</span>
        </div>
      </div>
      <div class="row" style="gap:6px"><span class="party">${esc(PARTY[m.party] || m.party)}</span>${upForElection(m) ? `<span class="pill">Up for election ${fmtDate(D.meta.electionDay)}</span>` : ""}${a && a.speaker ? `<span class="pill">Speaker · votes rarely by tradition</span>` : ""}</div>
      <div class="facts">${matchFact}${attFact}</div>
      <div class="actions"><a class="btn small" href="#/member/${esc(m.id)}">See the record</a><a class="btn small ghost" href="#/write/${esc(m.id)}">Write a letter</a></div>
    </article>`;
  }
  function voteCard(v, opts = {}) {
    const people = opts.people || delegation().filter((m) => v.pos[m.id]);
    const u = userStance(v), you = !!u;
    return `<article class="vote">
      <div class="slip"><span class="ch">${esc(v.ch)}</span><span>Roll ${esc(v.roll)} · ${fmtDate(v.date)}</span><span class="tally">${esc(v.tally)}</span><span>${num(v.nv)} not voting</span><span class="v ${v.pass ? "Yea" : "Nay"}" style="align-self:flex-start">${esc(v.result)}</span></div>
      <div class="body">
        <div class="row">${you ? `<span class="pill" style="background:var(--ink);color:var(--parchment)">${esc(u.label)}</span>` : ""}${v.proc ? `<span class="pill proc">Procedural step</span>` : ""}${(v.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div>
        <h3><a href="#/vote/${esc(v.id)}" style="color:inherit;text-decoration:none">${esc(v.title)}</a></h3>
        <p class="muted" style="font-size:14px">${esc(v.q)}</p>
        <p>${esc(v.sum)}</p>
        ${v.related ? `<p class="muted" style="font-size:14px">${esc(v.related)}</p>` : ""}
        ${v.caution ? `<p class="caution">${esc(v.caution)}</p>` : ""}
        ${people.length ? `<div class="positions" aria-label="How your officials voted">${people.map((m) => { const c = you ? compare(m, v) : null; return `<span class="pos">${esc(m.last)} ${vpill(v.pos[m.id])}${c && c.kind === "agree" ? `<span class="match ok">✓ matches you</span>` : c && c.kind === "diff" ? `<span class="match no">✕ differs</span>` : ""}</span>`; }).join("")}</div>` : S.state ? "" : `<p class="muted" style="font-size:14px"><a href="#/">Add your ZIP code</a> to see how your own officials voted.</p>`}
        <div class="links"><a href="${esc(v.rec)}" target="_blank" rel="noopener">Official roll call</a>${v.bill ? `<a href="${esc(v.bill.url)}" target="_blank" rel="noopener">${esc(v.bill.label)} on Congress.gov</a>` : ""}<a href="#/vote/${esc(v.id)}">Tell your officials where you stand</a></div>
      </div></article>`;
  }

  // ---------- location lookup ----------
  function setLocation(st, d, zip) {
    S.state = st; S.district = d || 0; if (zip) S.zip = zip; save(); location.hash = "#/"; render();
  }
  function jsonp(url, ms = 15000) {
    return new Promise((resolve, reject) => {
      const cb = "__wh" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, ms);
      function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error("network")); };
      s.src = url + (url.includes("?") ? "&" : "?") + "format=jsonp&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  async function geocode(street, zip) {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/address?street=${encodeURIComponent(street)}&zip=${encodeURIComponent(zip)}&benchmark=Public_AR_Current&vintage=Current_Current`;
    const data = await jsonp(url);
    const match = data && data.result && data.result.addressMatches && data.result.addressMatches[0];
    if (!match) return null;
    const key = Object.keys(match.geographies || {}).find((k) => /congressional district/i.test(k));
    const g = key && match.geographies[key][0];
    if (!g) return null;
    const st = FIPS[String(g.STATE || g.GEOID.slice(0, 2)).padStart(2, "0")];
    const cd = parseInt(String(g.GEOID).slice(2), 10);
    return st ? { st, d: cd === 98 ? 0 : cd || 0, matched: match.matchedAddress } : null;
  }
  async function zipLookup(zip) {
    try { const t = await getJSON(`data/zips/${zip[0]}.json`); return t[zip] || null; } catch (e) { return undefined; }
  }

  function addressForm(zip, note) {
    return `<form class="card" id="addrForm" style="max-width:560px">
      ${note ? `<p>${note}</p>` : ""}
      <div><label class="f" for="street">Street address</label><input id="street" type="text" autocomplete="street-address" placeholder="e.g. 400 Main St" value="${esc(S.street || "")}" required></div>
      <div><label class="f" for="azip">ZIP code</label><input id="azip" type="text" inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(zip || "")}" required></div>
      <button class="btn" type="submit">Find my district</button>
      <p class="muted" style="font-size:13px">Your address goes only to the U.S. Census Bureau's free lookup service to find your district. It's remembered only on this device, so you won't have to type it again.</p>
      <p id="addrMsg" role="status"></p>
    </form>`;
  }
  function bindAddressForm() {
    const f = document.getElementById("addrForm"); if (!f) return;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const msg = document.getElementById("addrMsg");
      msg.textContent = "Looking up your district…";
      try {
        const r = await geocode(f.street.value.trim(), f.azip.value.trim());
        if (!r) { msg.textContent = "The Census lookup couldn't match that address. Check the spelling, or choose your district below."; return; }
        S.street = f.street.value.trim();
        if (!S.voteAddr) S.voteAddr = `${S.street}, ${r.st} ${f.azip.value.trim()}`;
        setLocation(r.st, r.d, f.azip.value.trim());
      } catch (err) { msg.textContent = "The Census lookup didn't respond. Try again, or choose your district below."; }
    };
  }
  function manualPicker() {
    const states = Object.keys(STATES).sort((a, b) => STATES[a].localeCompare(STATES[b]));
    return `<details class="card" style="max-width:560px"><summary style="cursor:pointer;font-weight:700">Or choose your state and district yourself</summary>
      <div class="stack" style="margin-top:10px"><label class="f" for="pickState">State</label><select id="pickState"><option value="">Choose a state</option>${states.map((s) => `<option value="${s}">${esc(STATES[s])}</option>`).join("")}</select>
      <div id="pickDist"></div></div></details>`;
  }
  function bindManual() {
    const sel = document.getElementById("pickState"); if (!sel) return;
    sel.onchange = () => {
      const st = sel.value, box = document.getElementById("pickDist");
      if (!st) { box.innerHTML = ""; return; }
      const reps = D.members.filter((m) => m.current && m.chamber === "House" && m.state === st).sort((a, b) => a.district - b.district);
      box.innerHTML = `<p class="label" style="margin:6px 0">Pick your representative</p><div class="stack">${reps.map((m) => `<button type="button" class="btn ghost" data-d="${m.district}">${m.district ? "District " + m.district : "At large"} · ${esc(m.name)}</button>`).join("")}</div>`;
      box.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => setLocation(st, Number(b.dataset.d))));
    };
  }

  // ---------- views ----------
  function viewWelcome() {
    main.innerHTML = `
      <section class="hero">
        <figure class="art plate" style="margin:0"><img src="img/capitol.jpg" width="1100" height="829" alt="Engraving of the United States Capitol with citizens walking on the lawn"></figure>
        <div class="stack" style="gap:18px">
          <div class="row" style="gap:12px">${SEAL}<p class="quote" style="font-size:18px;flex:1;min-width:200px">“We hold these truths to be self-evident…”</p></div>
          <h1>They hold office.<br>We hold the power.</h1>
          <p class="lede">See every vote your senators and representative cast, how often they show up, and how their record lines up with what you believe. Then tell them where you stand.</p>
          <form id="zipForm" class="stack" style="gap:8px">
            <label class="f" for="zip" style="margin:0">Your ZIP code</label>
            <div class="zipbox"><input id="zip" type="text" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="postal-code" placeholder="e.g. 37902" required value="${esc(S.zip || "")}"><button class="btn" type="submit" style="white-space:nowrap">Find my officials</button></div>
            <p id="zipMsg" role="status" class="muted"></p>
          </form>
          <p class="muted" style="font-size:13px">Independent and nonpartisan. Every vote comes from official House and Senate records.</p>
        </div>
      </section>
      <div id="zipNext" class="stack"></div>
      <div class="ornament" aria-hidden="true"><span>★ ★ ★</span></div>
      <section>
        <div class="sechead"><h2>Four articles of a citizen's power</h2></div>
        <div class="articles">
          <div class="card article"><span class="num">I.</span><h3>Know your delegation</h3><p class="muted">Your two senators and one representative: who they are and how to reach them.</p></div>
          <div class="card article"><span class="num">II.</span><h3>Read the record</h3><p class="muted">Every vote, in plain English where it matters, with each Yea, Nay and missed vote.</p></div>
          <div class="card article"><span class="num">III.</span><h3>Set your charter</h3><p class="muted">Answer broad yes-or-no questions, confirm new bills as they come up, and see who votes your way.</p></div>
          <div class="card article"><span class="num">IV.</span><h3>Give your instruction</h3><p class="muted">Tell them where you stand, and find where and when to cast your vote.</p></div>
        </div>
      </section>
      <section class="banner">
        <figure class="plate" style="margin:0;width:100%"><img src="img/citizens.jpg" width="1600" height="686" loading="lazy" alt="Engraving of American citizens looking toward the Capitol"></figure>
        <p class="quote">“We the People of the United States, in Order to form a more perfect Union…”</p>
        <span class="label muted">Preamble to the Constitution, 1787</span>
      </section>`;
    const f = document.getElementById("zipForm");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const zip = f.zip.value.trim(), msg = document.getElementById("zipMsg"), next = document.getElementById("zipNext");
      if (!/^\d{5}$/.test(zip)) { msg.textContent = "Enter a 5-digit ZIP code."; return; }
      msg.textContent = "Looking up…";
      const hits = await zipLookup(zip);
      if (hits && hits.length === 1) { setLocation(hits[0][0], hits[0][1], zip); return; }
      msg.textContent = "";
      if (hits && hits.length > 1) {
        next.innerHTML = `<div class="notice stack"><h2>Your ZIP code crosses district lines.</h2>
          <p>Parts of ${esc(zip)} are in ${hits.length} congressional districts: ${hits.map((h) => `${esc(placeName(h[0], h[1]))} (about ${h[2]}% of the area)`).join(", ")}. Your senators are the same either way; your representative depends on your street address.</p></div>
          ${addressForm(zip)}
          <div class="card" style="max-width:560px"><p class="label">Already know your district?</p><div class="stack">${hits.map((h) => `<button type="button" class="btn ghost" data-st="${h[0]}" data-d="${h[1]}">${esc(placeName(h[0], h[1]))}</button>`).join("")}</div></div>`;
        next.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => setLocation(b.dataset.st, Number(b.dataset.d), zip)));
      } else {
        next.innerHTML = addressForm(zip, hits === null ? "We couldn't match that ZIP code to a district. It may be a PO box or business ZIP. Enter your street address instead." : "The ZIP code table isn't available right now. Enter your street address instead.") + manualPicker();
        bindManual();
      }
      bindAddressForm();
      next.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function viewHome() {
    if (!S.state) return viewWelcome();
    const del = delegation();
    const ed = D.meta.electionDay, today = new Date().toISOString().slice(0, 10);
    const days = ed && today <= ed ? Math.round((new Date(ed + "T12:00:00") - new Date(today + "T12:00:00")) / 864e5) : null;
    const onBallot = del.filter(upForElection).length;
    const recent = D.votes.slice(0, 3);
    const resultsOn = ed && today >= ed && today <= ed.slice(0, 4) + "-12-31";
    main.innerHTML = `
      <header class="pagehead">
        <div class="sechead" style="align-items:flex-end"><span class="label muted">${esc(placeName(S.state, S.district))}</span><button class="linkbtn" id="changeLoc" style="font-size:14px">Change location</button></div>
        <div class="sechead" style="align-items:flex-end"><h1>Your Delegation</h1><span class="quote">They work for you.</span></div>
      </header>
      ${days != null ? `<div class="band">
        <div class="count">${days}<small>${days === 1 ? "day" : "days"}</small></div>
        <div class="stack" style="gap:2px"><span class="k">Your next verdict</span><strong style="font-size:18px">Election Day · ${fmtDate(ed)}${days === 0 ? " · today" : ""}</strong><span style="opacity:.85;font-size:14px">${onBallot ? `${onBallot} of your ${del.length} officials' seats are on the ballot.` : "None of your officials' seats are up this time."}</span></div>
      </div>` : ""}
      ${plusOn("alerts") ? (() => { const n = newAlertCount(); return `<a class="card linkcard" href="#/alerts"><span class="stack" style="gap:2px"><strong style="font-size:17px">Alerts <span class="pill new">Plus</span>${n ? ` <span class="pill">${n} new</span>` : ""}</strong><span class="muted" style="font-size:14px">${followed().length ? `Topics you follow, your officials' votes and a weekly briefing` : `Choose topics to follow and get a weekly briefing`}</span></span><span class="go" aria-hidden="true">→</span></a>`; })() : ""}
      ${plusOn("reportCard") && delegation().length ? `<a class="card linkcard" href="#/report"><span class="stack" style="gap:2px"><strong style="font-size:17px">Your report card <span class="pill new">Plus</span></strong><span class="muted" style="font-size:14px">How your officials line up with your answers, topic by topic</span></span><span class="go" aria-hidden="true">→</span></a>` : ""}
      ${days != null ? `<a class="card linkcard" href="#/where"><span class="thumb plate"><img src="img/ballot.jpg" alt="" width="1000" height="753"></span><span class="stack" style="gap:2px"><strong style="font-size:17px">Where and when to vote</strong><span class="muted" style="font-size:14px">Your polling place, hours and early voting, from election officials.</span></span><span class="go" aria-hidden="true">→</span></a>` : ""}
      ${resultsOn ? `<a class="card linkcard" href="#/results"><span class="stack" style="gap:2px"><strong style="font-size:17px">Election results</strong><span class="muted" style="font-size:14px">Official, from your state's election office</span></span><span class="go" aria-hidden="true">→</span></a>` : ""}
      ${NO_SENATORS.has(S.state) ? `<p class="notice">${esc(STATES[S.state])} is represented in the House by a delegate, who can vote in committees but not on final passage of bills, and has no senators.</p>` : ""}
      <div class="grid">${del.map(memberCard).join("") || `<p class="muted">We couldn't find officials for this location.</p>`}</div>
      ${recent.length ? `<section><div class="sechead"><h2>Recently on the docket</h2><a href="#/votes">All votes →</a></div>${recent.map((v) => voteCard(v)).join("")}</section>` : ""}`;
    document.getElementById("changeLoc").onclick = () => { delete S.state; delete S.district; save(); render(); };
  }

  async function viewMember(id) {
    const m = D.byId[id];
    if (!m) { main.innerHTML = `<p>We couldn't find that official. <a href="#/">Back to your delegation</a></p>`; return; }
    const a = attOf(m), ms = matchStats(m), n = ms.agree.length + ms.diff.length;
    const key = D.votes.filter((v) => v.pos[m.id]);
    const med = D.att ? D.att.chambers[m.chamber].medianPct : null;
    main.innerHTML = `
      <a href="#/">‹ Your Delegation</a>
      <div class="stack" style="text-align:center;align-items:center;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:22px 0;gap:6px">
        <span class="mono" aria-hidden="true" style="width:72px;height:72px;font-size:30px">${esc(initials(m))}</span>
        <span class="label muted">The record of</span>
        <h1>${esc(m.chamber === "Senate" ? "Senator" : m.title)} ${esc(m.name)}</h1>
        <span>${esc(seatLine(m))} · ${esc(PARTY[m.party] || m.party)} · Serving since ${fmtDate(m.start)}</span>
        ${m.note ? `<span class="muted">${esc(m.note)}</span>` : ""}
        ${upForElection(m) ? `<span class="pill" style="align-self:center">Seat up for election ${fmtDate(D.meta.electionDay)}</span>` : ""}
      </div>
      <div class="stats">
        ${n ? `<div class="stat"><span class="big">${ms.agree.length} / ${n}</span><span class="muted">matched your stance</span></div>` : ""}
        <div class="stat"><span class="big">${a ? num(a.missed) : "—"}</span><span class="muted">votes missed</span></div>
        <div class="stat"><span class="big">${a ? a.pct + "%" : "—"}</span><span class="muted">missed rate${med != null ? ` (median ${med}%)` : ""}</span></div>
        <div class="stat"><span class="big">${a ? num(a.eligible) : "—"}</span><span class="muted">roll calls this Congress</span></div>
      </div>
      <section class="card">
        <h2>Attendance</h2>
        <p>${attendanceLine(m)}.</p>
        <p class="muted" style="font-size:14px">Counts every recorded roll-call vote in the ${esc(D.meta.congress || "")}th Congress that ${esc(m.last)} was eligible to cast. “Present” counts as showing up. Members aren't required to explain absences, and absences can reflect illness, family needs or official travel.${a && a.speaker ? " By tradition, the Speaker of the House votes only occasionally." : ""}${m.title === "Delegate" || m.title === "Resident Commissioner" ? " Delegates can vote only on some House roll calls." : ""}</p>
        <div id="missed"></div>
      </section>
      <section class="card">
        <h2>Contact ${esc(m.last)}'s office</h2>
        <div class="row">
          <a class="btn" href="#/write/${esc(m.id)}">Write your instruction</a>
          ${m.phone ? `<a class="btn ghost" href="tel:${esc(m.phone)}">Call ${esc(m.phone)}</a>` : ""}
          ${m.url ? `<a class="btn ghost" href="${esc(m.url)}" target="_blank" rel="noopener">Official website</a>` : ""}
        </div>
      </section>
      ${plusOn("money") ? `<a class="card linkcard" href="#/money/${esc(m.id)}"><span class="stack" style="gap:2px"><strong style="font-size:17px">Follow the money <span class="pill new">Plus</span></strong><span class="muted" style="font-size:14px">Where ${esc(m.last)}'s campaign money comes from, reported to the FEC</span></span><span class="go" aria-hidden="true">→</span></a>` : ""}
      ${plusOn("reportCard") ? `<a class="card linkcard" href="#/report/${esc(m.id)}"><span class="stack" style="gap:2px"><strong style="font-size:17px">Report card <span class="pill new">Plus</span></strong><span class="muted" style="font-size:14px">How ${esc(m.last)} lines up with you, topic by topic and over time</span></span><span class="go" aria-hidden="true">→</span></a>` : ""}
      <section class="stack">
        <h2>Key votes</h2>
        ${key.length ? key.map((v) => voteCard(v, { people: [m] })).join("") : `<p class="muted">No highlighted votes for this official yet.</p>`}
      </section>`;
    if (a && a.missedRolls.length) {
      const rolls = await loadRolls();
      const box = document.getElementById("missed"); if (!box) return;
      const show = (all) => {
        const ids = all ? a.missedRolls : a.missedRolls.slice(0, 10);
        box.innerHTML = `<p class="label" style="margin-top:6px">Missed votes${all ? "" : " (most recent)"}</p><ul class="list">${ids.map((rid) => { const r = rolls[rid] || []; return `<li><span><strong>${esc(r[3] || r[2] || rid)}</strong><br><span class="muted" style="font-size:13px">${fmtDate(r[1])} · ${esc(r[2] || "")} · ${esc(r[4] || "")}</span></span><a href="${esc(r[5] || "#")}" target="_blank" rel="noopener" style="font-size:13px">Record</a></li>`; }).join("")}</ul>${!all && a.missedRolls.length > 10 ? `<button class="linkbtn" id="allMissed">Show all ${num(a.missedRolls.length)}</button>` : ""}`;
        const b = document.getElementById("allMissed"); if (b) b.onclick = () => show(true);
      };
      show(false);
    }
  }

  async function loadRecent() { if (!D.recent) D.recent = await getJSON("data/recent.json").catch(() => []); return D.recent; }
  const CODE_LABEL = { Y: "Yea", N: "Nay", P: "Present", X: "NV", O: "Other" };
  function daysAgo(d) { return Math.round((new Date(new Date().toISOString().slice(0, 10) + "T12:00:00") - new Date(d + "T12:00:00")) / 864e5); }
  function latestCard(r) {
    const t = r.totals || {};
    const mine = delegation().filter((m) => r.votes && r.votes[m.id]);
    const fresh = daysAgo(r.date) <= 2;
    return `<article class="card" style="gap:6px">
      <div class="row" style="gap:8px">${fresh ? `<span class="pill" style="background:var(--red);color:#FBF6EA">New</span>` : ""}<span class="label muted">${esc(r.ch)} · Roll ${esc(r.roll)} · ${fmtDate(r.date)}</span></div>
      <h3>${esc(r.title || r.question)}</h3>
      <p class="muted" style="font-size:14px">${esc(r.question)}${r.bill ? " · " + esc(r.bill) : ""}</p>
      <div class="row" style="gap:8px"><span class="v ${/fail|reject|not agreed/i.test(r.result) ? "Nay" : "Yea"}">${esc(r.result)}</span>${t.yea != null ? `<span style="font-size:14px">${num(t.yea)}–${num(t.nay)}${t.nv ? ` · ${num(t.nv)} not voting` : ""}</span>` : ""}</div>
      ${mine.length ? `<div class="positions">${mine.map((m) => `<span class="pos">${esc(m.last)} ${vpill(CODE_LABEL[r.votes[m.id]])}</span>`).join("")}</div>` : ""}
      <a href="${esc(r.url)}" target="_blank" rel="noopener" style="font-size:14px">Official roll call</a>
    </article>`;
  }

  async function viewVotes() {
    const ch = S.ch || "all", mode = S.dview || "key";
    const seg = (name, val, opts) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([k, l]) => `<button type="button" data-${name}="${k}" aria-pressed="${val === k}">${l}</button>`).join("")}</div>`;
    let body;
    if (mode === "latest") {
      const recent = (await loadRecent()).filter((r) => ch === "all" || r.ch === ch);
      body = `<p class="muted" style="font-size:14px">Every recorded vote, newest first, checked against official records every hour.${D.meta.updated ? " Last checked " + new Date(D.meta.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "." : ""}${ch !== "House" && D.meta.unavailable && D.meta.unavailable.Senate ? " Senate roll calls will appear here once access to Senate records is approved." : ""}</p>` + (recent.map(latestCard).join("") || `<p class="muted">No recent votes on file yet.</p>`);
    } else {
      const list = D.votes.filter((v) => ch === "all" || v.ch === ch);
      body = `${D.meta.unavailable && D.meta.unavailable.Senate ? `<p class="notice">Senate key votes are copied by hand from the official Senate records and checked against the official totals. The Senate's website doesn't currently allow automated downloads, so Senate attendance isn't available yet while we request access. House votes and attendance are complete.</p>` : ""}` + (list.map((v) => voteCard(v)).join("") || `<p class="muted">No votes yet.</p>`);
    }
    main.innerHTML = `
      <header class="pagehead"><span class="eyebrow">The record</span><h1>The Docket</h1><p class="lede">Key votes in plain English, plus every roll call as it happens. Each links to the official record.</p></header>
      <div class="row">${seg("dview", mode, [["key", "Key votes"], ["latest", "Latest votes"]])}${seg("ch", ch, [["all", "Both"], ["Senate", "Senate"], ["House", "House"]])}</div>
      ${body}`;
    main.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => { S.ch = b.dataset.ch; save(); viewVotes(); }));
    main.querySelectorAll("[data-dview]").forEach((b) => (b.onclick = () => { S.dview = b.dataset.dview; save(); viewVotes(); }));
  }

  function viewVote(id) {
    const v = D.votes.find((x) => x.id === id);
    if (!v) { main.innerHTML = `<p>We couldn't find that vote. <a href="#/votes">See all votes</a></p>`; return; }
    const people = delegation().filter((m) => m.chamber === v.ch);
    if (!viewVote.seen || viewVote.seen !== v.id) learn(topicsOfVote(v));
    viewVote.seen = v.id;
    main.innerHTML = `<a href="#/votes">‹ The Docket</a>${voteCard(v)}${topicChips(v)}<div id="vote-money"></div>
      <section class="card">
        <h2>Your instruction</h2>
        <p>Tell your ${v.ch === "Senate" ? "senators" : "representative"} where you stand on ${esc(v.title)}. You write it; you send it.</p>
        ${people.length ? `<div class="row">${people.map((m) => `<a class="btn" href="#/write/${esc(m.id)}?vote=${encodeURIComponent(v.id)}">Write to ${honor(m)} ${esc(m.last)}</a>`).join("")}</div>` : `<p><a href="#/">Add your ZIP code</a> first so we know who represents you.</p>`}
      </section>`;
    bindChips(v);
    moneyForVote(v);
  }

  // ---------- My Charter: broad stance questions + bill questions ----------
  // Answers stay on this device. WeHold shows where you stand by topic and never labels anyone's politics.
  function answerSeg(id, a, sensitive) {
    const opts = [["yes", "Yes"], ["no", "No"], ["skip", "Not sure"]];
    if (sensitive) opts.push(["pns", "Prefer not to say"]);
    return `<div class="seg" role="group" aria-label="Your answer">${opts.map(([k, l]) => `<button type="button" data-q="${esc(id)}" data-a="${k}" aria-pressed="${a === k}">${l}</button>`).join("")}</div>`;
  }
  // Times the user's bill answers went against their broad answer and they chose to keep both.
  const exceptionsFor = (pid) => D.questions.filter((q) => S.exceptions[q.id] && (q.tests || []).some((t) => t.p === pid)).length;
  function viewCharter() {
    const done = answeredCount();
    const total = D.principles.length + D.questions.filter((q) => q.status !== "past").length;
    const topics = [...new Set(D.principles.map((p) => p.topic))];
    const standRows = topics.map((t) => {
      const items = D.principles.filter((p) => p.topic === t && yn(S.answers[p.id]));
      if (!items.length) return "";
      return `<li><span><span class="label muted" style="display:block">${esc(t)}</span>${items.map((p) => { const n = exceptionsFor(p.id); return `${esc(S.answers[p.id] === "yes" ? p.yesLabel : p.noLabel)}${n >= 2 ? ` <a href="#/charter" data-jump="${esc(p.id)}" style="font-size:13px">Revisit? Your bill answers differed ${n} times</a>` : ""}`; }).join("; ")}</span></li>`;
    }).join("");
    const principleCard = (p) => `<div class="card" id="pq-${esc(p.id)}"><p style="font-weight:700;font-size:17px"><span class="muted" style="font-weight:400;font-size:14px;margin-right:6px">${p.n}.</span>${esc(p.text)}</p>${answerSeg(p.id, S.answers[p.id], p.sensitive)}</div>`;
    const billCard = (q) => {
      const a = S.answers[q.id], L = leanFor(q);
      const tied = q.votes.map((l) => D.votes.find((v) => v.id === l.vote)).filter(Boolean);
      const when = q.status === "upcoming" ? `Upcoming vote${q.expected ? ": " + esc(q.expected) : ""}` : tied.length ? `Tied to: ${tied.map((v) => `<a href="#/vote/${esc(v.id)}">${esc(v.ch)} vote, ${fmtDate(v.date)}</a>`).join(" · ")}` : "";
      let lean = "", conflict = "";
      if (L) {
        lean = `<p class="pill" style="align-self:flex-start;white-space:normal">Based on your answer to #${L.p.n}, you'd likely say <strong>&nbsp;${YN(L.lean)}</strong>.${yn(a) ? "" : " Tap to confirm or choose differently."}</p>`;
        if (yn(a) && a !== L.lean && !S.exceptions[q.id]) conflict = `<div class="notice stack" style="gap:8px"><span>This is different from your answer to #${L.p.n}: “${esc(L.p.text)}”</span><div class="row"><button type="button" class="btn small" data-upd="${esc(q.id)}" data-p="${esc(L.p.id)}">Update my answer to #${L.p.n}</button><button type="button" class="btn small ghost" data-exc="${esc(q.id)}">Keep both. This bill is an exception</button></div></div>`;
      }
      return `<div class="card"><p style="font-weight:700;font-size:17px">${esc(q.text)}</p>${q.sum ? `<p class="muted" style="font-size:14px">${esc(q.sum)}</p>` : ""}${lean}${answerSeg(q.id, a)}${conflict}${when ? `<span class="muted" style="font-size:13px">${when}</span>` : ""}${q.bill ? `<a href="${esc(q.bill.url)}" target="_blank" rel="noopener" style="font-size:13px">${esc(q.bill.label)} on Congress.gov</a>` : ""}</div>`;
    };
    const active = D.questions.filter((q) => q.status !== "past").sort((x, y) => (x.status === "upcoming" ? 0 : 1) - (y.status === "upcoming" ? 0 : 1));
    const past = D.questions.filter((q) => q.status === "past");
    main.innerHTML = `
      <div class="pagehead"><span class="eyebrow">Where you stand</span><h1>My Charter</h1><p class="quote">Set down where you stand. We hold every vote your officials cast against it.</p>
      <div class="row"><div class="bar" style="flex:1;min-width:160px"><i style="width:${total ? Math.min(100, (done / total) * 100) : 0}%"></i></div><strong style="font-size:14px">${done} answered</strong></div></div>
      ${standRows ? `<section class="card"><h2>Where you stand</h2><ul class="list">${standRows}</ul><p class="muted" style="font-size:13px">Built only from your own answers. WeHold never labels anyone's politics.</p></section>` : ""}
      ${D.principles.length ? `<section class="stack"><h2>Your views</h2><p class="muted" style="font-size:14px">Broad questions about issues that come before Congress. Answer the ones you have a view on. As new bills come up, WeHold suggests an answer from these, and you confirm it.</p>
        ${topics.map((t) => `<p class="label muted" style="margin-top:8px">${esc(t)}</p>${D.principles.filter((p) => p.topic === t).map(principleCard).join("")}`).join("")}</section>` : ""}
      ${active.length ? `<section class="stack"><h2>Bills in Congress</h2><p class="muted" style="font-size:14px">Confirm or change the suggested answer for each bill. Only answers you choose are counted.</p>${active.map(billCard).join("")}</section>` : ""}
      ${past.length ? `<details class="card" id="pastQ"${S.pastOpen ? " open" : ""}><summary style="cursor:pointer;font-weight:700">Past questions (${past.length})</summary><div class="stack" style="margin-top:10px">${past.map(billCard).join("")}</div><p class="muted" style="font-size:13px">These still count toward each official's match.</p></details>` : ""}
      <p class="muted" style="font-size:14px">Your answers stay on this device. They are never sent anywhere.</p>
      <div class="row"><a class="btn" href="#/">See my delegation</a><button class="linkbtn" id="clearAns">Clear my answers</button></div>`;
    const rerender = (focusSel) => { const y = scrollY; viewCharter(); scrollTo(0, y); if (focusSel) { const nb = main.querySelector(focusSel); if (nb) nb.focus(); } };
    main.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { if (S.answers[b.dataset.q] !== b.dataset.a) learn(topicsOfQuestion(b.dataset.q)); S.answers[b.dataset.q] = b.dataset.a; delete S.exceptions[b.dataset.q]; save(); rerender(`[data-q="${b.dataset.q}"][data-a="${b.dataset.a}"]`); }));
    main.querySelectorAll("[data-upd]").forEach((b) => (b.onclick = () => {
      const q = D.questions.find((x) => x.id === b.dataset.upd), t = q && (q.tests || []).find((x) => x.p === b.dataset.p); if (!t) return;
      // A Yes on the bill means answer t.yes on the broad question; a No means the opposite.
      const a = S.answers[q.id]; S.answers[t.p] = a === "yes" ? t.yes : t.yes === "yes" ? "no" : "yes";
      save(); toast(`Updated your answer to #${D.PM[t.p].n}.`); rerender();
    }));
    main.querySelectorAll("[data-exc]").forEach((b) => (b.onclick = () => { S.exceptions[b.dataset.exc] = true; save(); rerender(); }));
    main.querySelectorAll("[data-jump]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); const el = document.getElementById("pq-" + b.dataset.jump); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }));
    const pq = document.getElementById("pastQ"); if (pq) pq.ontoggle = () => { S.pastOpen = pq.open; save(); };
    document.getElementById("clearAns").onclick = () => { S.answers = {}; S.exceptions = {}; save(); viewCharter(); };
  }

  function viewWrite(id, params) {
    const m = D.byId[id];
    if (!m) { main.innerHTML = `<p>We couldn't find that official. <a href="#/">Back</a></p>`; return; }
    const v = params.get("vote") ? D.votes.find((x) => x.id === params.get("vote")) : null;
    const me = Object.assign({ email: "", street: S.street || "", zip: S.zip || "", phone: "" }, S.me || {});
    const st = { pos: params.get("pos") || "support", name: S.myName || "", town: S.myTown || "", topic: v ? v.title + (v.bill && !v.title.includes(v.bill.label) ? ` (${v.bill.label})` : "") : "", edited: false };
    const title = m.chamber === "Senate" ? "Senator" : m.title;
    const draft = () => {
      const stance = st.pos === "support" ? "I ask you to support" : st.pos === "oppose" ? "I ask you to oppose" : "I am still weighing";
      const topic = st.topic || "[the bill or issue]";
      return `Dear ${title} ${m.last},\n\nAs your constituent in ${st.town || "[your town]"}, ${STATES[m.state]}, I'm writing about ${topic}. ${stance} it${st.pos === "undecided" ? ", and I would like to know where you stand and why" : ""}.\n\n[In your own words: why this matters to you, your family or your community.]\n\nRespectfully,\n${st.name || "[Your name]"}\n${me.street ? me.street + "\n" : ""}${st.town || "[Your town]"}, ${m.state}${me.zip ? " " + me.zip : ""}${me.email ? "\n" + me.email : ""}${me.phone ? "\n" + me.phone : ""}`;
    };
    main.innerHTML = `
      <a href="${v ? "#/vote/" + esc(v.id) : "#/member/" + esc(m.id)}">‹ Back</a>
      <div class="stack" style="gap:4px"><h1>Your instruction</h1><p class="muted">To ${honor(m)} ${esc(m.name)} · ${esc(seatLine(m))}</p></div>
      <div class="grid" style="align-items:start">
        <form class="card" id="wf" onsubmit="return false">
          <div><label class="f" for="topic">What it's about</label><input id="topic" type="text" value="${esc(st.topic)}" placeholder="A bill, nomination or issue"></div>
          <div><span class="f">Your position</span><div class="seg" role="group" aria-label="Your position">${[["support", "Support"], ["oppose", "Oppose"], ["undecided", "Undecided"]].map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${st.pos === k}">${l}</button>`).join("")}</div></div>
          <div><label class="f" for="nm">Your name</label><input id="nm" type="text" autocomplete="name" value="${esc(st.name)}"></div>
          <div><label class="f" for="em">Your email</label><input id="em" type="email" autocomplete="email" value="${esc(me.email)}" placeholder="So the office can reply"></div>
          <div><label class="f" for="sa">Street address</label><input id="sa" type="text" autocomplete="street-address" value="${esc(me.street)}"></div>
          <div class="row" style="gap:10px;flex-wrap:nowrap">
            <div style="flex:2"><label class="f" for="tw">Town</label><input id="tw" type="text" autocomplete="address-level2" value="${esc(st.town)}"></div>
            <div style="flex:1"><label class="f" for="zp">ZIP</label><input id="zp" type="text" inputmode="numeric" maxlength="10" autocomplete="postal-code" value="${esc(me.zip)}"></div>
          </div>
          <div><label class="f" for="ph">Phone <span class="muted" style="font-weight:400">(optional)</span></label><input id="ph" type="tel" autocomplete="tel" value="${esc(me.phone)}"></div>
          <label class="row" style="gap:8px;font-size:14px;align-items:center"><input type="checkbox" id="remember" ${S.rememberMe !== false ? "checked" : ""}> Remember my info on this device</label>
          <p class="muted" style="font-size:13px">Offices only answer their own constituents, so they ask for your home address. Your info stays on this device; WeHold's servers never see it.${S.me ? ` <button type="button" class="linkbtn" id="forgetMe">Forget my info</button>` : ""}</p>
        </form>
        <div class="stack">
          <label class="f" for="letter">Your letter (edit freely)</label>
          <textarea id="letter" class="letter" rows="14"></textarea>
          <div class="row noprint">
            ${m.contact ? `<button class="btn red" type="button" id="send">Copy letter &amp; open ${esc(m.last)}'s contact form</button>` : ""}
            ${m.phone ? `<a class="btn ghost" href="tel:${esc(m.phone)}">Call ${esc(m.phone)}</a>` : ""}
            <button class="btn ghost" type="button" id="print">Print to mail</button>
          </div>
          <div id="formHelp" class="card noprint" hidden></div>
          ${m.phone ? `<details class="card noprint"><summary style="cursor:pointer;font-weight:700">Phone script (about 30 seconds)</summary><p id="script" style="margin-top:8px"></p></details>` : ""}
          <p class="muted" style="font-size:13px">Sent exactly as you wrote it, only when you choose. WeHold never sends anything on your behalf or keeps a copy.</p>
        </div>
      </div>`;
    const ta = document.getElementById("letter"), f = document.getElementById("wf");
    const refresh = () => {
      if (!st.edited) ta.value = draft();
      const sc = document.getElementById("script");
      if (sc) sc.textContent = `Hi, my name is ${st.name || "[your name]"} and I'm a constituent from ${st.town || "[your town]"}. I'm calling to ask ${title} ${m.last} to ${st.pos === "support" ? "support" : st.pos === "oppose" ? "oppose" : "share their position on"} ${st.topic || "[the bill]"}. Thank you.`;
    };
    ta.oninput = () => (st.edited = true);
    f.topic.oninput = () => { st.topic = f.topic.value; refresh(); };
    const persist = () => {
      if (f.remember.checked) { S.myName = st.name; S.myTown = st.town; S.me = Object.assign({}, me); S.rememberMe = true; }
      else { delete S.me; delete S.myName; delete S.myTown; S.rememberMe = false; }
      save();
    };
    f.nm.oninput = () => { st.name = f.nm.value; persist(); refresh(); };
    f.tw.oninput = () => { st.town = f.tw.value; persist(); refresh(); };
    [["em", "email"], ["sa", "street"], ["zp", "zip"], ["ph", "phone"]].forEach(([el, k]) => (f[el].oninput = () => { me[k] = f[el].value.trim(); persist(); refresh(); }));
    f.remember.onchange = persist;
    const fm = document.getElementById("forgetMe");
    if (fm) fm.onclick = () => { delete S.me; delete S.myName; delete S.myTown; delete S.street; save(); viewWrite(id, params); };
    const copyText = async (t) => { try { await navigator.clipboard.writeText(t); toast("Copied."); } catch (e) { toast("Couldn't copy. Select it and copy instead."); } };
    const showFormHelp = () => {
      const fields = [["Name", st.name], ["Email", me.email], ["Street address", me.street], ["City", st.town], ["State", m.state], ["ZIP", me.zip], ["Phone", me.phone], ["Subject", st.topic]].filter(([, val]) => val);
      const box = document.getElementById("formHelp");
      box.hidden = false;
      box.innerHTML = `<strong>Your details for ${esc(m.last)}'s form</strong><span class="muted" style="font-size:13px">The form opened in a new tab. Tap Copy next to each item, then paste it into the matching box. Your letter is already copied for the message box.</span>
        ${fields.map(([l, val], i) => `<div class="row" style="justify-content:space-between;gap:10px;border-top:1px solid var(--rule);padding-top:8px"><span><span class="muted" style="font-size:12px;display:block">${esc(l)}</span>${esc(val)}</span><button type="button" class="btn small ghost" data-cp="${i}">Copy</button></div>`).join("")}
        <div class="row" style="justify-content:space-between;gap:10px;border-top:1px solid var(--rule);padding-top:8px"><span><span class="muted" style="font-size:12px;display:block">Message</span>Your letter</span><button type="button" class="btn small ghost" data-cp="letter">Copy</button></div>`;
      box.querySelectorAll("[data-cp]").forEach((b) => (b.onclick = () => copyText(b.dataset.cp === "letter" ? ta.value : fields[+b.dataset.cp][1])));
    };
    f.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { st.pos = b.dataset.p; f.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", x === b)); refresh(); }));
    const send = document.getElementById("send");
    if (send) send.onclick = async () => {
      try { await navigator.clipboard.writeText(ta.value); toast("Letter copied. Paste it into the form."); } catch (e) { ta.select(); toast("Select the letter and copy it, then paste it into the form."); }
      window.open(m.contact, "_blank", "noopener");
      showFormHelp();
    };
    document.getElementById("print").onclick = () => window.print();
    refresh();
  }

  // ---------- where to vote (Google Civic Information API; data from election officials via the Voting Information Project) ----------
  const OFFICIAL_FALLBACK = "https://www.usa.gov/election-office";
  const fmtAddr = (a) => [a.locationName, a.line1, a.line2, a.line3, [a.city, a.state].filter(Boolean).join(", ") + (a.zip ? " " + a.zip : "")].filter((x) => x && x.trim()).map(esc).join("<br>");
  const mapLink = (loc) => { const a = loc.address || {}; const q = loc.latitude && loc.longitude ? `${loc.latitude},${loc.longitude}` : [a.line1, a.city, a.state, a.zip].filter(Boolean).join(" "); return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`; };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
  function locationCard(loc, kind) {
    const src = (loc.sources || []).map((x) => esc(x.name) + (x.official ? " (official)" : "")).join(", ");
    const dates = loc.startDate || loc.endDate ? `<span><strong>Dates:</strong> ${fmtDate(loc.startDate)}${loc.endDate && loc.endDate !== loc.startDate ? " – " + fmtDate(loc.endDate) : ""}</span>` : "";
    return `<article class="card">
      <span class="label muted">${esc(kind)}</span>
      <span class="mtitle" style="font-size:18px">${fmtAddr(loc.address || {}) || esc(loc.name || "Location")}</span>
      ${dates}
      ${loc.pollingHours ? `<span><strong>Hours:</strong> ${esc(loc.pollingHours)}</span>` : `<span class="muted">Hours not provided. Check with your election office.</span>`}
      ${loc.notes ? `<span class="muted" style="font-size:14px">${esc(loc.notes)}</span>` : ""}
      ${src ? `<span class="muted" style="font-size:13px">Source: ${src}</span>` : ""}
      <a class="btn small ghost" style="align-self:flex-start" href="${esc(mapLink(loc))}" target="_blank" rel="noopener">Get directions</a>
    </article>`;
  }
  function officeCard(body, label) {
    if (!body) return "";
    const links = [["votingLocationFinderUrl", "Official polling place lookup"], ["electionInfoUrl", "Election information"], ["electionRegistrationConfirmationUrl", "Check your registration"], ["absenteeVotingInfoUrl", "Absentee / mail voting"]]
      .map(([k, l]) => safeUrl(body[k]) ? `<a href="${esc(body[k])}" target="_blank" rel="noopener">${l}</a>` : "").filter(Boolean).join("");
    const phones = (body.electionOfficials || []).filter((o) => o.officePhoneNumber).map((o) => `<a href="tel:${esc(o.officePhoneNumber)}">${esc(o.officePhoneNumber)}</a>${o.title ? ` <span class="muted">(${esc(o.title)})</span>` : ""}`).join("<br>");
    return `<article class="card"><span class="label muted">${esc(label)}</span><span class="mtitle" style="font-size:18px">${esc(body.name || "Election office")}</span>${body.hoursOfOperation ? `<span><strong>Office hours:</strong> ${esc(body.hoursOfOperation)}</span>` : ""}${phones ? `<span>${phones}</span>` : ""}${links ? `<div class="stack" style="gap:6px">${links}</div>` : ""}</article>`;
  }
  function viewWhere() {
    const key = D.meta.civicApiKey;
    const ed = D.meta.electionDay;
    main.innerHTML = `
      <a href="#/">‹ Your Delegation</a>
      <figure class="plate" style="margin:0;max-height:260px"><img src="img/ballot.jpg" width="1000" height="753" alt="Engraving of a wooden ballot box beside a quill and inkwell" style="height:260px;width:100%;object-fit:cover;object-position:50% 45%"></figure>
      <div class="pagehead"><span class="eyebrow">Your verdict${ed ? " · " + fmtDate(ed) : ""}</span><h1>Where and when to vote</h1>
      <p class="muted" style="max-width:44rem">Enter the address where you're registered to vote. Locations and hours come from state and local election officials through the Voting Information Project.</p></div>
      ${key ? `<form class="card" id="whereForm" style="max-width:560px">
        <div><label class="f" for="waddr">Your registered home address</label><input id="waddr" type="text" autocomplete="street-address" placeholder="400 Main St, Knoxville, TN 37902" value="${esc(S.voteAddr || "")}" required></div>
        <label class="row" style="gap:8px;font-size:14px;align-items:center"><input type="checkbox" id="wremember" ${S.voteAddr || S.rememberAddr !== false ? "checked" : ""}> Remember this address on this device</label>
        <button class="btn" type="submit">Find my polling place</button>
        <p class="muted" style="font-size:13px">Your address is sent only to Google's Civic Information service to look up your voting locations. If you check "Remember," it's saved only on this device, never on WeHold's servers.${S.voteAddr ? ` <button type="button" class="linkbtn" id="wforget">Forget my address</button>` : ""}</p>
      </form>` : ""}
      <div id="whereOut" class="stack" aria-live="polite"></div>
      <div class="notice stack">
        <strong>Always confirm with your election office.</strong>
        <span>Polling places and hours can change right up to Election Day. Your state or county election office has the final word.</span>
        <a href="${OFFICIAL_FALLBACK}" target="_blank" rel="noopener">Find your state or local election office (USA.gov)</a>
      </div>
      <p><a href="#/results">Election results →</a></p>`;
    const f = document.getElementById("whereForm"); if (!f) return;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const out = document.getElementById("whereOut");
      const addr = f.waddr.value.trim().replace(/\s+/g, " ");
      if (/^\d{5}(-\d{4})?$/.test(addr) || !/\d/.test(addr) || addr.split(/[ ,]+/).length < 3) {
        out.innerHTML = `<p class="notice">Polling places are assigned by street address, so a ZIP code or city alone isn't enough. Type your full street address with city, state and ZIP, for example: 400 Main St, Knoxville, TN 37902.</p>`;
        return;
      }
      const remember = document.getElementById("wremember").checked;
      S.rememberAddr = remember;
      if (remember) S.voteAddr = addr; else delete S.voteAddr;
      save();
      out.innerHTML = `<p class="muted">Looking up your voting locations…</p>`;
      let data;
      try {
        const r = await fetch(`https://www.googleapis.com/civicinfo/v2/voterinfo?key=${encodeURIComponent(key)}&address=${encodeURIComponent(addr)}`);
        data = await r.json();
        if (!r.ok) {
          const msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
          console.warn("Civic API error:", r.status, msg);
          let text;
          if (r.status === 403 || /referer|api key|permission|disabled|blocked/i.test(msg)) {
            text = "The polling place lookup isn't set up correctly on our end yet (the lookup key was refused). This isn't a problem with your address. Use the official link below for now.";
          } else if (/election unknown|no election/i.test(msg)) {
            text = "Election officials haven't published polling places for an upcoming election at this address yet. Use the official link below.";
          } else if (/parse|address/i.test(msg)) {
            text = "We couldn't match that address. Type your full street address with city, state and ZIP, for example: 400 Main St, Knoxville, TN 37902.";
          } else {
            text = "There's no voting information for this address right now. That doesn't mean you can't vote; it may not be published yet. Use the official link below.";
          }
          out.innerHTML = `<p class="notice">${text}<br><span class="muted" style="font-size:12px">Lookup service said: ${esc(msg)}</span></p>`;
          return;
        }
      } catch (err) {
        out.innerHTML = `<p class="notice">The lookup service didn't respond. Try again, or use the official link below.</p>`;
        return;
      }
      const st = (data.state || [])[0] || {};
      const polls = data.pollingLocations || [], early = data.earlyVoteSites || [], drop = data.dropOffLocations || [];
      const el = data.election || {};
      const others = (data.otherElections || []).map((o) => esc(o.name)).join(", ");
      out.innerHTML = `
        ${el.name ? `<div class="band"><div class="stack" style="gap:0"><span class="k">Election</span><strong>${esc(el.name)}${el.electionDay ? " · " + fmtDate(el.electionDay) : ""}</strong>${others ? `<span style="opacity:.85;font-size:14px">Also on file: ${others}</span>` : ""}</div></div>` : ""}
        ${data.mailOnly ? `<p class="notice">Voters at this address vote by mail. See your election office for ballot return and drop-off options.</p>` : ""}
        ${polls.length ? `<h2>Election Day polling place</h2><div class="grid">${polls.map((l) => locationCard(l, "Election Day")).join("")}</div>` : `<p class="notice">No Election Day polling place is on file for this address yet. Use your state's official lookup below.</p>`}
        ${early.length ? `<h2>Early voting</h2><div class="grid">${early.map((l) => locationCard(l, "Early voting")).join("")}</div>` : ""}
        ${drop.length ? `<h2>Ballot drop-off</h2><div class="grid">${drop.map((l) => locationCard(l, "Drop-off")).join("")}</div>` : ""}
        <h2>Your election offices</h2>
        <div class="grid">${officeCard(st.local_jurisdiction && st.local_jurisdiction.electionAdministrationBody, "Local") || ""}${officeCard(st.electionAdministrationBody, "State")}</div>`;
    };
    const fg = document.getElementById("wforget");
    if (fg) fg.onclick = () => { delete S.voteAddr; delete S.street; S.rememberAddr = false; save(); viewWhere(); };
    if (S.voteAddr) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true }));
  }

  // ---------- election results: official state sources only; WeHold never calls a race ----------
  const STATE_ELECTION_SITES = {AL:"https://www.sos.alabama.gov/alabama-votes",AK:"https://www.elections.alaska.gov/",AS:"https://aselectionoffice.gov/",AZ:"https://azsos.gov/elections",AR:"https://www.sos.arkansas.gov/elections",CA:"https://www.sos.ca.gov/elections",CO:"https://www.sos.state.co.us/pubs/elections/main.html",CT:"https://portal.ct.gov/sots/common-elements/v5-template---redesign/elections--voting--home-page",DE:"https://elections.delaware.gov/index.shtml",DC:"https://dcboe.org/",FL:"https://www.dos.myflorida.com/elections/",GA:"https://sos.ga.gov/elections-division-georgia-secretary-states-office",GU:"https://gec.guam.gov/",HI:"https://elections.hawaii.gov/",ID:"https://voteidaho.gov/",IL:"https://www.elections.il.gov/",IN:"https://indianavoters.in.gov/",IA:"https://sos.iowa.gov/elections/voterinformation/index.html",KS:"https://sos.ks.gov/elections/elections.html",KY:"https://elect.ky.gov/Pages/default.aspx",LA:"https://www.sos.la.gov/ElectionsAndVoting/Pages/default.aspx",ME:"https://www.maine.gov/sos/cec/elec/index.html",MD:"https://elections.maryland.gov/",MA:"https://www.sec.state.ma.us/divisions/elections/elections-and-voting.htm",MI:"https://www.michigan.gov/sos/elections",MN:"https://www.sos.state.mn.us/elections-voting/",MS:"https://www.sos.ms.gov/elections-voting",MO:"https://www.sos.mo.gov/elections/",MT:"https://sosmt.gov/elections/",NE:"https://www.nebraska.gov/featured/elections-voting/",NV:"https://www.nvsos.gov/sos/elections",NH:"https://www.sos.nh.gov/elections/voters",NJ:"https://www.nj.gov/state/elections/vote.shtml",NM:"https://www.sos.nm.gov/voting-and-elections/voter-information-portal-nmvote-org/",NY:"https://www.elections.ny.gov/",NC:"https://www.ncsbe.gov/",ND:"https://vip.sos.nd.gov/PortalList.aspx",MP:"https://www.votecnmi.gov.mp/",OH:"https://www.sos.state.oh.us/elections/voters/",OK:"https://oklahoma.gov/elections.html",OR:"https://sos.oregon.gov/voting-elections/Pages/default.aspx",PA:"https://www.dos.pa.gov/VotingElections/Pages/default.aspx",PR:"https://ww2.ceepur.org/",RI:"https://vote.sos.ri.gov/",SC:"https://www.scvotes.org/",SD:"https://sdsos.gov/elections-voting/default.aspx",TN:"https://sos.tn.gov/elections",TX:"https://www.sos.state.tx.us/elections/index.shtml",VI:"https://vivote.gov/",UT:"https://vote.utah.gov/",VT:"https://sos.vermont.gov/elections/",VA:"https://www.elections.virginia.gov/",WA:"https://www.sos.wa.gov/elections",WV:"https://sos.wv.gov/elections/pages/default.aspx",WI:"https://myvote.wi.gov/en-us/",WY:"https://sos.wyo.gov/Elections/Default.aspx"};
  function viewResults() {
    const ed = D.meta.electionDay, today = new Date().toISOString().slice(0, 10);
    const before = ed && today < ed;
    const del = delegation(), races = del.filter(upForElection);
    const site = S.state && STATE_ELECTION_SITES[S.state];
    main.innerHTML = `
      <a href="#/">‹ Your Delegation</a>
      <div class="pagehead"><span class="eyebrow">Election${ed ? " · " + fmtDate(ed) : ""}</span><h1>Election results</h1>
      <p class="muted" style="max-width:44rem">Results come from your state's official election office. Election-night numbers are unofficial until each state certifies them. WeHold doesn't declare winners.</p></div>
      ${before ? `<p class="notice">Polls haven't closed yet. Results start appearing on your state's official site on the evening of ${fmtDate(ed)}. <a href="#/where">Find where and when to vote</a>.</p>` : ""}
      ${S.state ? `<section class="card">
        <span class="label muted">${esc(STATES[S.state] || S.state)}</span>
        <h2>Your races for Congress</h2>
        ${races.length ? `<ul class="list">${races.map((m) => `<li><span><strong>${m.chamber === "Senate" ? "U.S. Senate" : "U.S. House, " + (m.district ? m.state + "-" + m.district : m.state + " at large")}</strong><br><span class="muted" style="font-size:14px">Seat now held by ${esc(m.name)} (${esc(PARTY[m.party] || m.party)})</span></span></li>`).join("")}</ul>` : `<p class="muted">None of your current officials' seats are on this ballot.</p>`}
        ${site ? `<a class="btn" style="align-self:flex-start" href="${esc(site)}" target="_blank" rel="noopener">${esc(STATES[S.state])} official election results</a>` : ""}
        <p class="muted" style="font-size:13px">Look for "election night results" or "unofficial results" on the state's site. Your county election office also posts local results.</p>
      </section>` : `<p><a href="#/">Add your ZIP code</a> to see your own races.</p>`}
      <details class="card"><summary style="cursor:pointer;font-weight:700">Official results sites for every state</summary>
        <ul class="list" style="margin-top:8px">${Object.keys(STATE_ELECTION_SITES).filter((k) => STATES[k]).sort((a, b) => STATES[a].localeCompare(STATES[b])).map((k) => `<li><a href="${esc(STATE_ELECTION_SITES[k])}" target="_blank" rel="noopener">${esc(STATES[k])}</a></li>`).join("")}</ul>
        <p class="muted" style="font-size:13px">Links from USA.gov's directory of state election offices.</p>
      </details>`;
  }

  function viewAbout() {
    main.innerHTML = `
      <figure class="plate" style="margin:0"><img src="img/citizens.jpg" width="1600" height="686" alt="Engraving of American citizens looking toward the Capitol"></figure>
      <header class="pagehead"><span class="eyebrow">How it works</span><h1>Answerable to no party.</h1><p class="lede">WeHold shows the public record of the people who represent you, from official sources, and leaves the judgment to you.</p></header>
      <div class="grid">
        <section class="card"><h3>Official sources only</h3><p>Every vote comes from the official records published by the <a href="https://clerk.house.gov/Votes" target="_blank" rel="noopener">Clerk of the House</a> and the <a href="https://www.senate.gov/legislative/votes_new.htm" target="_blank" rel="noopener">U.S. Senate</a>, checked every day. Member information comes from the public-domain <a href="https://github.com/unitedstates/congress-legislators" target="_blank" rel="noopener">congress-legislators</a> project. Bill text links go to Congress.gov.</p></section>
        <section class="card"><h3>Checked before it's published</h3><p>Each day's update adds up every member's vote on every roll call and compares the result with the official totals. Senate votes are also checked against the Senate's own vote list. If anything disagrees, nothing is published until it's fixed.</p></section>
        <section class="card"><h3>Attendance</h3><p>Counts every recorded vote a member was eligible to cast this Congress. “Not voting” counts as missed; “Present” counts as showing up. Members who joined mid-term are counted from their first vote. Absences can have many reasons, and members aren't required to give one.</p></section>
        <section class="card"><h3>Finding your officials</h3><p>Most ZIP codes sit inside one congressional district. When a ZIP crosses district lines, WeHold asks for your street address and checks it with the U.S. Census Bureau's free geocoder. Your address goes only to the Census Bureau and is never stored by WeHold.</p></section>
        <section class="card"><h3>Your charter, not a label</h3><p>Your stances come only from your own answers, shown topic by topic. WeHold never labels anyone conservative, liberal or anything else. A bill is linked to a question by what it does, never by who sponsored it. Suggested answers on new bills come from your own answers and count only after you confirm them.</p></section>
        <section class="card"><h3>No red team, no blue team</h3><p>Party is shown as a label, never a color. Summaries describe what a bill does; when the parties disagree, each side's main argument gets equal space. A caution appears when one vote bundles unrelated issues, so a Yea or Nay may not reflect a position on the headline.</p></section>
        <section class="card"><h3>Your data stays yours</h3><p>No account, no tracking, no ads. Your ZIP code, stances and letter details are saved only in this browser. Letters are sent by you, through each office's own contact form, phone line or mail.</p></section>
      </div>
      <p class="muted">WeHold is published by WeHold LLC, a Tennessee company based in Morrison, Tennessee. Contact: <a href="mailto:nathan@weholdllc.com">nathan@weholdllc.com</a>. Read the <a href="privacy.html">Privacy Policy</a> and <a href="terms.html">Terms of Use</a>.</p>
      <p class="muted">WeHold is an independent, nonpartisan project. It is not affiliated with, endorsed by, or speaking for any government agency or political party. The code is open at <a href="https://github.com/nhillis41-pixel/wehold" target="_blank" rel="noopener">github.com/nhillis41-pixel/wehold</a>.</p>`;
  }

  // ---------- WeHold Plus: smart alerts ----------
  // Interest, never stance: this device counts which topics a person reads about, asks before following one,
  // and builds alerts from public data. Nothing here leaves the device. Phone notifications come with the app-store
  // version, through anonymous topic channels named by topic id.
  const AK = "wehold-alerts";
  const A = Object.assign({ reads: {}, follow: {}, asked: {}, read: {} }, (() => { try { return JSON.parse(localStorage.getItem(AK) || "{}"); } catch (e) { return {}; } })());
  const saveA = () => { try { localStorage.setItem(AK, JSON.stringify(A)); } catch (e) { /* private mode */ } };
  // Phone app only: sign this device up for the anonymous topic channels it follows.
  const NAT = () => window.WeHoldNative || null;
  function syncPush(askFirst) {
    const n = NAT(); if (!n || !n.pushAvailable) return;
    const go = () => n.sendTopics(Object.keys(A.follow).filter((id) => A.follow[id]));
    if (askFirst) n.enablePush().then(go).catch(() => {}); else go();
  }
  const ASK_AFTER = 3, ASK_AGAIN_DAYS = 30, ALERT_DAYS = 60, NEW_DAYS = 14;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
  function indexTopics() {
    D.TM = {}; D.tagTopic = {}; D.ptTopic = {};
    (D.topics || []).forEach((t) => {
      D.TM[t.id] = t;
      (t.tags || []).forEach((g) => (D.tagTopic[g.toLowerCase()] = t.id));
      (t.principleTopics || []).forEach((g) => (D.ptTopic[g] = t.id));
    });
  }
  function topicsOfVote(v) {
    const out = new Set();
    (v.tags || []).forEach((g) => { const id = D.tagTopic && D.tagTopic[g.toLowerCase()]; if (id) out.add(id); });
    const L = linkFor(v.id);
    [...((L && L.q.tests) || []), ...(v.tests || [])].forEach((t) => { const p = D.PM[t.p]; const id = p && D.ptTopic[p.topic]; if (id) out.add(id); });
    return [...out];
  }
  function topicsOfQuestion(id) {
    const p = D.PM[id]; if (p) return D.ptTopic[p.topic] ? [D.ptTopic[p.topic]] : [];
    const q = D.questions.find((x) => x.id === id); if (!q) return [];
    const out = new Set();
    (q.tests || []).forEach((t) => { const pp = D.PM[t.p]; if (pp && D.ptTopic[pp.topic]) out.add(D.ptTopic[pp.topic]); });
    (q.votes || []).forEach((l) => { const v = D.votes.find((x) => x.id === l.vote); if (v) topicsOfVote(v).forEach((t) => out.add(t)); });
    return [...out];
  }
  function learn(ids) {
    if (!plusOn("alerts") || !ids || !ids.length) return;
    ids.forEach((id) => (A.reads[id] = (A.reads[id] || 0) + 1));
    saveA();
  }
  // At most one gentle question at a time, and never again for 30 days after "Not now".
  function maybeAsk() {
    if (!plusOn("alerts")) return;
    const t = Object.keys(A.reads).filter((id) => D.TM[id] && !A.follow[id] && A.reads[id] >= ASK_AFTER && !(A.asked[id] && daysBetween(A.asked[id], todayISO()) < ASK_AGAIN_DAYS)).sort((a, b) => A.reads[b] - A.reads[a])[0];
    if (!t || document.getElementById("topic-ask")) return;
    const el = document.createElement("section");
    el.id = "topic-ask"; el.className = "card noprint"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Follow a topic");
    el.innerHTML = `<p style="margin:0"><strong>You've been following ${esc(D.TM[t].name)} bills.</strong> Want alerts when one comes up for a vote?</p><div class="row"><button class="btn small" type="button" data-ask="yes">Yes</button><button class="btn small ghost" type="button" data-ask="no">Not now</button></div>`;
    main.prepend(el);
    el.querySelectorAll("[data-ask]").forEach((b) => (b.onclick = () => {
      if (b.dataset.ask === "yes") { A.follow[t] = 1; toast(`Following ${D.TM[t].name}. Change it any time in My topics.`); }
      A.asked[t] = todayISO(); saveA(); el.remove();
      if (b.dataset.ask === "yes") syncPush(true);
    }));
  }
  const followed = () => Object.keys(A.follow).filter((id) => A.follow[id] && D.TM[id]);
  function alertsList() {
    const out = [], today = todayISO(), F = new Set(followed()), del = delegation();
    const recentEnough = (d) => d && daysBetween(d, today) <= ALERT_DAYS;
    for (const v of D.votes) {
      if (!recentEnough(v.date)) continue;
      const hit = topicsOfVote(v).filter((t) => F.has(t));
      if (hit.length) out.push({ key: "v:" + v.id, date: v.date, kind: "topic", topic: hit[0], href: `#/vote/${v.id}`, text: `The ${v.ch} voted on ${v.title}${v.q ? ` (${v.q.split(" · ")[0].toLowerCase()})` : ""}: ${v.result || (v.pass ? "passed" : "failed")}${v.tally ? `, ${v.tally}` : ""}.` });
      for (const m of del) {
        const c = compare(m, v);
        if (c && c.kind === "diff") out.push({ key: `d:${v.id}:${m.id}`, date: v.date, kind: "diff", href: `#/vote/${v.id}`, text: `${honor(m)} ${m.last} voted ${LABEL[c.p] || c.p} on ${v.title}, different from your answer (${c.label}).` });
        else if (v.pos[m.id] === "NV") out.push({ key: `m:${v.id}:${m.id}`, date: v.date, kind: "miss", href: `#/vote/${v.id}`, text: `${honor(m)} ${m.last} did not vote on ${v.title}.` });
      }
    }
    for (const q of D.questions) {
      if (q.status !== "upcoming") continue;
      const hit = topicsOfQuestion(q.id).filter((t) => F.has(t));
      if (hit.length) out.push({ key: "u:" + q.id + ":" + (q.expected || ""), date: today, kind: "upcoming", topic: hit[0], href: "#/charter", text: `Coming up${q.expected ? ` (${q.expected})` : ""}: ${q.bill ? q.bill.label + ", " : ""}${q.sum || q.text}` });
    }
    out.forEach((x) => (x.fresh = !A.read[x.key] && daysBetween(x.date, today) <= NEW_DAYS));
    return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (a.kind === "upcoming" ? -1 : 1));
  }
  const newAlertCount = () => (plusOn("alerts") ? alertsList().filter((x) => x.fresh).length : 0);
  async function weeklyBriefing() {
    const recent = await loadRecent(), today = todayISO();
    const week = recent.filter((r) => r.date && daysBetween(r.date, today) <= 7);
    const del = delegation();
    const keyWeek = D.votes.filter((v) => v.date && daysBetween(v.date, today) <= 7);
    const byCh = { House: week.filter((r) => r.ch === "House").length, Senate: week.filter((r) => r.ch === "Senate").length };
    const att = del.map((m) => { const rs = week.filter((r) => r.ch === m.chamber && r.votes && m.id in r.votes); return { m, n: rs.length, missed: rs.filter((r) => r.votes[m.id] === "X").length }; });
    return `<section class="card stack"><div><span class="label muted">Weekly briefing</span><h2 style="margin:2px 0">The last 7 days</h2></div>
      <p>${byCh.House + byCh.Senate ? `Congress held <strong>${byCh.House + byCh.Senate}</strong> recorded vote${byCh.House + byCh.Senate === 1 ? "" : "s"} (House ${byCh.House}, Senate ${byCh.Senate}).` : "Congress held no recorded votes."}${keyWeek.length ? ` WeHold summarized ${keyWeek.length} of them:` : ""}</p>
      ${keyWeek.length ? `<ul class="list">${keyWeek.map((v) => `<li><span><a href="#/vote/${esc(v.id)}">${esc(v.title)}</a><br><span class="muted" style="font-size:13px">${esc(v.ch)} · ${fmtDate(v.date)} · ${esc(v.q ? v.q.split(" · ")[0] + ": " : "")}${esc(v.result || "")}</span></span></li>`).join("")}</ul>` : ""}
      ${att.length ? `<div><p class="label">Your officials' attendance this week</p><ul class="list">${att.map((x) => `<li><span>${honor(x.m)} ${esc(x.m.last)}</span><span class="muted">${x.n ? `missed ${x.missed} of ${x.n}` : "no votes"}</span></li>`).join("")}</ul></div>` : ""}
      <p class="muted" style="font-size:13px">In the app-store version this arrives as a notification every Sunday.</p></section>`;
  }
  const KIND = { topic: "Topic you follow", upcoming: "Coming up", diff: "Voted differently from you", miss: "Missed vote" };
  async function viewAlerts() {
    if (!plusOn("alerts")) return plusLockedFor("Smart alerts", "Alerts when a bill on a topic you follow comes up for a vote, when your officials vote differently from your answers or miss a vote, and a weekly briefing.");
    const list = alertsList(), F = followed();
    main.innerHTML = `<header class="pagehead"><span class="eyebrow">WeHold Plus · Smart alerts</span><h1>Alerts</h1>
      <p class="lede">Built on this device from the official record, your answers and the topics you follow. WeHold never learns which side you're on.</p></header>
      <p class="row noprint"><a class="btn small ghost" href="#/topics">My topics${F.length ? ` (${F.length})` : ""}</a></p>
      ${!F.length ? `<p class="card">You're not following any topics yet. <a href="#/topics">Choose topics</a>, or keep reading and WeHold will ask before following one.</p>` : ""}
      ${!S.state ? `<p class="card"><a href="#/">Add your ZIP code</a> to get alerts about your own officials.</p>` : ""}
      ${list.length ? `<section class="stack">${list.map((x) => `<a class="card linkcard" href="${esc(x.href)}"><span class="stack" style="gap:2px"><span class="label muted">${esc(KIND[x.kind])}${x.topic ? " · " + esc(D.TM[x.topic].name) : ""} · ${fmtDate(x.date)}${x.fresh ? ` <span class="pill new">New</span>` : ""}</span><span>${esc(x.text)}</span></span><span class="go" aria-hidden="true">→</span></a>`).join("")}</section>` : `<p class="muted">No alerts from the last ${ALERT_DAYS} days.</p>`}
      <div id="briefing"></div>`;
    list.forEach((x) => (A.read[x.key] = 1)); saveA();
    const b = document.getElementById("briefing"); if (b) b.innerHTML = await weeklyBriefing();
  }
  function viewTopics() {
    if (!plusOn("alerts")) return plusLockedFor("My topics", "Choose the topics you want alerts about. Part of WeHold Plus smart alerts.");
    const learned = Object.values(A.reads).reduce((a, b) => a + b, 0);
    main.innerHTML = `<a href="#/alerts">‹ Alerts</a><header class="pagehead"><span class="eyebrow">WeHold Plus · Smart alerts</span><h1>My topics</h1>
      <p class="lede">Get alerts when a bill on these topics comes up for a vote. Following a topic says what you care about, not which side you're on.</p></header>
      <ul class="list card">${(D.topics || []).map((t) => `<li><span><strong>${esc(t.name)}</strong>${A.reads[t.id] ? `<br><span class="muted" style="font-size:13px">You've read ${A.reads[t.id]} item${A.reads[t.id] === 1 ? "" : "s"} on this</span>` : ""}</span><button class="btn small${A.follow[t.id] ? "" : " ghost"}" type="button" data-follow="${esc(t.id)}" aria-pressed="${!!A.follow[t.id]}">${A.follow[t.id] ? "Following" : "Follow"}</button></li>`).join("")}</ul>
      <section class="card"><h3>What WeHold keeps on this device</h3><p>A count of how many times you've opened or answered something on each topic (${learned} so far), the topics you follow, and which alerts you've seen. It never leaves this device and never includes your answers' direction. ${NAT() && NAT().pushAvailable ? "For phone notifications, your phone signs up for these topics with an anonymous code from Apple or Google. WeHold never learns who you are or where you live." : "When phone notifications arrive with the app-store version, your phone will sign up for topic channels with an anonymous code, so WeHold still won't know who you are."}</p>
      <button class="linkbtn" type="button" id="forget">Clear what WeHold has learned on this device</button></section>`;
    main.querySelectorAll("[data-follow]").forEach((b) => (b.onclick = () => { const id = b.dataset.follow; if (A.follow[id]) delete A.follow[id]; else { A.follow[id] = 1; delete A.asked[id]; } saveA(); syncPush(!!A.follow[id]); const y = scrollY; viewTopics(); scrollTo(0, y); }));
    document.getElementById("forget").onclick = () => { A.reads = {}; A.asked = {}; saveA(); toast("Cleared. Topics you follow are kept."); viewTopics(); };
  }
  function topicChips(v) {
    if (!plusOn("alerts")) return "";
    const ts = topicsOfVote(v); if (!ts.length) return "";
    return `<section class="card noprint"><p class="label" style="margin-top:0">Topics</p><div class="row">${ts.map((id) => `<button class="btn small${A.follow[id] ? "" : " ghost"}" type="button" data-chip="${esc(id)}" aria-pressed="${!!A.follow[id]}">${A.follow[id] ? "✓ Following " : "Follow "}${esc(D.TM[id].name)}</button>`).join("")}</div></section>`;
  }
  function bindChips(v) {
    main.querySelectorAll("[data-chip]").forEach((b) => (b.onclick = () => { const id = b.dataset.chip; if (A.follow[id]) delete A.follow[id]; else { A.follow[id] = 1; delete A.asked[id]; toast(`Following ${D.TM[id].name}.`); } saveA(); syncPush(!!A.follow[id]); viewVote(v.id); }));
  }
  function plusLockedFor(title, blurb) {
    main.innerHTML = `<header class="pagehead"><span class="eyebrow">WeHold Plus</span><h1>${esc(title)}</h1><p class="lede">${esc(blurb)} It's part of WeHold Plus, which is being tested now.</p></header><p><a class="btn" href="#/plus">About WeHold Plus</a></p>`;
  }

  // ---------- WeHold Plus: follow the money ----------
  // Facts reported to the FEC, never a judgment. No individual donor names (FEC rule): totals, gift sizes,
  // states, donor employers (added up) and the PACs that gave. PAC topic groups are WeHold's own, and say so.
  const KINDS = { leadership: "Leadership PACs (run by other politicians)", C: "Corporate PACs", W: "Corporate PACs", L: "Labor union PACs", T: "Trade association PACs", M: "Membership group PACs", V: "Cooperative PACs", nonconnected: "Independent and issue PACs", other: "Other committees" };
  const usd = (n) => { n = Number(n || 0); const a = Math.abs(n); return (n < 0 ? "−" : "") + (a >= 1e6 ? "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e4 ? "$" + Math.round(a / 1e3) + "K" : "$" + Math.round(a).toLocaleString("en-US")); };
  const share = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
  async function loadMoney(id) { D.money = D.money || {}; if (!(id in D.money)) D.money[id] = await getJSON(`data/money/${id}.json`).catch(() => null); return D.money[id]; }
  async function loadPacTopics() { if (!D.pacTopics) D.pacTopics = await getJSON("pac_topics.json").catch(() => ({})); return D.pacTopics; }
  const pacTopicMap = (t) => (t && t.pacs) || {};
  function pacByTopic(mo, map) {
    const out = {}; let grouped = 0;
    for (const p of (mo.pacs && mo.pacs.list) || []) { const t = map[p.id]; if (t && D.TM[t]) { out[t] = (out[t] || 0) + p.total; grouped += p.total; } }
    return { out, grouped };
  }
  const barRow = (label, amt, of, note) => `<li style="display:block"><span style="display:flex;justify-content:space-between;gap:8px"><span>${label}</span><span class="muted">${usd(amt)}${of ? ` · ${share(amt, of)}%` : ""}${note ? " · " + note : ""}</span></span><div class="bar" aria-hidden="true"><i style="width:${of ? Math.min(100, (100 * amt) / of) : 0}%"></i></div></li>`;
  const cycleLabel = (c) => `${c - 1}–${c}`;
  function moneyHeadline(m, mo) {
    if (!mo) return `<span class="muted">Not collected yet. Campaign finance data is gathered from the FEC over the course of a week.</span>`;
    if (mo.none) return `<span class="muted">No FEC campaign reports for the ${cycleLabel(mo.cycle)} cycle.</span>`;
    const t = mo.totals, ind = t.indItemized + t.indUnitemized;
    return `Raised <strong>${usd(t.raised)}</strong> · ${share(t.pac, t.raised)}% from PACs · ${share(t.indUnitemized, ind)}% of individual money in gifts under $200`;
  }
  async function viewMoneyHome() {
    if (!plusOn("money")) return plusLockedFor("Follow the money", "Campaign donations reported to the FEC, PACs by type and topic, and money next to related votes. Facts only.");
    const del = delegation();
    main.innerHTML = `<header class="pagehead"><span class="eyebrow">WeHold Plus · Follow the money</span><h1>Your officials' campaign money</h1>
      <p class="lede">What each campaign reported to the Federal Election Commission this election cycle. Facts only: a contribution doesn't show why anyone voted a certain way.</p></header>
      ${del.length ? `<div class="stack" id="moneyList">${del.map((m) => `<a class="card linkcard" href="#/money/${esc(m.id)}"><span class="stack" style="gap:2px"><strong style="font-size:17px">${honor(m)} ${esc(m.name)}</strong><span class="muted" style="font-size:14px" data-mh="${esc(m.id)}">Loading…</span></span><span class="go" aria-hidden="true">→</span></a>`).join("")}</div>` : `<p class="card"><a href="#/">Add your ZIP code</a> to see your own officials.</p>`}`;
    for (const m of del) { const mo = await loadMoney(m.id); const el = main.querySelector(`[data-mh="${m.id}"]`); if (el) el.innerHTML = moneyHeadline(m, mo); }
  }
  async function viewMoney(id) {
    if (!plusOn("money")) return plusLockedFor("Follow the money", "Campaign donations reported to the FEC, PACs by type and topic, and money next to related votes. Facts only.");
    const m = D.byId[id];
    if (!m) { main.innerHTML = `<p>We couldn't find that official. <a href="#/money">Back</a></p>`; return; }
    main.innerHTML = `<a href="#/member/${esc(m.id)}">‹ ${esc(m.last)}'s record</a><p class="muted">Loading campaign finance data…</p>`;
    const [mo, map] = [await loadMoney(m.id), pacTopicMap(await loadPacTopics())];
    const head = `<a href="#/member/${esc(m.id)}">‹ ${esc(m.last)}'s record</a><header class="pagehead"><span class="eyebrow">WeHold Plus · Follow the money</span><h1>${honor(m)} ${esc(m.name)}</h1>`;
    if (!mo || mo.none) { main.innerHTML = head + `<p class="lede">${moneyHeadline(m, mo)}</p></header>`; return; }
    const t = mo.totals, ind = t.indItemized + t.indUnitemized, pt = pacByTopic(mo, map), P = mo.pacs || { list: [], byKind: {}, total: 0 };
    const kinds = Object.entries(P.byKind || {}).reduce((acc, [k, v]) => { const n = KINDS[k] || KINDS.other; acc[n] = (acc[n] || 0) + v; return acc; }, {});
    const fecUrl = `https://www.fec.gov/data/candidate/${encodeURIComponent(mo.fec)}/?cycle=${mo.cycle}`;
    main.innerHTML = head + `<p class="lede">What ${esc(m.last)}'s campaign${mo.committeeName ? ` (${esc(mo.committeeName)})` : ""} reported to the FEC for the ${cycleLabel(mo.cycle)} cycle${mo.through ? `, through ${fmtDate(mo.through)}` : ""}.</p></header>
      <div class="stats">
        <div class="stat"><span class="big">${usd(t.raised)}</span><span class="muted">raised</span></div>
        <div class="stat"><span class="big">${usd(t.spent)}</span><span class="muted">spent</span></div>
        <div class="stat"><span class="big">${usd(t.cash)}</span><span class="muted">cash on hand</span></div>
      </div>
      <section class="card"><h2>Where the money came from</h2><ul class="list">
        ${barRow("Individual donors", ind, t.raised)}
        ${barRow("PACs and other committees", t.pac, t.raised)}
        ${t.party ? barRow("Political party committees", t.party, t.raised) : ""}
        ${t.self ? barRow("The candidate's own money and loans", t.self, t.raised) : ""}
        ${t.transfers ? barRow("Transfers from joint fundraising committees", t.transfers, t.raised) : ""}
      </ul></section>
      <section class="card"><h2>Gift sizes from individuals</h2><ul class="list">${(mo.sizes || []).map((s) => barRow(esc(s.label), s.total, ind)).join("")}</ul>
        <p class="muted" style="font-size:13px">Gifts under $200 include those campaigns aren't required to itemize.</p></section>
      ${mo.states && mo.states.total ? `<section class="card"><h2>Home state or elsewhere</h2><ul class="list">${barRow(`From ${esc(STATES[m.state] || m.state)}`, mo.states.home, mo.states.total)}${barRow("From other states", mo.states.total - mo.states.home, mo.states.total)}</ul>
        <p class="muted" style="font-size:13px">Itemized individual gifts (over $200), by the donor's address. Top states: ${mo.states.top.map((s) => `${esc(s.state)} ${usd(s.total)}`).join(", ")}.</p></section>` : ""}
      ${P.list.length ? `<section class="card"><h2>PACs by type</h2><ul class="list">${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => barRow(esc(k), v, P.total)).join("")}</ul>
        <p class="muted" style="font-size:13px">From each PAC's own registration with the FEC. ${P.count} PACs gave ${usd(P.total)} in contributions listed individually${P.truncated ? " (the most recent 1,000)" : ""}${t.pac > P.total * 1.02 ? `, out of ${usd(t.pac)} in PAC and committee money the campaign reported in total` : ""}.</p></section>` : ""}
      ${pt.grouped ? `<section class="card"><h2>PACs by topic</h2><ul class="list">${Object.entries(pt.out).sort((a, b) => b[1] - a[1]).map(([k, v]) => barRow(esc(D.TM[k].name), v, P.total)).join("")}</ul>
        <p class="muted" style="font-size:13px">WeHold grouped PACs by topic from their names and sponsoring organizations; the grouping is ours, the amounts are the FEC's. ${share(pt.grouped, P.total)}% of PAC money is grouped so far.</p></section>` : ""}
      ${P.list.length ? `<section class="card"><h2>Largest PAC contributors</h2><ul class="list">${P.list.slice(0, 10).map((p) => `<li><span>${p.id.startsWith("C") ? `<a href="https://www.fec.gov/data/committee/${esc(p.id)}/" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}<br><span class="muted" style="font-size:13px">${esc(KINDS[p.kind] || KINDS.other)}${map[p.id] && D.TM[map[p.id]] ? " · " + esc(D.TM[map[p.id]].name) : ""}</span></span><span class="muted">${usd(p.total)}</span></li>`).join("")}</ul></section>` : ""}
      ${mo.employers && mo.employers.length ? `<section class="card"><h2>Where individual donors work</h2><ul class="list">${mo.employers.map((e) => `<li><span>${esc(e.name)}</span><span class="muted">${usd(e.total)} · ${num(e.n)} gift${e.n === 1 ? "" : "s"}</span></li>`).join("")}</ul>
        <p class="muted" style="font-size:13px">Employers donors listed on gifts over $200, added up. Companies don't give directly to campaigns; these are their employees' personal gifts. Retired and self-employed donors aren't shown.</p></section>` : ""}
      <section class="card"><p>These are facts each campaign reported to the Federal Election Commission. A contribution doesn't show why an official voted a certain way.</p><p><a href="${esc(fecUrl)}" target="_blank" rel="noopener">See the full record on FEC.gov</a></p></section>`;
  }
  // On a vote page: PAC money in this vote's topics, for the user's officials in that chamber.
  async function moneyForVote(v) {
    if (!plusOn("money")) return;
    const ts = topicsOfVote(v), map = pacTopicMap(await loadPacTopics());
    if (!ts.length || !Object.keys(map).length) return;
    const people = delegation().filter((m) => m.chamber === v.ch);
    const rows = [];
    for (const m of people) {
      const mo = await loadMoney(m.id); if (!mo || mo.none || !mo.pacs) continue;
      const pt = pacByTopic(mo, map), amt = ts.reduce((a, t) => a + (pt.out[t] || 0), 0);
      rows.push({ m, amt, cycle: mo.cycle });
    }
    const box = document.getElementById("vote-money");
    if (!box || !rows.length || !rows.some((r) => r.amt > 0)) return;
    box.innerHTML = `<section class="card"><p class="label" style="margin-top:0">Follow the money <span class="pill new">Plus</span></p>
      <p>Campaign money from ${ts.map((t) => esc(D.TM[t].name)).join(" and ")} PACs, ${cycleLabel(rows[0].cycle)} cycle:</p>
      <ul class="list">${rows.map((r) => `<li><a href="#/money/${esc(r.m.id)}">${honor(r.m)} ${esc(r.m.last)}</a><span class="muted">${usd(r.amt)}</span></li>`).join("")}</ul>
      <p class="muted" style="font-size:13px">FEC amounts; the topic grouping is WeHold's. A contribution doesn't show why an official voted a certain way.</p></section>`;
  }

  // ---------- WeHold Plus: report card ----------
  // Built only from the user's own answers and official votes, on this device. Never a grade or a label.
  const plusOn = (f) => !!(window.WeHoldPlus && window.WeHoldPlus.isOn(f));
  function topicOf(v) {
    const ct = topicsOfVote(v)[0];
    if (ct) return D.TM[ct].name;
    const L = linkFor(v.id);
    const t = (L && (L.q.tests || [])[0]) || (v.tests || [])[0];
    if (t && D.PM[t.p]) return D.PM[t.p].topic;
    return (v.tags && v.tags[0]) || "Other";
  }
  function reportFor(m) {
    const rows = D.votes.map((v) => ({ v, c: compare(m, v) })).filter((x) => x.c).sort((a, b) => (b.v.date || "").localeCompare(a.v.date || ""));
    const topics = {}, months = {};
    for (const x of rows) {
      const t = topicOf(x.v); const mo = (x.v.date || "").slice(0, 7);
      for (const [bag, key] of [[topics, t], [months, mo]]) {
        const o = (bag[key] = bag[key] || { agree: 0, diff: 0, miss: 0 });
        o[x.c.kind] += 1;
      }
    }
    const agree = rows.filter((x) => x.c.kind === "agree").length, diff = rows.filter((x) => x.c.kind === "diff").length, miss = rows.filter((x) => x.c.kind === "miss").length;
    return { m, rows, topics, months, agree, diff, miss, n: agree + diff };
  }
  const pct = (a, n) => (n ? Math.round((100 * a) / n) : null);
  const MIN_N = 3;
  function topicBar(o) {
    const n = o.agree + o.diff;
    return `<div class="bar" role="img" aria-label="${o.agree} of ${n} matched"><i style="width:${n ? (100 * o.agree) / n : 0}%"></i><b style="width:${n ? (100 * o.diff) / n : 0}%"></b></div>`;
  }
  const fmtMonth = (ym) => (ym ? new Date(ym + "-15T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "Undated");
  function reportCardHtml(r) {
    const m = r.m, p = pct(r.agree, r.n);
    const tlist = Object.entries(r.topics).sort((a, b) => (b[1].agree + b[1].diff) - (a[1].agree + a[1].diff));
    const mlist = Object.entries(r.months).sort((a, b) => b[0].localeCompare(a[0]));
    return `<section class="card stack" id="rc-${esc(m.id)}">
      <div><span class="label muted">Report card</span><h2 style="margin:2px 0">${honor(m)} ${esc(m.name)}</h2><span class="muted">${esc(seatLine(m))} · ${esc(PARTY[m.party] || m.party)}</span></div>
      ${r.n ? `<div class="stats">
        <div class="stat"><span class="big">${r.agree} / ${r.n}</span><span class="muted">votes matched your answers${r.n >= MIN_N ? ` (${p}%)` : ""}</span></div>
        <div class="stat"><span class="big">${r.diff}</span><span class="muted">voted differently</span></div>
        <div class="stat"><span class="big">${r.miss}</span><span class="muted">compared votes missed</span></div>
      </div>
      ${r.n < MIN_N ? `<p class="muted" style="font-size:14px">Based on only ${r.n} vote${r.n === 1 ? "" : "s"} so far. Answer more questions in <a href="#/charter">My Charter</a> for a fuller picture.</p>` : ""}
      <div><p class="label">By topic</p><ul class="list">${tlist.map(([t, o]) => `<li style="display:block"><span style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(t)}</strong><span class="muted">${o.agree} of ${o.agree + o.diff} matched${o.miss ? ` · ${o.miss} missed` : ""}</span></span>${o.agree + o.diff ? topicBar(o) : ""}</li>`).join("")}</ul></div>
      <div><p class="label">Over time</p><ul class="list">${mlist.map(([mo, o]) => `<li><span>${esc(fmtMonth(mo))}</span><span class="muted">${o.agree} of ${o.agree + o.diff} matched${o.miss ? ` · ${o.miss} missed` : ""}</span></li>`).join("")}</ul></div>
      <details><summary>Every compared vote (${r.rows.length})</summary><ul class="list">${r.rows.map((x) => `<li><span><a href="#/vote/${esc(x.v.id)}">${esc(x.v.title)}</a><br><span class="muted" style="font-size:13px">${fmtDate(x.v.date)} · ${esc(x.c.label)} · voted ${esc(LABEL[x.c.p] || x.c.p)}</span></span>${x.c.kind === "agree" ? `<span class="match ok">✓ matches you</span>` : x.c.kind === "diff" ? `<span class="match no">✕ differs</span>` : `<span class="muted">Missed</span>`}</li>`).join("")}</ul></details>
      <div class="row noprint"><button class="btn small" type="button" data-img="${esc(m.id)}">Save as image</button><button class="btn small ghost" type="button" data-print>Print or save PDF</button></div>`
      : `<p class="muted">None of the questions you've answered have come to a vote by ${esc(m.last)} yet. <a href="#/charter">Answer more in My Charter</a>.</p>`}
    </section>`;
  }
  // Draw a shareable image on the device. Nothing is uploaded.
  function reportImage(r) {
    const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), m = r.m;
    const col = { bg: "#F2EBD9", ink: "#231B12", muted: "#5E5245", navy: "#1C2E4A", ochre: "#A8741F", hatch: "#DCCFB1", rule: "#D3C29E" };
    g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = col.navy; g.fillRect(0, 0, W, 14);
    const txt = (s, x, y, font, color, align = "left") => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
    const fit = (s, max, font) => { g.font = font; let t = s; while (g.measureText(t).width > max && t.length > 4) t = t.slice(0, -2); return t === s ? s : t + "…"; };
    txt("WEHOLD · REPORT CARD", 80, 110, "600 28px system-ui, sans-serif", col.muted);
    const nm = `${honor(m)} ${m.name}`, f1 = "700 64px Georgia, serif";
    txt(fit(nm, W - 160, f1), 80, 200, f1, col.ink);
    txt(fit(`${seatLine(m)} · ${PARTY[m.party] || m.party}`, W - 160, "32px system-ui, sans-serif"), 80, 255, "32px system-ui, sans-serif", col.muted);
    g.fillStyle = col.rule; g.fillRect(80, 300, W - 160, 2);
    txt(`${r.agree} of ${r.n}`, 80, 420, "700 110px Georgia, serif", col.navy);
    txt("votes matched my answers", 80, 475, "34px system-ui, sans-serif", col.ink);
    txt(`${r.diff} differed · ${r.miss} missed`, 80, 525, "30px system-ui, sans-serif", col.muted);
    let y = 620;
    txt("BY TOPIC", 80, y, "600 26px system-ui, sans-serif", col.muted); y += 30;
    const tl = Object.entries(r.topics).filter(([, o]) => o.agree + o.diff).sort((a, b) => (b[1].agree + b[1].diff) - (a[1].agree + a[1].diff));
    const ROW = 104, room = Math.floor((H - 170 - y) / ROW), shown = tl.length > room ? tl.slice(0, room - 1) : tl;
    for (const [t, o] of shown) {
      const n = o.agree + o.diff; y += 50;
      txt(fit(t, 600, "600 32px system-ui, sans-serif"), 80, y, "600 32px system-ui, sans-serif", col.ink);
      txt(`${o.agree} of ${n}`, W - 80, y, "32px system-ui, sans-serif", col.muted, "right");
      y += 20; g.fillStyle = col.hatch; g.fillRect(80, y, W - 160, 14);
      g.fillStyle = col.navy; g.fillRect(80, y, ((W - 160) * o.agree) / n, 14);
      g.fillStyle = col.ochre; g.fillRect(80 + ((W - 160) * o.agree) / n, y, ((W - 160) * o.diff) / n, 14);
      y += 34;
    }
    if (shown.length < tl.length) { y += 50; txt(`+ ${tl.length - shown.length} more topic${tl.length - shown.length === 1 ? "" : "s"} in the app`, 80, y, "30px system-ui, sans-serif", col.muted); }
    txt("Compared with my own answers to WeHold's questions.", 80, H - 120, "26px system-ui, sans-serif", col.muted);
    txt(`Official roll-call votes, checked ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`, 80, H - 82, "26px system-ui, sans-serif", col.muted);
    txt("They hold office. We hold the power. · app.weholdllc.com", 80, H - 44, "600 26px system-ui, sans-serif", col.navy);
    return c;
  }
  async function shareImage(r) {
    const c = reportImage(r);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    const name = `wehold-report-${(r.m.last || "official").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    if (blob && NAT()) { try { if (await NAT().shareImage(blob, name, "My WeHold report card")) return; } catch (e) { if (e && /cancel/i.test(e.message || "")) return; } }
    const file = blob && typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "My WeHold report card" }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Image saved.");
  }
  function plusLocked() {
    main.innerHTML = `<header class="pagehead"><span class="eyebrow">WeHold Plus</span><h1>Report card</h1><p class="lede">See how each of your officials lines up with your own answers, topic by topic and over time, and compare any two officials. It's part of WeHold Plus, which is being tested now.</p></header><p><a class="btn" href="#/plus">About WeHold Plus</a></p>`;
  }
  function bindReport(reports) {
    main.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => { const r = reports.find((x) => x.m.id === b.dataset.img); if (r) shareImage(r).catch(() => toast("Couldn't make the image on this device.")); }));
    main.querySelectorAll("[data-print]").forEach((b) => (b.onclick = () => window.print()));
  }
  function memberOptions(sel) {
    const cur = D.members.filter((m) => m.current).sort((a, b) => (a.state + a.chamber + a.last).localeCompare(b.state + b.chamber + b.last));
    return `<option value="">Choose an official</option>` + cur.map((m) => `<option value="${esc(m.id)}"${m.id === sel ? " selected" : ""}>${esc(m.last)}, ${esc(m.name)} · ${esc(m.state)} ${esc(m.chamber)}${m.chamber === "House" ? " " + (m.district || "AL") : ""} (${esc(m.party)})</option>`).join("");
  }
  function viewReport(id) {
    if (!plusOn("reportCard")) return plusLocked();
    const people = id ? [D.byId[id]].filter(Boolean) : delegation();
    const reports = people.map(reportFor);
    main.innerHTML = `<header class="pagehead"><span class="eyebrow">WeHold Plus · Report card</span><h1>${id && people[0] ? `${honor(people[0])} ${esc(people[0].last)}` : "Your officials"}</h1>
      <p class="lede">How each official's votes line up with your own answers, topic by topic and over time. Only votes on questions you've answered count. Nothing here leaves your device.</p></header>
      ${!answeredCount() ? `<p class="card">Answer a few questions in <a href="#/charter">My Charter</a> first. The report card compares officials' votes with your answers.</p>` : ""}
      ${!people.length ? `<p class="card"><a href="#/">Add your ZIP code</a> to see your own officials, or compare any two officials below.</p>` : reports.map(reportCardHtml).join("")}
      <section class="card stack noprint"><h2>Compare two officials</h2><p class="muted">Pick any two members of Congress to see how each lines up with your answers, side by side.</p>
        <label class="f" for="cmpA">First official</label><select id="cmpA">${memberOptions(people[0] && people[0].id)}</select>
        <label class="f" for="cmpB">Second official</label><select id="cmpB">${memberOptions(people[1] && people[1].id)}</select>
        <button class="btn" type="button" id="cmpGo">Compare</button></section>`;
    bindReport(reports);
    document.getElementById("cmpGo").onclick = () => {
      const a = document.getElementById("cmpA").value, b = document.getElementById("cmpB").value;
      if (!a || !b || a === b) return toast("Choose two different officials.");
      location.hash = `#/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
    };
  }
  function viewCompare(params) {
    if (!plusOn("reportCard")) return plusLocked();
    const A = D.byId[params.get("a")], B = D.byId[params.get("b")];
    if (!A || !B) { location.hash = "#/report"; return; }
    const ra = reportFor(A), rb = reportFor(B);
    const topics = [...new Set([...Object.keys(ra.topics), ...Object.keys(rb.topics)])].sort();
    const cell = (o) => (o && o.agree + o.diff ? `${o.agree} of ${o.agree + o.diff}${topicBar(o)}` : `<span class="muted">—</span>`);
    const shared = D.votes.filter((v) => v.pos[A.id] && v.pos[B.id]);
    const same = shared.filter((v) => ["Yea", "Nay"].includes(v.pos[A.id]) && v.pos[A.id] === v.pos[B.id]).length;
    const both = shared.filter((v) => ["Yea", "Nay"].includes(v.pos[A.id]) && ["Yea", "Nay"].includes(v.pos[B.id])).length;
    main.innerHTML = `<a href="#/report">‹ Report card</a>
      <header class="pagehead"><span class="eyebrow">WeHold Plus · Compare</span><h1>${esc(A.last)} and ${esc(B.last)}</h1><p class="lede">Each official's votes compared with your own answers. Officials in different chambers vote on different roll calls, so their counts can differ.</p></header>
      <div class="stats">
        <div class="stat"><span class="big">${ra.agree} / ${ra.n}</span><span class="muted">${esc(A.last)} matched you</span></div>
        <div class="stat"><span class="big">${rb.agree} / ${rb.n}</span><span class="muted">${esc(B.last)} matched you</span></div>
        ${both ? `<div class="stat"><span class="big">${same} / ${both}</span><span class="muted">key votes where they voted the same way</span></div>` : ""}
      </div>
      <section class="card"><h2>By topic</h2>${topics.length ? `<ul class="list">${topics.map((t) => `<li style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px;align-items:start"><strong>${esc(t)}</strong><span><span class="muted" style="font-size:13px;display:block">${esc(A.last)}</span>${cell(ra.topics[t])}</span><span><span class="muted" style="font-size:13px;display:block">${esc(B.last)}</span>${cell(rb.topics[t])}</span></li>`).join("")}</ul>` : `<p class="muted">Neither official has voted yet on a question you've answered. <a href="#/charter">Answer more in My Charter</a>.</p>`}</section>
      ${reportCardHtml(ra)}${reportCardHtml(rb)}`;
    bindReport([ra, rb]);
  }

  // ---------- router ----------
  function render() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    const nav = { "": "home", member: "home", write: "home", where: "where", results: "where", votes: "votes", vote: "votes", charter: "charter", about: "about", report: "home", compare: "home", alerts: "home", topics: "home", money: "home" }[parts[0] || ""];
    document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    if (parts[0] === "member") viewMember(decodeURIComponent(parts[1] || ""));
    else if (parts[0] === "votes") viewVotes();
    else if (parts[0] === "vote") viewVote(decodeURIComponent(parts[1] || ""));
    else if (parts[0] === "charter") viewCharter();
    else if (parts[0] === "write") viewWrite(decodeURIComponent(parts[1] || ""), params);
    else if (parts[0] === "about") viewAbout();
    else if (parts[0] === "where") viewWhere();
    else if (parts[0] === "money" && parts[1]) viewMoney(decodeURIComponent(parts[1]));
    else if (parts[0] === "money") viewMoneyHome();
    else if (parts[0] === "alerts") viewAlerts();
    else if (parts[0] === "topics") viewTopics();
    else if (parts[0] === "report") viewReport(decodeURIComponent(parts[1] || ""));
    else if (parts[0] === "compare") viewCompare(params);
    else if (parts[0] === "plus" && window.WeHoldPlus) window.WeHoldPlus.view(main, params, toast);
    else if (parts[0] === "results") viewResults();
    else viewHome();
    window.scrollTo(0, 0);
    if (parts[0] !== "plus") maybeAsk();
  }
  window.addEventListener("hashchange", render);
  loadData().then(() => (window.WeHoldPlus ? window.WeHoldPlus.init() : null)).then(() => { if (plusOn("alerts")) syncPush(false); }).then(render).catch(() => { main.innerHTML = `<p>WeHold couldn't load its data. Refresh the page to try again.</p>`; });
})();
