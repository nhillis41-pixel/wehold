"""Web Bot Auth: sign WeHold's requests so sites (e.g. senate.gov via Akamai) can verify it is
really WeHold's registered bot. Implements HTTP Message Signatures (RFC 9421) as profiled by the
IETF "HTTP Message Signatures for Bots" draft: Ed25519 key, tag "web-bot-auth", covering
@authority and the Signature-Agent header.

The private key comes from the WEHOLD_BOT_KEY environment variable (a GitHub Actions secret),
base64 of the raw 32-byte Ed25519 private key. Without it, requests are sent unsigned.
"""
import base64
import hashlib
import json
import os
import time
from urllib.parse import urlsplit


def _b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def public_jwk(public_raw):
    return {"kty": "OKP", "crv": "Ed25519", "x": _b64url(public_raw)}


def jwk_thumbprint(jwk):
    # RFC 7638 / RFC 8037: required members in lexicographic order, no whitespace.
    canon = json.dumps({"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"]}, separators=(",", ":"), sort_keys=True)
    return _b64url(hashlib.sha256(canon.encode()).digest())


class Signer:
    def __init__(self, private_raw, agent_origin):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives import serialization
        self.key = Ed25519PrivateKey.from_private_bytes(private_raw)
        pub = self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.jwk = public_jwk(pub)
        self.keyid = jwk_thumbprint(self.jwk)
        self.agent = f'sig1="{agent_origin}"'

    def headers(self, url, now=None, lifetime=300):
        authority = urlsplit(url).netloc.lower()
        created = int(now if now is not None else time.time())
        params = (f'("@authority" "signature-agent";key="sig1");created={created};expires={created + lifetime}'
                  f';keyid="{self.keyid}";alg="ed25519";tag="web-bot-auth"')
        base = (f'"@authority": {authority}\n'
                f'"signature-agent";key="sig1": "{self.agent.split("=", 1)[1].strip(chr(34))}"\n'
                f'"@signature-params": {params}')
        sig = self.key.sign(base.encode())
        return {
            "Signature-Agent": self.agent,
            "Signature-Input": f"sig1={params}",
            "Signature": f"sig1=:{base64.b64encode(sig).decode()}:",
        }


_signer = None


def signer(agent_origin):
    """Return a Signer if WEHOLD_BOT_KEY is set, else None."""
    global _signer
    if _signer is None:
        raw = os.environ.get("WEHOLD_BOT_KEY", "").strip()
        if not raw:
            return None
        _signer = Signer(base64.b64decode(raw), agent_origin)
    return _signer
