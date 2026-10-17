# BaapBaapHotaHai

Your dad's voice, cloned with Sarvam AI, phoning you at 7 AM. The call only ends after
10 correct answers to his rapid-fire questions. He also reads your Google Calendar,
works out which tasks you'll skip without a scolding, and gives you daant 10 minutes
before each one.

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# put your key in .env:  SARVAM_API_KEY=...
.venv/bin/uvicorn app.server:app --reload --port 8000
```

Open http://localhost:8000. To use it from your phone on hostel Wi-Fi, start the server
with `--host 0.0.0.0` and open `http://<laptop-ip>:8000`. Mic recording on a phone needs
HTTPS, so for that case use a tunnel such as `ngrok http 8000`.

`hello_sarvam.py` is the one-call smoke test for your key.

## Deploy on Vercel

The app is stateless, so it runs as a single Vercel Function: settings live in your browser,
and the morning call travels as a signed token.

1. On vercel.com, choose **Add New → Project** and import this GitHub repo. Vercel detects FastAPI on its own.
2. Under **Environment Variables**, add:
   - `SARVAM_API_KEY`: your Sarvam key
   - `APP_PASSWORD`: any password. Without it, anyone with the URL can spend your Sarvam credits and use Papa's voice.
3. Click **Deploy**. Every push to `main` redeploys.

Settings are stored per browser. After cloning Papa's voice, copy the voice ID from Settings
to your other devices.

## How it uses Sarvam

| Feature | Sarvam API |
| --- | --- |
| Clone Papa's voice from one 15–30s clip | `voice_cloning.create_voice` → `voice_id` |
| Every line Papa says, in his voice | `voice_cloning.convert` (falls back to `text_to_speech` with `bulbul:v4-flash` `ashok_hi_character` for Hindi, `bulbul:v3` `aditya` otherwise before cloning) |
| Your spoken answers | `speech_to_text.transcribe` with `saaras:v3`, auto language |
| Questions, grading, and daant decisions | `chat.completions` with `sarvam-105b-conversations` |

## Layout

- `app/server.py`: FastAPI routes; serves `public/` locally (Vercel serves it from the CDN)
- `app/baap.py`: the persona, the morning-call script, answer grading, and task analysis
- `app/sarvam.py`: SDK wrapper (re-reads `.env`, so no restart needed after adding the key)
- `app/calendar_feed.py`: today's events from the Google Calendar secret iCal URL, plus a demo IIITH day
- `app/tokens.py`: HMAC-signed call state, so no server memory or database is needed
- `public/`: vanilla HTML/CSS/JS with no build step; the mascot is hand-drawn SVG in `public/baap.js`

## Limits

- The alarm runs in the browser, so keep the tab open with the screen on (it requests a wake lock).
- The calendar is read-only through the secret iCal address, so no Google OAuth app is needed.
- Only clone your dad's voice with his permission.
