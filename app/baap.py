"""Papa's brain: persona, morning quiz, answer grading, and deciding which tasks need daant."""

import random
import re
import unicodedata
from datetime import datetime

from . import sarvam

LANGUAGES = {
    "hi-IN": "Hinglish. Write every Hindi word in Devanagari script (बेटा, उठो, फीस), never in "
    "Roman letters; only English words (class, assignment, phone, hostel, mess) stay in English. "
    "Example: 'बेटा, आठ बजे class है, phone रखो और उठो।'",
    "en-IN": "Indian English, the way a strict Indian dad speaks it",
    "te-IN": "Telugu in Telugu script, with everyday English words mixed in naturally",
    "ta-IN": "Tamil in Tamil script, with everyday English words mixed in naturally",
    "kn-IN": "Kannada in Kannada script, with everyday English words mixed in naturally",
    "ml-IN": "Malayalam in Malayalam script, with everyday English words mixed in naturally",
    "mr-IN": "Marathi in Devanagari script, with everyday English words mixed in naturally",
    "bn-IN": "Bengali in Bengali script, with everyday English words mixed in naturally",
    "gu-IN": "Gujarati in Gujarati script, with everyday English words mixed in naturally",
    "pa-IN": "Punjabi in Gurmukhi script, with everyday English words mixed in naturally",
    "od-IN": "Odia in Odia script, with everyday English words mixed in naturally",
}

MOODS = {
    1: "mildly disappointed but loving; sighs more than shouts",
    2: "properly angry with classic desi-dad taunts",
    3: "full chappal mode: theatrical, loud, over-the-top dramatic anger",
}

TOPICS = [
    "multiplication tables (13 to 19)", "squares and cubes", "percentages", "mental arithmetic",
    "Indian state capitals", "world capitals", "Indian rivers", "Indian history dates",
    "basic physics", "basic chemistry (symbols, formulas)", "biology basics",
    "Indian constitution basics", "famous Indian scientists", "units and conversions",
    "planets and space", "simple logic/sequence puzzles",
]


def persona(s: dict) -> str:
    lang = LANGUAGES.get(s["language"], LANGUAGES["hi-IN"])
    mood = MOODS.get(int(s["strictness"]), MOODS[2])
    return (
        f"You are {s['dad_title']}, the father of {s['child_name']}, who studies at IIIT Hyderabad "
        "and lives in the hostel. You are a classic Indian dad: strict, dramatic, secretly proud, "
        "obsessed with discipline, waking up early, eating breakfast, attendance and marks. You love "
        "comparing with 'Sharma ji ka beta', reminding them of the fees you pay, your own childhood "
        f"('hamare zamane mein'), and their JEE rank. Mood: {mood}.\n"
        f"Speak ONLY in {lang}.\n"
        "Everything you say is read aloud by text-to-speech: no emojis, no markdown, no asterisks, "
        "no stage directions, short punchy sentences.\n"
        "Be funny, never genuinely hurtful: no insults about looks, health, caste, religion or "
        "gender, and no violence beyond the comic chappal threat."
    )


def _schedule_context(s: dict, events: list[dict]) -> str:
    rows = [
        f"- {datetime.fromisoformat(e['start']):%H:%M} {e['title']}"
        for e in events
        if not e["all_day"]
    ]
    return (
        f"The hostel mess stops serving breakfast at {s['breakfast_close']}.\n"
        "Today's calendar:\n" + ("\n".join(rows) or "- (nothing scheduled)")
    )


def morning_call(s: dict, events: list[dict], n: int = 12) -> dict:
    """One LLM round-trip: intro line, n questions with pre-written reactions, and a sign-off."""
    topics = ", ".join(random.sample(TOPICS, 6))
    prompt = (
        f"It is {s['wake_time']} AM. You are phoning {s['child_name']} to wake them up. They will "
        f"only be allowed to go back to normal life after answering your questions.\n"
        f"{_schedule_context(s, events)}\n\n"
        f"Write {n} rapid-fire questions an Indian dad fires at a half-asleep kid to check the brain "
        f"is on. Draw from these topics today: {topics}. Each must have one short, unambiguous "
        "answer (a number, a name, or 1-3 words). Easy to medium. No trick questions.\n\n"
        "Return ONLY JSON with this shape:\n"
        '{"intro": "angry opening line when they pick up (2 sentences)",\n'
        ' "questions": [{"q": "the question as you would say it, may include a small taunt",\n'
        '                "answer": "short canonical answer in English letters/digits",\n'
        '                "praise": "one short line of grudging praise",\n'
        '                "daant": "one short scolding line that also says the right answer"}],\n'
        ' "outro": "sign-off: tell them to get up NOW, reach breakfast before it closes, and '
        'name the first important thing on today\'s calendar (2-3 sentences)"}'
    )
    data = sarvam.chat_json(
        [{"role": "system", "content": persona(s)}, {"role": "user", "content": prompt}],
        temperature=0.9,
        max_tokens=4000,
    )
    questions = [q for q in data.get("questions", []) if q.get("q") and q.get("answer")]
    if not questions:
        raise ValueError("Papa forgot to ask questions. Try again.")
    return {"intro": data.get("intro", ""), "questions": questions, "outro": data.get("outro", "")}


def _norm(text: str) -> str:
    # Devanagari/other Indic digits -> ASCII, then keep only letters and digits.
    text = "".join(str(unicodedata.digit(c)) if c.isdigit() else c for c in text)
    return re.sub(r"[^\w]", "", text.lower())


def grade(question: dict, transcript: str) -> bool:
    expected, said = _norm(question["answer"]), _norm(transcript)
    if not said:
        return False
    if expected and expected in said:
        return True
    verdict = sarvam.chat_json(
        [
            {
                "role": "system",
                "content": "You grade spoken quiz answers. The answer came through speech-to-text, so "
                "forgive spelling, transliteration (e.g. Hindi words for numbers), and filler words. "
                'Reply ONLY with JSON: {"correct": true} or {"correct": false}.',
            },
            {
                "role": "user",
                "content": f"Question: {question['q']}\nExpected answer: {question['answer']}\n"
                f"Student said: {transcript}",
            },
        ],
        temperature=0,
        max_tokens=800,
    )
    return bool(verdict.get("correct"))


def analyze_tasks(s: dict, events: list[dict]) -> dict:
    if not events:
        return {"summary": "", "items": {}}
    rows = "\n".join(
        f"{i}. {datetime.fromisoformat(e['start']):%H:%M} {e['title']}"
        + (f" ({e['location']})" if e["location"] else "")
        for i, e in enumerate(events)
    )
    prompt = (
        f"Here is {s['child_name']}'s calendar for today:\n{rows}\n\n"
        "Decide which tasks they will genuinely need YOUR scolding (daant) to actually do: things "
        "that are easy to skip or procrastinate, like early classes, breakfast, gym, assignments, "
        "deadlines, labs, studying and exams. Fun things (parties, movies, hangouts) do not need "
        "daant, although you may grumble about them.\n\n"
        "Return ONLY JSON:\n"
        '{"summary": "one line on the whole day, in your language",\n'
        ' "items": [{"i": <index>, "needs_daant": true|false,\n'
        '            "reason": "why, in plain English, max 8 words",\n'
        '            "daant": "what you will say 10 minutes before it starts (1-2 sentences, '
        'mention the task by name)"}]}'
    )
    data = sarvam.chat_json(
        [{"role": "system", "content": persona(s)}, {"role": "user", "content": prompt}],
        temperature=0.8,
        max_tokens=3000,
    )
    items = {}
    for item in data.get("items", []):
        try:
            items[events[int(item["i"])]["id"]] = {
                "needs_daant": bool(item.get("needs_daant")),
                "reason": item.get("reason", ""),
                "daant": item.get("daant", ""),
            }
        except (KeyError, IndexError, ValueError, TypeError):
            continue
    return {"summary": data.get("summary", ""), "items": items}


VOICE_SCRIPTS = {
    "hi-IN": "बेटा, सुबह सात बजे उठना है, समझे? नाश्ता छोड़ना नहीं, क्लास में सोना नहीं। "
    "हमारे ज़माने में हम पाँच बजे उठकर दूध लेने जाते थे। फीस भर रहा हूँ मैं, "
    "और तुम रात के तीन बजे तक फ़ोन चला रहे हो? कल से टाइम पे सोना, और टाइम पे उठना।",
    "en-IN": "Beta, you have to wake up at seven, understood? Don't skip breakfast, and don't "
    "sleep in class. In our days we woke up at five to fetch milk. I am paying your fees, and "
    "you are on your phone till three in the night? From tomorrow, sleep on time and wake up on time.",
}
