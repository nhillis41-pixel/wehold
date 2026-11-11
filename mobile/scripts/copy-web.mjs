// Copy the web app (site/) into www/ for the phone app. The installed app loads its vote data live from
// app.weholdllc.com; the copied data/ folder is only a fallback for the first launch without a connection.
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "..", "site");
const www = join(here, "..", "www");
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(site, www, { recursive: true, filter: (src) => !src.includes(`${join("site", "data", "zips")}`) });
// Mark the bundle so the app knows it is running inside the phone app.
const idx = join(www, "index.html");
writeFileSync(idx, readFileSync(idx, "utf8").replace("<head>", '<head>\n<script>window.WEHOLD_NATIVE = true; window.WEHOLD_REMOTE = "https://app.weholdllc.com/";</script>'));
console.log("Copied site/ to www/");
