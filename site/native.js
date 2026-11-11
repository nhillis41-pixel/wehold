/* WeHold phone-app bridge: push notifications, WeHold Plus subscriptions and sharing.
 * Runs only inside the iPhone/Android app (Capacitor). On the website it does nothing.
 *
 * Settings live in NATIVE_CONFIG below:
 * - push:   address of the WeHold alert service (Cloudflare Worker in worker/). Empty = notifications off.
 * - revenuecat: RevenueCat public SDK keys (safe to publish). Empty = subscriptions off; tester codes still work.
 */
(() => {
  "use strict";
  const NATIVE_CONFIG = {
    push: "", // e.g. "https://push.weholdllc.com" once the alert service is deployed
    revenuecat: { ios: "", android: "" }, // public SDK keys from RevenueCat > Project > API keys
    entitlement: "plus", // RevenueCat entitlement that unlocks WeHold Plus
  };

  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const platform = Cap.getPlatform(); // "ios" | "android"
  const plugin = (name) => (Cap.Plugins && Cap.Plugins[name]) || (Cap.registerPlugin ? Cap.registerPlugin(name) : null);
  const Push = plugin("PushNotifications"), Purchases = plugin("Purchases"), Share = plugin("Share"), Files = plugin("Filesystem");

  const KEY = "wehold-native";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  const keep = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const st = load();

  // ---------- push notifications: anonymous topic channels ----------
  // The service receives only this device's push token and the topic ids it follows. No name, location or answers.
  let token = st.token || null, pending = null;
  async function sendTopics(topics) {
    if (!NATIVE_CONFIG.push || !token) { pending = topics; return; }
    try {
      await fetch(NATIVE_CONFIG.push.replace(/\/$/, "") + "/subscribe", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, platform, topics: topics || [] }),
      });
      st.sent = (topics || []).slice().sort().join(","); keep(st);
    } catch (e) { pending = topics; }
  }
  async function enablePush() {
    if (!Push || !NATIVE_CONFIG.push) return false;
    let perm = await Push.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await Push.requestPermissions();
    if (perm.receive !== "granted") return false;
    await Push.register();
    return true;
  }
  if (Push) {
    Push.addListener("registration", (t) => { token = t.value; st.token = token; keep(st); if (pending) { const p = pending; pending = null; sendTopics(p); } });
    Push.addListener("registrationError", () => {});
    // Tapping a notification opens the page it's about (e.g. #/vote/S-119-2-258).
    Push.addListener("pushNotificationActionPerformed", (a) => {
      const href = a && a.notification && a.notification.data && a.notification.data.href;
      if (href && /^#\//.test(href)) location.hash = href;
    });
    Push.checkPermissions().then((p) => { if (p.receive === "granted" && NATIVE_CONFIG.push) Push.register(); }).catch(() => {});
  }

  // ---------- WeHold Plus subscriptions (RevenueCat) ----------
  const rcKey = NATIVE_CONFIG.revenuecat[platform];
  let rcReady = null;
  function rc() {
    if (!Purchases || !rcKey) return Promise.resolve(false);
    if (!rcReady) rcReady = Purchases.configure({ apiKey: rcKey }).then(() => true).catch(() => false);
    return rcReady;
  }
  const active = (info) => { const ci = info && (info.customerInfo || info); return !!(ci && ci.entitlements && ci.entitlements.active && ci.entitlements.active[NATIVE_CONFIG.entitlement]); };
  async function isSubscriber() {
    if (!(await rc())) return !!st.sub; // offline or not configured: keep the last known answer
    try { const sub = active(await Purchases.getCustomerInfo()); st.sub = sub; keep(st); return sub; } catch (e) { return !!st.sub; }
  }
  async function packages() {
    if (!(await rc())) return [];
    try {
      const o = await Purchases.getOfferings();
      const cur = o && (o.current || (o.all && Object.values(o.all)[0]));
      return (cur && cur.availablePackages) || [];
    } catch (e) { return []; }
  }
  async function buy(pkgId) {
    const pk = (await packages()).find((p) => p.identifier === pkgId);
    if (!pk) throw new Error("That plan isn't available right now.");
    try { const r = await Purchases.purchasePackage({ aPackage: pk }); st.sub = active(r); keep(st); return st.sub; }
    catch (e) { if (e && (e.userCancelled || e.code === "1" || /cancel/i.test(e.message || ""))) return null; throw e; }
  }
  async function restore() {
    if (!(await rc())) return false;
    const r = await Purchases.restorePurchases(); st.sub = active(r); keep(st); return st.sub;
  }

  // ---------- sharing a picture (report card) ----------
  async function shareImage(blob, name, title) {
    if (!Share || !Files) return false;
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    const f = await Files.writeFile({ path: name, data, directory: "CACHE" });
    await Share.share({ title, files: [f.uri] });
    return true;
  }

  window.WeHoldNative = {
    platform,
    pushAvailable: !!(Push && NATIVE_CONFIG.push),
    subscriptionsAvailable: !!(Purchases && rcKey),
    enablePush, sendTopics, isSubscriber, packages, buy, restore, shareImage,
    manageUrl: platform === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions",
  };
})();
