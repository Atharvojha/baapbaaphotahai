"""Today's events from a Google Calendar secret iCal address (read-only, no OAuth app needed)."""

from datetime import datetime, timedelta

import httpx
import icalendar
import recurring_ical_events


def _today_bounds() -> tuple[datetime, datetime]:
    start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def _as_local(value, fallback: datetime) -> tuple[datetime, bool]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=fallback.tzinfo)
        return value.astimezone(), False
    # A plain date means an all-day event.
    return fallback, True


def fetch_today(ics_url: str) -> list[dict]:
    url = ics_url.strip().replace("webcal://", "https://", 1)
    r = httpx.get(url, timeout=15, follow_redirects=True)
    r.raise_for_status()
    cal = icalendar.Calendar.from_ical(r.content)
    day_start, day_end = _today_bounds()

    events = []
    for ev in recurring_ical_events.of(cal).between(day_start, day_end):
        start, all_day = _as_local(ev["DTSTART"].dt, day_start)
        end_raw = ev.get("DTEND")
        end, _ = _as_local(end_raw.dt, day_end) if end_raw else (start + timedelta(hours=1), False)
        events.append(
            {
                "id": f"{ev.get('UID', '')}-{start.isoformat()}",
                "title": str(ev.get("SUMMARY", "(no title)")),
                "location": str(ev.get("LOCATION", "")),
                "start": start.isoformat(),
                "end": end.isoformat(),
                "all_day": all_day,
            }
        )
    return sorted(events, key=lambda e: e["start"])


def demo_today() -> list[dict]:
    """A believable IIITH day, so the app is usable before a calendar is connected."""
    day_start, _ = _today_bounds()
    rows = [
        ("07:45", 45, "Breakfast @ Yuktahar mess", "Yuktahar"),
        ("08:30", 90, "Operating Systems lecture", "H-105, Himalaya"),
        ("11:00", 60, "Algorithms assignment 3 due", "Moodle"),
        ("14:00", 120, "Computer Networks lab", "Vindhya A3"),
        ("17:30", 60, "Gym", "Felicity Ground gym"),
        ("21:00", 150, "Movie night with wingies", "Hostel common room"),
    ]
    events = []
    for hhmm, minutes, title, location in rows:
        h, m = map(int, hhmm.split(":"))
        start = day_start.replace(hour=h, minute=m)
        events.append(
            {
                "id": f"demo-{hhmm}",
                "title": title,
                "location": location,
                "start": start.isoformat(),
                "end": (start + timedelta(minutes=minutes)).isoformat(),
                "all_day": False,
            }
        )
    return events
