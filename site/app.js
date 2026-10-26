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
  const S = Object.assign({ answers: {} }, store.get());
  const save = () => store.set(S);

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  // ---------- data ----------
  const D = { members: [], byId: {}, votes: [], questions: [], att: null, meta: {}, rolls: null };
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }
  async function loadData() {
    const [m, v, a, meta] = await Promise.allSettled([getJSON("data/members.json"), getJSON("data/votes.json"), getJSON("data/attendance.json"), getJSON("data/meta.json")]);
    if (m.status === "fulfilled") { D.members = m.value; D.members.forEach((x) => (D.byId[x.id] = x)); }
    if (v.status === "fulfilled") { D.votes = v.value.votes || []; D.questions = v.value.questions || []; }
    if (a.status === "fulfilled") D.att = a.value;
    if (meta.status === "fulfilled") D.meta = meta.value;
    const up = document.getElementById("updated");
    if (D.meta.updated) up.textContent = "Votes checked " + new Date(D.meta.updated).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
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
  function linkFor(voteId) { for (const q of D.questions) for (const l of q.votes) if (l.vote === voteId) return { q, yes: l.yes }; return null; }
  function compare(m, v) {
    const L = linkFor(v.id); if (!L) return null;
    const a = S.answers[L.q.id]; if (a !== "yes" && a !== "no") return null;
    const p = v.pos[m.id]; if (!p) return null;
    if (p !== "Yea" && p !== "Nay") return { q: L.q, a, p, kind: "miss" };
    return { q: L.q, a, p, kind: (p === L.yes) === (a === "yes") ? "agree" : "diff" };
  }
  function matchStats(m) {
    const cmp = D.votes.map((v) => ({ v, c: compare(m, v) })).filter((x) => x.c);
    return { agree: cmp.filter((x) => x.c.kind === "agree"), diff: cmp.filter((x) => x.c.kind === "diff"), miss: cmp.filter((x) => x.c.kind === "miss") };
  }
  const attOf = (m) => (D.att && D.att.members[m.id]) || null;
  function attendanceLine(m) {
    const a = attOf(m);
    if (!D.att) return `<span class="muted">Attendance appears after the first data update.</span>`;
    if (!a) return `<span class="muted">No recorded votes yet this Congress.</span>`;
    const med = D.att.chambers[m.chamber].medianPct;
    return `Missed <strong>${num(a.missed)}</strong> of ${num(a.eligible)} votes (${a.pct}%)${med != null ? ` · ${m.chamber} median ${med}%` : ""}`;
  }
  const answeredCount = () => Object.values(S.answers).filter((a) => a === "yes" || a === "no").length;

  // ---------- shared bits ----------
  const SEAL = `<svg class="seal" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width=".8"/>${Array.from({ length: 13 }, (_, k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 13; const x = 60 + 45 * Math.cos(a), y = 60 + 45 * Math.sin(a); const pts = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 1.45 : 3.6, b = -Math.PI / 2 + (i * Math.PI) / 5; return `${(x + r * Math.cos(b)).toFixed(1)},${(y + r * Math.sin(b)).toFixed(1)}`; }).join(" "); return `<polygon points="${pts}" fill="currentColor"/>`; }).join("")}<path d="M40 86C50 66 66 48 88 32C84 50 70 68 46 84Z" fill="currentColor"/><path d="M40 86L33 95" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M30 90H78" stroke="currentColor"/></svg>`;
  const vpill = (p) => `<span class="v ${esc(p)}">${esc(LABEL[p] || p)}</span>`;
  function memberCard(m) {
    const ms = matchStats(m), n = ms.agree.length + ms.diff.length;
    const match = n ? `<div class="bar" aria-hidden="true"><i style="width:${(ms.agree.length / n) * 100}%"></i><b style="width:${(ms.diff.length / n) * 100}%"></b></div><span><strong>${ms.agree.length} of ${n}</strong> votes matched your stance</span>` : answeredCount() ? `<span class="muted">None of your stances have come to a vote in the ${m.chamber} yet.</span>` : `<span><a href="#/charter">Answer a few questions</a> <span class="muted">to see how often ${esc(m.last)} votes your way.</span></span>`;
    const a = attOf(m);
    return `<article class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><a class="mtitle" href="#/member/${esc(m.id)}">${honor(m)} ${esc(m.name)}</a><span class="party">${esc(PARTY[m.party] || m.party)}</span></div>
      <span class="muted">${esc(seatLine(m))}</span>
      ${upForElection(m) ? `<span class="pill" style="align-self:flex-start">Seat up for election ${fmtDate(D.meta.electionDay)}</span>` : ""}
      ${match}
      <span>${attendanceLine(m)}${a && a.speaker ? ` <span class="muted">· As Speaker, votes rarely by tradition</span>` : ""}</span>
      <div class="row"><a class="btn small" href="#/member/${esc(m.id)}">See the record</a><a class="btn small ghost" href="#/write/${esc(m.id)}">Write to ${esc(m.last)}</a></div>
    </article>`;
  }
  function voteCard(v, opts = {}) {
    const people = opts.people || delegation().filter((m) => v.pos[m.id]);
    const L = linkFor(v.id), a = L && S.answers[L.q.id], you = a === "yes" || a === "no";
    return `<article class="vote">
      <div class="slip"><span class="ch">${esc(v.ch)}</span><span>Roll ${esc(v.roll)} · ${fmtDate(v.date)}</span><span class="tally">${esc(v.tally)}</span><span>${num(v.nv)} not voting</span><span class="v ${v.pass ? "Yea" : "Nay"}" style="align-self:flex-start">${esc(v.result)}</span></div>
      <div class="body">
        <div class="row">${you ? `<span class="pill" style="background:var(--ink);color:var(--parchment)">You said ${a === "yes" ? "Yes" : "No"}</span>` : ""}${v.proc ? `<span class="pill proc">Procedural step</span>` : ""}${(v.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div>
        <h3><a href="#/vote/${esc(v.id)}" style="color:inherit;text-decoration:none">${esc(v.title)}</a></h3>
        <p class="muted" style="font-size:14px">${esc(v.q)}</p>
        <p>${esc(v.sum)}</p>
        ${v.related ? `<p class="muted" style="font-size:14px">${esc(v.related)}</p>` : ""}
        ${v.caution ? `<p class="caution">${esc(v.caution)}</p>` : ""}
        ${people.length ? `<div class="positions" aria-label="How your officials voted">${people.map((m) => { const c = you ? compare(m, v) : null; return `<span class="pos">${esc(m.last)} ${vpill(v.pos[m.id])}${c && c.kind === "agree" ? `<span class="match ok">✓ matches you</span>` : c && c.kind === "diff" ? `<span class="match no">✕ differs</span>` : ""}</span>`; }).join("")}</div>` : S.state ? "" : `<p class="muted" style="font-size:14px"><a href="#/">Add your ZIP code</a> to see how your own officials voted.</p>`}
        <div class="row" style="font-size:14px"><a href="${esc(v.rec)}" target="_blank" rel="noopener">Official roll call</a>${v.bill ? `<a href="${esc(v.bill.url)}" target="_blank" rel="noopener">${esc(v.bill.label)} on Congress.gov</a>` : ""}<a href="#/vote/${esc(v.id)}">Tell your officials where you stand</a></div>
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
      <div><label class="f" for="street">Street address</label><input id="street" type="text" autocomplete="street-address" placeholder="e.g. 400 Main St" required></div>
      <div><label class="f" for="azip">ZIP code</label><input id="azip" type="text" inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(zip || "")}" required></div>
      <button class="btn" type="submit">Find my district</button>
      <p class="muted" style="font-size:13px">Your address goes only to the U.S. Census Bureau's free lookup service to find your district. WeHold never stores it.</p>
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
        <div class="stack" style="gap:16px">
          ${SEAL}
          <p class="quote" style="font-size:18px">“We hold these truths to be self-evident…”</p>
          <h1>They hold office.<br>We hold the power.</h1>
          <p style="font-size:18px;color:var(--ink-2);max-width:34rem">See every vote your senators and representative cast, how often they show up, and how their record lines up with what you believe. Then tell them where you stand.</p>
          <form id="zipForm" class="stack" style="max-width:460px">
            <label class="f" for="zip">Your ZIP code</label>
            <div class="row" style="flex-wrap:nowrap"><input id="zip" type="text" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="postal-code" placeholder="e.g. 37902" required value="${esc(S.zip || "")}"><button class="btn" type="submit" style="white-space:nowrap">Find my officials</button></div>
            <p id="zipMsg" role="status" class="muted"></p>
          </form>
          <p class="muted" style="font-size:13px">Independent and nonpartisan. Not affiliated with any government agency or political party. Every vote comes from official House and Senate records.</p>
        </div>
        <div class="engr" role="img" aria-label="Decorative engraving pattern">${SEAL.replace('class="seal"', 'class="seal" style="width:160px;height:160px;opacity:.85"')}</div>
      </section>
      <div id="zipNext" class="stack"></div>`;
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
    main.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;border-bottom:2px solid var(--ink);padding-bottom:10px">
        <div class="stack" style="gap:2px"><span class="label muted">${esc(placeName(S.state, S.district))}</span><h1>Your Delegation</h1></div>
        <span class="quote">They work for you.</span>
      </div>
      ${days != null ? `<div class="band"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V4h8v6M10 7h4"/></svg><div class="stack" style="gap:0"><span class="k">Your next verdict</span><strong>Election Day · ${fmtDate(ed)}${days === 0 ? " · today" : ` · ${days} day${days === 1 ? "" : "s"}`}</strong><span style="opacity:.85;font-size:14px">${onBallot ? `${onBallot} of your ${del.length} officials' seats are up for election.` : "None of your officials' seats are up this time."}</span></div></div>` : ""}
      ${NO_SENATORS.has(S.state) ? `<p class="muted">${esc(STATES[S.state])} is represented in the House by a delegate, who can vote in committees but not on final passage of bills, and has no senators.</p>` : ""}
      <div class="grid">${del.map(memberCard).join("") || `<p class="muted">We couldn't find officials for this location.</p>`}</div>
      ${recent.length ? `<section class="stack"><div class="row" style="justify-content:space-between"><h2>Recently on the docket</h2><a href="#/votes">All tracked votes →</a></div>${recent.map((v) => voteCard(v)).join("")}</section>` : ""}
      <p><button class="linkbtn" id="changeLoc">Change my location</button></p>`;
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
      <div class="stack" style="text-align:center;border-top:3px double var(--ink);border-bottom:3px double var(--ink);padding:14px 0;gap:4px">
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

  function viewVotes() {
    const ch = S.ch || "all";
    const list = D.votes.filter((v) => ch === "all" || v.ch === ch);
    main.innerHTML = `
      <div class="stack" style="gap:6px"><h1>The Docket</h1><p class="muted" style="max-width:44rem">Major votes in plain English: final passage, nominations, war powers, and procedural votes that decided whether a bill could move. Each links to the official record.</p></div>
      <div class="row"><div class="seg" role="group" aria-label="Chamber">${["all", "Senate", "House"].map((c) => `<button type="button" data-ch="${c}" aria-pressed="${ch === c}">${c === "all" ? "Both chambers" : c}</button>`).join("")}</div><span class="muted">${list.length} votes</span></div>
      ${list.map((v) => voteCard(v)).join("") || `<p class="muted">No votes yet.</p>`}`;
    main.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => { S.ch = b.dataset.ch; save(); viewVotes(); }));
  }

  function viewVote(id) {
    const v = D.votes.find((x) => x.id === id);
    if (!v) { main.innerHTML = `<p>We couldn't find that vote. <a href="#/votes">See all votes</a></p>`; return; }
    const people = delegation().filter((m) => m.chamber === v.ch);
    main.innerHTML = `<a href="#/votes">‹ The Docket</a>${voteCard(v)}
      <section class="card">
        <h2>Your instruction</h2>
        <p>Tell your ${v.ch === "Senate" ? "senators" : "representative"} where you stand on ${esc(v.title)}. You write it; you send it.</p>
        ${people.length ? `<div class="row">${people.map((m) => `<a class="btn" href="#/write/${esc(m.id)}?vote=${encodeURIComponent(v.id)}">Write to ${honor(m)} ${esc(m.last)}</a>`).join("")}</div>` : `<p><a href="#/">Add your ZIP code</a> first so we know who represents you.</p>`}
      </section>`;
  }

  function viewCharter() {
    const done = answeredCount();
    main.innerHTML = `
      <div class="stack" style="gap:6px;border-bottom:2px solid var(--ink);padding-bottom:10px"><h1>My Charter</h1><p class="quote">Set down where you stand. We hold every vote your officials cast against it.</p>
      <div class="row"><div class="bar" style="flex:1;min-width:160px"><i style="width:${D.questions.length ? (done / D.questions.length) * 100 : 0}%"></i></div><strong style="font-size:14px">${done} of ${D.questions.length} answered</strong></div></div>
      ${D.questions.map((q) => { const a = S.answers[q.id]; const tied = q.votes.map((l) => D.votes.find((v) => v.id === l.vote)).filter(Boolean); return `<div class="card"><p style="font-weight:700;font-size:17px">${esc(q.text)}</p>
        <div class="seg" role="group" aria-label="Your answer">${[["yes", "Yes"], ["no", "No"], ["skip", "Not sure"]].map(([k, l]) => `<button type="button" data-q="${esc(q.id)}" data-a="${k}" aria-pressed="${a === k}">${l}</button>`).join("")}</div>
        <span class="muted" style="font-size:13px">Tied to: ${tied.map((v) => `<a href="#/vote/${esc(v.id)}">${esc(v.ch)} vote, ${fmtDate(v.date)}</a>`).join(" · ")}</span></div>`; }).join("")}
      <p class="muted" style="font-size:14px">Your answers stay on this device. They are never sent anywhere.</p>
      <div class="row"><a class="btn" href="#/">See my delegation</a><button class="linkbtn" id="clearAns">Clear my answers</button></div>`;
    main.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { S.answers[b.dataset.q] = b.dataset.a; save(); const y = scrollY; viewCharter(); scrollTo(0, y); const nb = main.querySelector(`[data-q="${b.dataset.q}"][data-a="${b.dataset.a}"]`); if (nb) nb.focus(); }));
    document.getElementById("clearAns").onclick = () => { S.answers = {}; save(); viewCharter(); };
  }

  function viewWrite(id, params) {
    const m = D.byId[id];
    if (!m) { main.innerHTML = `<p>We couldn't find that official. <a href="#/">Back</a></p>`; return; }
    const v = params.get("vote") ? D.votes.find((x) => x.id === params.get("vote")) : null;
    const st = { pos: params.get("pos") || "support", name: S.myName || "", town: S.myTown || "", topic: v ? v.title + (v.bill && !v.title.includes(v.bill.label) ? ` (${v.bill.label})` : "") : "", edited: false };
    const title = m.chamber === "Senate" ? "Senator" : m.title;
    const draft = () => {
      const stance = st.pos === "support" ? "I ask you to support" : st.pos === "oppose" ? "I ask you to oppose" : "I am still weighing";
      const topic = st.topic || "[the bill or issue]";
      return `Dear ${title} ${m.last},\n\nAs your constituent in ${st.town || "[your town]"}, ${STATES[m.state]}, I'm writing about ${topic}. ${stance} it${st.pos === "undecided" ? ", and I would like to know where you stand and why" : ""}.\n\n[In your own words: why this matters to you, your family or your community.]\n\nRespectfully,\n${st.name || "[Your name]"}\n${st.town || "[Your town]"}, ${m.state}`;
    };
    main.innerHTML = `
      <a href="${v ? "#/vote/" + esc(v.id) : "#/member/" + esc(m.id)}">‹ Back</a>
      <div class="stack" style="gap:4px"><h1>Your instruction</h1><p class="muted">To ${honor(m)} ${esc(m.name)} · ${esc(seatLine(m))}</p></div>
      <div class="grid" style="align-items:start">
        <form class="card" id="wf" onsubmit="return false">
          <div><label class="f" for="topic">What it's about</label><input id="topic" type="text" value="${esc(st.topic)}" placeholder="A bill, nomination or issue"></div>
          <div><span class="f">Your position</span><div class="seg" role="group" aria-label="Your position">${[["support", "Support"], ["oppose", "Oppose"], ["undecided", "Undecided"]].map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${st.pos === k}">${l}</button>`).join("")}</div></div>
          <div><label class="f" for="nm">Your name</label><input id="nm" type="text" autocomplete="name" value="${esc(st.name)}"></div>
          <div><label class="f" for="tw">Your town</label><input id="tw" type="text" autocomplete="address-level2" value="${esc(st.town)}"></div>
          <p class="muted" style="font-size:13px">Offices respond to constituents, so use the name and town where you live and vote.</p>
        </form>
        <div class="stack">
          <label class="f" for="letter">Your letter (edit freely)</label>
          <textarea id="letter" class="letter" rows="14"></textarea>
          <div class="row noprint">
            ${m.contact ? `<button class="btn red" type="button" id="send">Copy letter &amp; open ${esc(m.last)}'s contact form</button>` : ""}
            ${m.phone ? `<a class="btn ghost" href="tel:${esc(m.phone)}">Call ${esc(m.phone)}</a>` : ""}
            <button class="btn ghost" type="button" id="print">Print to mail</button>
          </div>
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
    f.nm.oninput = () => { st.name = S.myName = f.nm.value; save(); refresh(); };
    f.tw.oninput = () => { st.town = S.myTown = f.tw.value; save(); refresh(); };
    f.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { st.pos = b.dataset.p; f.querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", x === b)); refresh(); }));
    const send = document.getElementById("send");
    if (send) send.onclick = async () => {
      try { await navigator.clipboard.writeText(ta.value); toast("Letter copied. Paste it into the form."); } catch (e) { ta.select(); toast("Select the letter and copy it, then paste it into the form."); }
      window.open(m.contact, "_blank", "noopener");
    };
    document.getElementById("print").onclick = () => window.print();
    refresh();
  }

  function viewAbout() {
    main.innerHTML = `
      <div class="stack" style="gap:6px"><span class="eyebrow">How it works</span><h1>Answerable to no party.</h1></div>
      <div class="grid">
        <section class="card"><h3>Official sources only</h3><p>Every vote comes from the official records published by the <a href="https://clerk.house.gov/Votes" target="_blank" rel="noopener">Clerk of the House</a> and the <a href="https://www.senate.gov/legislative/votes_new.htm" target="_blank" rel="noopener">U.S. Senate</a>, checked every day. Member information comes from the public-domain <a href="https://github.com/unitedstates/congress-legislators" target="_blank" rel="noopener">congress-legislators</a> project. Bill text links go to Congress.gov.</p></section>
        <section class="card"><h3>Checked before it's published</h3><p>Each day's update adds up every member's vote on every roll call and compares the result with the official totals. Senate votes are also checked against the Senate's own vote list. If anything disagrees, nothing is published until it's fixed.</p></section>
        <section class="card"><h3>Attendance</h3><p>Counts every recorded vote a member was eligible to cast this Congress. “Not voting” counts as missed; “Present” counts as showing up. Members who joined mid-term are counted from their first vote. Absences can have many reasons, and members aren't required to give one.</p></section>
        <section class="card"><h3>Finding your officials</h3><p>Most ZIP codes sit inside one congressional district. When a ZIP crosses district lines, WeHold asks for your street address and checks it with the U.S. Census Bureau's free geocoder. Your address goes only to the Census Bureau and is never stored by WeHold.</p></section>
        <section class="card"><h3>No red team, no blue team</h3><p>Party is shown as a label, never a color. Summaries describe what a bill does; when the parties disagree, each side's main argument gets equal space. A caution appears when one vote bundles unrelated issues, so a Yea or Nay may not reflect a position on the headline.</p></section>
        <section class="card"><h3>Your data stays yours</h3><p>No account, no tracking, no ads. Your ZIP code, stances and letter details are saved only in this browser. Letters are sent by you, through each office's own contact form, phone line or mail.</p></section>
      </div>
      <p class="muted">WeHold is an independent, nonpartisan project. It is not affiliated with, endorsed by, or speaking for any government agency or political party. The code is open at <a href="https://github.com/nhillis41-pixel/wehold" target="_blank" rel="noopener">github.com/nhillis41-pixel/wehold</a>.</p>`;
  }

  // ---------- router ----------
  function render() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    const nav = { "": "home", member: "home", write: "home", votes: "votes", vote: "votes", charter: "charter", about: "about" }[parts[0] || ""];
    document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    if (parts[0] === "member") viewMember(decodeURIComponent(parts[1] || ""));
    else if (parts[0] === "votes") viewVotes();
    else if (parts[0] === "vote") viewVote(decodeURIComponent(parts[1] || ""));
    else if (parts[0] === "charter") viewCharter();
    else if (parts[0] === "write") viewWrite(decodeURIComponent(parts[1] || ""), params);
    else if (parts[0] === "about") viewAbout();
    else viewHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);
  loadData().then(render).catch(() => { main.innerHTML = `<p>WeHold couldn't load its data. Refresh the page to try again.</p>`; });
})();
