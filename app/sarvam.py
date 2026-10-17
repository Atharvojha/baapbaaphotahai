"""Thin wrapper around the Sarvam SDK: chat, speech (cloned or stock voice), cloning, transcription."""

import hashlib
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from sarvamai import SarvamAI

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

CHAT_MODEL = "sarvam-105b-conversations"
STT_MODEL = "saaras:v3"
# Stock male voices used until Papa's real voice is cloned: a Hindi character persona,
# and a multilingual voice for everything else. (bulbul:v2 is deprecated.)
FALLBACK_VOICES = {"hi-IN": ("bulbul:v4-flash", "ashok_hi_character")}
FALLBACK_DEFAULT = ("bulbul:v3", "aditya")
MAX_TTS_CHARS = 900  # voice cloning rejects > 1000 chars

_THINK = re.compile(r"<think>.*?</think>", re.S)

_client = None
_client_key = None
_audio_cache: dict[str, tuple[str, str]] = {}


class MissingKey(RuntimeError):
    pass


def key_configured() -> bool:
    load_dotenv(ENV_PATH, override=True)
    return bool(os.environ.get("SARVAM_API_KEY", "").strip())


def client() -> SarvamAI:
    """Re-reads .env on every call so a key pasted in later works without a restart."""
    global _client, _client_key
    load_dotenv(ENV_PATH, override=True)
    key = os.environ.get("SARVAM_API_KEY", "").strip()
    if not key:
        raise MissingKey("SARVAM_API_KEY is empty. Paste your key into .env.")
    if key != _client_key:
        _client, _client_key = SarvamAI(api_subscription_key=key), key
    return _client


def chat(messages: list[dict], temperature: float = 0.8, max_tokens: int = 2500) -> str:
    r = client().chat.completions(
        model=CHAT_MODEL, messages=messages, temperature=temperature, max_tokens=max_tokens
    )
    return _THINK.sub("", r.choices[0].message.content or "").strip()


def chat_json(messages: list[dict], **kw):
    text = chat(messages, **kw)
    m = re.search(r"(\{.*\}|\[.*\])", text, re.S)
    if not m:
        raise ValueError(f"Model did not return JSON: {text[:200]!r}")
    return json.loads(m.group(1))


def speak(text: str, language: str, voice_id: str | None = None) -> tuple[str, str]:
    """Returns (base64 audio, mime type). Cached, since the same lines get replayed."""
    text = text.strip()[:MAX_TTS_CHARS]
    cache_key = hashlib.sha1(f"{voice_id}|{language}|{text}".encode()).hexdigest()
    if cache_key in _audio_cache:
        return _audio_cache[cache_key]

    if voice_id:
        r = client().voice_cloning.convert(
            text=text, language_code=language, voice_id=voice_id, output_audio_codec="mp3"
        )
        out = (r.audio, "audio/mpeg")
    else:
        model, speaker = FALLBACK_VOICES.get(language, FALLBACK_DEFAULT)
        r = client().text_to_speech.convert(
            text=text, language_code=language, speaker=speaker, model=model
        )
        out = (r.audios[0], "audio/wav")

    _audio_cache[cache_key] = out
    return out


def clone_voice(data: bytes, filename: str, content_type: str, language: str, name: str) -> str:
    r = client().voice_cloning.create_voice(
        file=(filename, data, content_type), name=name, language=language
    )
    return r.data.voice_id


def delete_voice(voice_id: str) -> None:
    client().voice_cloning.delete_voice(voice_id)


def transcribe(data: bytes, filename: str, content_type: str) -> str:
    r = client().speech_to_text.transcribe(
        file=(filename, data, content_type), model=STT_MODEL, language_code="unknown"
    )
    return r.transcript.strip()
