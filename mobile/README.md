# WeHold for iPhone and Android

The phone apps are the web app in `site/`, wrapped with [Capacitor](https://capacitorjs.com). Code is bundled
in the app; vote data loads live from app.weholdllc.com, so data never needs an app update.

| Piece | Where |
|---|---|
| App project | `mobile/` (iOS in `mobile/ios`, Android in `mobile/android`) |
| Phone-only features (notifications, subscriptions, sharing) | `site/native.js` (settings at the top) |
| Plus feature switches | `site/plus.js` (`beta` = testers, `paid` = subscribers, `public` = everyone) |
| Alert service | `worker/` (Cloudflare Worker + D1 database, free plan) |
| Automatic builds | `.github/workflows/mobile-build.yml` and `push-service.yml` |

No Mac needed: GitHub's Mac computers build the iPhone app. Every change to `site/` or `mobile/` builds
an Android test app (download it from the run's "Artifacts") and checks the iPhone build.

## Keys to save (GitHub → repo Settings → Secrets and variables → Actions → New repository secret)

Each build step switches on by itself once its keys are saved. Never paste keys into code or chat.

### iPhone → TestFlight (after the Apple Developer Program enrollment is approved)
1. In [App Store Connect](https://appstoreconnect.apple.com) → Apps → **+** → New App: platform iOS, name **WeHold**,
   bundle ID **com.weholdllc.wehold** (register it first at developer.apple.com → Identifiers if it isn't listed,
   with the **Push Notifications** capability ticked), SKU `wehold`.
2. App Store Connect → Users and Access → Integrations → **App Store Connect API** → Team Keys → **+**,
   name "GitHub builds", access **App Manager**. Download the `.p8` file (only once!).
3. Save these secrets:
   - `APP_STORE_CONNECT_KEY_ID` — the Key ID shown next to the key
   - `APP_STORE_CONNECT_ISSUER_ID` — the Issuer ID at the top of that page
   - `APP_STORE_CONNECT_KEY` — open the `.p8` file in Notepad and paste all of it
   - `APPLE_TEAM_ID` — developer.apple.com → Account → Membership details → Team ID
4. GitHub → Actions → **Build phone apps** → Run workflow. The build appears in TestFlight in about 15–30 minutes.

### iPhone notifications
1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+**, name "WeHold push",
   tick **Apple Push Notifications service (APNs)**, download the `.p8`.
2. Save `APNS_KEY` (paste the whole `.p8`) and `APNS_KEY_ID` (its Key ID). `APPLE_TEAM_ID` is reused.

### Android → Google Play internal testing
1. Upload key: Claude generates one for you; save `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`
   from the file it gives you, and keep that file somewhere safe.
2. Play Console → Create app **WeHold**, then upload the first `.aab` by hand once (from the run's Artifacts).
3. Google Cloud → service account with Play Console access → JSON key → save as `PLAY_SERVICE_ACCOUNT_JSON`.

### Android notifications
1. [Firebase console](https://console.firebase.google.com) → Add project "WeHold" → Add Android app,
   package **com.weholdllc.wehold** → download `google-services.json` → save its contents as `GOOGLE_SERVICES_JSON`.
2. Project settings → Service accounts → Generate new private key → save the JSON as `FCM_SERVICE_ACCOUNT`.

### Alert service (Cloudflare)
1. Cloudflare dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers**,
   add permission **Account → D1 → Edit**, zone **weholdllc.com**. Save as `CLOUDFLARE_API_TOKEN`.
2. Save your Cloudflare **Account ID** (dashboard right sidebar) as `CLOUDFLARE_ACCOUNT_ID`.
3. GitHub → Actions → **Alert service** → Run workflow. It creates the database and goes live at push.weholdllc.com.
4. Put `https://push.weholdllc.com` in `push:` at the top of `site/native.js`.

### Subscriptions (RevenueCat)
1. In App Store Connect and Play Console, create the WeHold Plus subscriptions (monthly and yearly).
2. [RevenueCat](https://app.revenuecat.com): new project, add the iOS and Android apps, create entitlement
   **plus** with both products attached, and an offering with monthly and annual packages.
3. Put the two **public** SDK keys (start with `appl_` and `goog_`) in `revenuecat:` at the top of `site/native.js`.
   These are meant to be public; they are not secrets.
4. In `site/plus.js`, set `paid: true` on each finished feature to sell it.

### Google Civic API key (polling places in the app)
The installed app's pages come from `capacitor://localhost` (iPhone) and `https://localhost` (Android).
Add both to the key's allowed websites in Google Cloud → APIs & Services → Credentials.
