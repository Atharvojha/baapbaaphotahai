"""BaapBaapHotaHai: FastAPI server. Stateless, so it runs the same locally and on Vercel.

Local: .venv/bin/uvicorn app.server:app --reload --port 8000
Settings live in the browser and arrive with each request; the morning call travels as a
signed token (app/tokens.py). Set APP_PASSWORD to keep strangers off your Sarvam credits.
"""

import hashlib
import hmac
import json
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError
from sarvamai.core.api_error import ApiError

from dotenv import load_dotenv

from . import baap, calendar_feed, sarvam, tokens

load_dotenv(sarvam.ENV_PATH)  # local dev; on Vercel the env vars are already set

PUBLIC = Path(__file__).resolve().parent.parent / "public"
NEEDED_CORRECT = 10

app = FastAPI(title="BaapBaapHotaHai")
_analysis_cache: dict[str, dict] = {}


class Settings(BaseModel):
    child_name: str = Field("Beta", max_length=40)
    dad_title: str = Field("Papa", max_length=30)
    language: str = "hi-IN"
    strictness: int = Field(2, ge=1, le=3)
    wake_time: str = "07:00"
    breakfast_close: str = "09:30"
    ics_url: str = ""
    voice_id: str | None = None

    def model_post_init(self, _):
        if self.language not in baap.LANGUAGES:
            self.language = "hi-IN"


def _settings_from_form(raw: str | None) -> Settings:
    try:
        return Settings(**json.loads(raw or "{}"))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(400, "Bad settings") from exc


# --- plumbing -----------------------------------------------------------------------------------


def _app_password() -> str:
    return os.environ.get("APP_PASSWORD", "").strip()


@app.middleware("http")
async def _guard_and_cache(request: Request, call_next):
    path = request.url.path
    password = _app_password()
    if password and path.startswith("/api/") and path != "/api/state":
        given = request.headers.get("x-app-password", "")
        if not hmac.compare_digest(given.encode(), password.encode()):
            return JSONResponse({"detail": "Wrong app password.", "code": "auth"}, status_code=401)
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-cache")  # always pick up edits to public/
    return response


@app.exception_handler(sarvam.MissingKey)
async def _missing_key(_: Request, exc: sarvam.MissingKey):
    return JSONResponse({"detail": str(exc), "code": "missing_key"}, status_code=503)


@app.exception_handler(ApiError)
async def _sarvam_error(_: Request, exc: ApiError):
    body = exc.body if isinstance(exc.body, (dict, str)) else str(exc.body)
    return JSONResponse({"detail": f"Sarvam API error {exc.status_code}: {body}"}, status_code=502)


@app.exception_handler(tokens.BadToken)
async def _bad_token(_: Request, exc: tokens.BadToken):
    return JSONResponse({"detail": str(exc)}, status_code=410)


@app.exception_handler(ValueError)
async def _bad_model_output(_: Request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=502)


@app.get("/api/state")
def get_state():
    return {
        "key_configured": sarvam.key_configured(),
        "auth_required": bool(_app_password()),
        "languages": list(baap.LANGUAGES),
        "defaults": Settings().model_dump(),
    }


@app.post("/api/auth")
def check_auth():
    return {"ok": True}  # the middleware already did the work


# --- Papa's voice -------------------------------------------------------------------------------


@app.get("/api/voice/script")
def voice_script(language: str = "hi-IN"):
    return {"script": baap.VOICE_SCRIPTS.get(language, baap.VOICE_SCRIPTS["en-IN"])}


@app.post("/api/voice")
async def upload_voice(
    file: UploadFile = File(...), consent: bool = Form(...), settings: str = Form("{}")
):
    if not consent:
        raise HTTPException(400, "Get Papa's permission before cloning his voice.")
    s = _settings_from_form(settings)
    data = await file.read()
    if len(data) < 10_000:
        raise HTTPException(400, "That clip is too short. Aim for 15-30 seconds of clear speech.")
    if s.voice_id:
        try:
            sarvam.delete_voice(s.voice_id)
        except ApiError:
            pass  # already gone on Sarvam's side
    content_type = (file.content_type or "audio/webm").split(";")[0]
    voice_id = sarvam.clone_voice(
        data, file.filename or "papa.webm", content_type, s.language, f"{s.dad_title} (BaapBaapHotaHai)"
    )
    return {"voice_id": voice_id}


class VoiceIn(BaseModel):
    voice_id: str


@app.post("/api/voice/delete")
def remove_voice(body: VoiceIn):
    try:
        sarvam.delete_voice(body.voice_id)
    except ApiError:
        pass
    return {"voice_id": None}


class SpeakIn(BaseModel):
    text: str
    settings: Settings = Settings()


@app.post("/api/speak")
def speak(body: SpeakIn):
    if not body.text.strip():
        raise HTTPException(400, "Nothing to say")
    s = body.settings
    audio, mime = sarvam.speak(body.text, s.language, s.voice_id)
    return {"audio": audio, "mime": mime, "cloned": bool(s.voice_id)}


# --- Calendar + daant ---------------------------------------------------------------------------


def _events(s: Settings) -> tuple[list[dict], str]:
    if not s.ics_url:
        return calendar_feed.demo_today(), "demo"
    try:
        return calendar_feed.fetch_today(s.ics_url), "google"
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, f"Could not read your calendar feed: {exc}") from exc


class TasksIn(BaseModel):
    settings: Settings = Settings()
    refresh: bool = False


@app.post("/api/tasks")
def tasks(body: TasksIn):
    s = body.settings
    events, source = _events(s)
    cache_key = hashlib.sha1(
        json.dumps([events, s.language, s.strictness, s.child_name], sort_keys=True).encode()
    ).hexdigest()
    error = None
    if body.refresh or cache_key not in _analysis_cache:
        try:
            _analysis_cache[cache_key] = baap.analyze_tasks(s.model_dump(), events)
        except sarvam.MissingKey as exc:
            error = str(exc)
    analysis = _analysis_cache.get(cache_key, {"summary": "", "items": {}})
    for e in events:
        e["daant"] = analysis["items"].get(e["id"])
    return {"source": source, "summary": analysis["summary"], "events": events, "error": error}


# --- 7 AM call ----------------------------------------------------------------------------------


class StartIn(BaseModel):
    settings: Settings = Settings()


@app.post("/api/call/start")
def start_call(body: StartIn):
    s = body.settings.model_dump()
    events, _ = _events(body.settings)
    script = baap.morning_call(s, events)
    quiz = {"i": 0, "asked": 0, "correct": 0, **script}
    return {
        "token": tokens.sign(quiz),
        "intro": script["intro"],
        "needed": NEEDED_CORRECT,
        "question": {"index": 0, "q": script["questions"][0]["q"]},
    }


@app.post("/api/call/answer")
async def answer(
    token: str = Form(...),
    settings: str = Form("{}"),
    audio: UploadFile | None = File(None),
    text: str | None = Form(None),
):
    quiz = tokens.verify(token)
    s = _settings_from_form(settings)

    if audio is not None:
        data = await audio.read()
        content_type = (audio.content_type or "audio/webm").split(";")[0]
        transcript = sarvam.transcribe(data, audio.filename or "answer.webm", content_type)
    else:
        transcript = (text or "").strip()

    question = quiz["questions"][quiz["i"]]
    correct = baap.grade(question, transcript)
    if correct:
        quiz["correct"] += 1
    reaction = question.get("praise" if correct else "daant", "")
    quiz["i"] += 1
    quiz["asked"] += 1

    done = quiz["correct"] >= NEEDED_CORRECT
    if not done and quiz["i"] >= len(quiz["questions"]):
        # Ran out of questions before 10 right answers: Papa simply asks more.
        events, _ = _events(s)
        quiz["questions"] += baap.morning_call(s.model_dump(), events)["questions"]

    result = {
        "transcript": transcript,
        "correct": correct,
        "answer": question["answer"],
        "reaction": reaction,
        "score": quiz["correct"],
        "needed": NEEDED_CORRECT,
        "asked": quiz["asked"],
        "done": done,
    }
    if done:
        result["outro"] = quiz["outro"]
    else:
        # Drop answered questions so the token stays small.
        quiz["questions"] = quiz["questions"][quiz["i"]:]
        quiz["i"] = 0
        result["token"] = tokens.sign(quiz)
        result["question"] = {"index": result["asked"], "q": quiz["questions"][0]["q"]}
    return result


# Locally FastAPI serves the frontend; on Vercel, public/ is served by the CDN.
if PUBLIC.is_dir() and not os.environ.get("VERCEL"):
    app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="web")
