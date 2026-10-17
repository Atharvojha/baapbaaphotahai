"""Signed, stateless call state. Serverless instances share no memory, so the morning call's
progress travels with the client as a tamper-proof token instead of living in a server dict."""

import base64
import hashlib
import hmac
import json
import os
import zlib


class BadToken(ValueError):
    pass


def _secret() -> bytes:
    # SESSION_SECRET if set; otherwise derived from the Sarvam key so deploys need one less env var.
    explicit = os.environ.get("SESSION_SECRET", "").strip()
    seed = explicit or "baap-session:" + os.environ.get("SARVAM_API_KEY", "")
    return hashlib.sha256(seed.encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign(payload: dict) -> str:
    body = _b64(zlib.compress(json.dumps(payload, ensure_ascii=False).encode()))
    mac = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{mac}"


def verify(token: str) -> dict:
    try:
        body, mac = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(mac, expected):
            raise BadToken("Call token was tampered with.")
        return json.loads(zlib.decompress(_unb64(body)))
    except BadToken:
        raise
    except Exception as exc:
        raise BadToken("This call has ended. Papa will call again.") from exc
