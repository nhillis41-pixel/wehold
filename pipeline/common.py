"""Shared helpers for the WeHold data pipeline."""
import json
import os
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data")          # parsed roll calls, kept in the repo so runs are incremental
SITE_DATA = os.path.join(ROOT, "site", "data")  # what the web app loads
CURATED = os.path.join(ROOT, "curated")

USER_AGENT = "WeHold civic data bot/1.0 (+https://github.com/nhillis41-pixel/wehold)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/xml,text/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5"}


def load_config():
    with open(os.path.join(ROOT, "config.json")) as f:
        return json.load(f)


def _bot_signer():
    import botauth
    return botauth.signer(load_config().get("botAgentOrigin", "https://nhillis41-pixel.github.io"))


class NotFound(Exception):
    pass


def fetch(url, retries=4, pause=0.4):
    """GET a URL politely. Raises NotFound on 404, RuntimeError after repeated failures."""
    last = None
    for attempt in range(retries):
        headers = dict(HEADERS)
        sg = _bot_signer()
        if sg:
            headers.update(sg.headers(url))  # Web Bot Auth: lets sites verify this is WeHold's registered bot
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            time.sleep(pause)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound(url)
            last = f"HTTP {e.code}"
        except Exception as e:  # network hiccup
            last = repr(e)
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Could not fetch {url}: {last}")


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def write_json(path, obj, compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
