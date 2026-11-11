/* WeHold Plus — feature switches and tester access. Plain JavaScript, no build step.
 *
 * HOW TO USE
 * - Turn a feature on for everyone: set `public: true` on it below.
 * - Turn a feature on for testers only: set `beta: true` (and leave public: false).
 * - Sell a finished feature: set `paid: true`. Subscribers (in the phone app, through RevenueCat) then get it.
 *   Testers keep everything marked beta. Keep `public: false` for anything that's part of Plus.
 * - Add a tester: run the code through SHA-256 (see README "WeHold Plus testers") and add the hash to TESTERS.
 * - Remove a tester: delete their line from TESTERS. Plus turns off on their device the next time the app loads.
 *
 * Tester access is checked on the device. That's fine for private testing. Paid access comes from the
 * App Store / Google Play subscription, checked through RevenueCat in native.js.
 */
(() => {
  "use strict";

  // ---------- feature switches ----------
  const FEATURES = {
    alerts:      { name: "Smart alerts",      blurb: "Notices when a bill on a topic you follow comes up for a vote, when your officials vote differently from you or miss a vote, and a Sunday briefing.", beta: true,  paid: false, public: false },
    reportCard:  { name: "Report card",       blurb: "How each of your officials lines up with you over time, topic by topic. Share it as an image or PDF, or compare any two officials.", beta: true,  paid: false, public: false },
    election:    { name: "Election mode",     blurb: "A ballot preview: your incumbents' records next to your answers, plus where and when to vote.", beta: true,  paid: false, public: false },
    money:       { name: "Follow the money",  blurb: "Campaign donations by industry next to votes on related bills, and members' stock trades. Facts only.", beta: true,  paid: false, public: false },
    billDetail:  { name: "Bill breakdown",    blurb: "Section by section in plain English: what changes, what it costs, who it affects, both sides' arguments and every vote along the way.", beta: true,  paid: false, public: false },
  };

  // Features that are built and can be opened from the Plus page.
  const LINKS = { reportCard: "#/report", alerts: "#/alerts", money: "#/money" };

  // ---------- testers: label -> SHA-256 of the invite code (uppercase, no spaces) ----------
  // Never put the codes themselves here; this file is public.
  const TESTERS = {
    "tester-1": "dc9cd0575ac32d0d232cb444ea8ee8765f926ba50166ccff2195dfe66db578fa",
    "tester-2": "0bcb0a26ac60df434ab9d89ffe7f7cc3399ce6b55ba10b825a83130a57d213b9",
    "tester-3": "2c5bfc058916d97251fa5c9a2ad3cd959fe90b19cefeb888a6241451f001073f",
    "tester-4": "5e9d1a080723c6b0a4f3a771b06f6d0e2e0411d8d741a4bca93a618c9bebf86bf",
    "tester-5": "8bc6f7adfca3dfb2e806423f3c6538886d62c595283264b06c8d156c3122f445",
  };

  // ---------- device state ----------
  const KEY = "wehold-plus";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  const keep = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  let state = load();
  let tester = null; // label of the matched tester, or null
  let subscriber = false; // active WeHold Plus subscription (phone app only)
  const N = () => window.WeHoldNative || null;

  const norm = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function match(code) {
    if (!code || !(window.crypto && crypto.subtle)) return null;
    const h = await sha256(norm(code));
    return Object.keys(TESTERS).find((k) => TESTERS[k] === h) || null;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function badge() {
    const brand = document.querySelector(".topbar .brand");
    if (!brand) return;
    let b = document.getElementById("plus-badge");
    const label = subscriber ? "Plus" : tester ? "Plus · Testing" : "";
    if (label && !b) {
      b = document.createElement("a");
      b.id = "plus-badge"; b.href = "#/plus"; b.className = "plus-badge";
      brand.insertAdjacentElement("afterend", b);
    }
    if (b) { if (label) b.textContent = label; else b.remove(); }
  }

  const Plus = {
    features: FEATURES,
    get tester() { return tester; },
    get subscriber() { return subscriber; },
    /** Is this feature available to the person using this device? */
    isOn(f) { const x = FEATURES[f]; return !!x && (x.public || (x.beta && !!tester) || (x.paid && subscriber)); },
    /** Re-check the saved code (so a removed tester loses access on the next load). */
    async init() {
      tester = await match(state.code);
      if (!tester && state.code) { delete state.code; keep(state); }
      if (N()) subscriber = await N().isSubscriber().catch(() => false);
      badge();
      return tester;
    },
    async redeem(code) {
      const t = await match(code);
      if (t) { state.code = norm(code); keep(state); tester = t; badge(); }
      return t;
    },
    leave() { delete state.code; keep(state); tester = null; badge(); },

    /** The #/plus page. `params` = URLSearchParams from the hash. */
    async view(main, params, toast) {
      const code = params && params.get("code");
      if (code) {
        const t = await this.redeem(code);
        history.replaceState(null, "", "#/plus"); // keep the code out of the address bar
        if (toast) toast(t ? "WeHold Plus testing is on for this device." : "That invite code didn't work.");
      }
      if (!tester && !subscriber) {
        const sellable = Object.keys(FEATURES).filter((k) => FEATURES[k].paid);
        const pk = N() && N().subscriptionsAvailable && sellable.length ? await N().packages() : [];
        const per = (p) => { const t = (p.packageType || "").toUpperCase(); return t === "ANNUAL" ? "year" : t === "MONTHLY" ? "month" : t === "WEEKLY" ? "week" : ""; };
        main.innerHTML = `
          <header class="pagehead"><span class="eyebrow">WeHold Plus</span><h1>${pk.length ? "Go deeper." : "Coming soon."}</h1>
          <p class="lede">WeHold will always be free: every official, every vote, attendance and plain-English summaries. Plus adds depth, never a slant.</p></header>
          ${sellable.length ? `<div class="grid">${sellable.map((k) => `<section class="card"><h3>${esc(FEATURES[k].name)}</h3><p>${esc(FEATURES[k].blurb)}</p></section>`).join("")}</div>` : ""}
          ${pk.length ? `<section class="card stack" style="max-width:30rem">
            ${pk.map((p) => `<button class="btn" type="button" data-buy="${esc(p.identifier)}">${esc(p.product.priceString)}${per(p) ? " per " + per(p) : ""}${p.product.introPrice ? " · free trial" : ""}</button>`).join("")}
            <p class="muted" style="font-size:13px">Payment is charged to your ${N().platform === "ios" ? "Apple ID" : "Google Play"} account. The subscription renews automatically unless canceled at least 24 hours before the end of the period; manage or cancel it in your account settings. <a href="terms.html">Terms of Use</a> · <a href="privacy.html">Privacy Policy</a></p>
            <button class="linkbtn" type="button" id="plus-restore">Restore purchases</button></section>`
          : `<p class="lede">${N() ? "Subscriptions open soon." : "Plus will be available as a subscription in the WeHold app for iPhone and Android."} It's being tested by a small group right now.</p>`}
          <form class="card" id="plus-form" style="max-width:30rem">
            <label class="f" for="plus-code">Have a tester invite code?</label>
            <input id="plus-code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Invite code">
            <button class="btn ghost" type="submit">Turn on testing</button>
          </form>`;
        document.getElementById("plus-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const t = await this.redeem(document.getElementById("plus-code").value);
          if (toast) toast(t ? "WeHold Plus testing is on for this device." : "That invite code didn't work.");
          if (t) this.view(main, null, toast);
        });
        main.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = async () => {
          b.disabled = true;
          try { const ok = await N().buy(b.dataset.buy); if (ok) { subscriber = true; badge(); if (toast) toast("Welcome to WeHold Plus."); this.view(main, null, toast); } }
          catch (err) { if (toast) toast((err && err.message) || "The purchase didn't go through."); }
          b.disabled = false;
        }));
        const rs = document.getElementById("plus-restore");
        if (rs) rs.onclick = async () => { const ok = await N().restore().catch(() => false); subscriber = !!ok; badge(); if (toast) toast(ok ? "WeHold Plus restored." : "No WeHold Plus subscription found for this account."); if (ok) this.view(main, null, toast); };
        return;
      }
      if (subscriber && !tester) {
        const mine = Object.keys(FEATURES).filter((k) => this.isOn(k));
        main.innerHTML = `<header class="pagehead"><span class="eyebrow">WeHold Plus</span><h1>Thanks for subscribing.</h1>
          <p class="lede">Your subscription keeps WeHold independent, with no ads and no tracking.</p></header>
          <div class="grid">${mine.map((k) => `<section class="card"><h3>${esc(FEATURES[k].name)}</h3><p>${esc(FEATURES[k].blurb)}</p>${LINKS[k] ? `<p><a class="btn small" href="${LINKS[k]}">Open</a></p>` : ""}</section>`).join("")}</div>
          <p class="actions"><a class="btn ghost small" href="${esc(N() ? N().manageUrl : "#")}" target="_blank" rel="noopener">Manage subscription</a></p>`;
        return;
      }
      const rows = Object.keys(FEATURES).map((k) => {
        const f = FEATURES[k];
        const status = f.public ? "Live for everyone" : f.beta ? "In testing" : "Not started";
        const link = LINKS[k] ? `<p><a class="btn small" href="${LINKS[k]}">Open ${esc(f.name.toLowerCase())}</a></p>` : "";
        return `<section class="card"><span class="pill${f.beta && !f.public ? " new" : ""}">${esc(status)}</span><h3>${esc(f.name)}</h3><p>${esc(f.blurb)}</p>${link}</section>`;
      }).join("");
      main.innerHTML = `
        <header class="pagehead"><span class="eyebrow">WeHold Plus · Testing</span><h1>Thanks for testing.</h1>
        <p class="lede">Plus features appear across the app as they're finished. Please keep what you see here private for now, and send problems or ideas to <a href="mailto:nathan@weholdllc.com?subject=WeHold%20Plus%20testing">nathan@weholdllc.com</a>.</p></header>
        <div class="grid">${rows}</div>
        <div class="actions"><button class="btn ghost small" type="button" id="plus-leave">Turn off testing on this device</button></div>`;
      document.getElementById("plus-leave").addEventListener("click", () => { this.leave(); if (toast) toast("Plus testing is off."); this.view(main, null, toast); });
    },
  };

  window.WeHoldPlus = Plus;
})();
