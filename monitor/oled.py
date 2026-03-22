#!/usr/bin/env python3
"""NanoClaw OLED status display — rotates through 3 pages on a 128×64 SSD1306."""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from luma.core.interface.serial import i2c
from luma.oled.device import ssd1306
from PIL import Image, ImageDraw, ImageFont

DATA_DIR = os.environ.get("NANOCLAW_DATA_DIR", "./data")
STATUS_PATH = Path(DATA_DIR) / "status.json"

PAGE_DURATION = 5  # seconds per page
NUM_PAGES = 3

# I2C setup
serial = i2c(port=1, address=0x3C)
device = ssd1306(serial)

# Font — use default bitmap font
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 11)
    font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 10)
except OSError:
    font = ImageFont.load_default()
    font_sm = font


def read_status() -> dict | None:
    try:
        return json.loads(STATUS_PATH.read_text())
    except Exception:
        return None


def format_uptime(seconds: int) -> str:
    d = seconds // 86400
    h = (seconds % 86400) // 3600
    m = (seconds % 3600) // 60
    if d > 0:
        return f"{d}d {h}h {m}m"
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"


def format_next_run(iso: str | None) -> str:
    if not iso:
        return "?"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
        now = datetime.now().astimezone()
        if dt.date() == now.date():
            return dt.strftime("%H:%M")
        return dt.strftime("%a %H:%M")
    except Exception:
        return "?"


def time_ago(iso: str | None) -> str:
    if not iso:
        return "?"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        diff = int((datetime.now(timezone.utc) - dt).total_seconds())
        if diff < 60:
            return f"{diff}s ago"
        if diff < 3600:
            return f"{diff // 60}m ago"
        return f"{diff // 3600}h ago"
    except Exception:
        return "?"


def draw_page(lines: list[str]) -> Image.Image:
    """Render up to 5 lines on a 128×64 canvas."""
    img = Image.new("1", (128, 64), 0)
    draw = ImageDraw.Draw(img)
    y = 0
    for i, line in enumerate(lines[:5]):
        f = font if i == 0 else font_sm
        draw.text((0, y), line, font=f, fill=1)
        y += 13 if i == 0 else 11
    return img


def page_agent(s: dict) -> list[str]:
    q = s.get("queue", {})
    active = q.get("activeCount", 0)
    mx = q.get("maxConcurrent", 5)
    wait = q.get("waitingCount", 0)
    channels = s.get("channels", [])
    ok = sum(1 for c in channels if c.get("connected"))
    total = len(channels)
    return [
        "NanoClaw",
        f"Agents: {active}/{mx} active",
        f"Wait:   {wait} group{'s' if wait != 1 else ''}",
        f"Ch: {ok}/{total} ok",
    ]


def page_system(s: dict) -> list[str]:
    sys = s.get("system", {})
    temp = sys.get("tempC")
    temp_str = f"{temp:.1f} C" if temp is not None else "n/a"
    load = sys.get("loadAvg1", 0.0)
    used = sys.get("memUsedMb", 0)
    total = sys.get("memTotalMb", 0)
    uptime = format_uptime(s.get("uptimeSeconds", 0))
    return [
        "System",
        f"Temp:  {temp_str}",
        f"CPU:   {load:.2f} load",
        f"RAM:   {used}/{total}M",
        f"Up: {uptime}",
    ]


def page_activity(s: dict) -> list[str]:
    written_at = s.get("writtenAt")
    last_msg = time_ago(written_at)
    tasks = s.get("upcomingTasks", [])
    task_count = len(tasks)
    next_task = tasks[0] if tasks else None
    next_str = "none"
    if next_task:
        when = format_next_run(next_task.get("nextRun"))
        folder = (next_task.get("groupFolder") or "")[:8]
        next_str = f"{when} {folder}"
    return [
        "Activity",
        f"Updated: {last_msg}",
        f"Tasks: {task_count} upcoming",
        f"Next: {next_str}",
    ]


def render_error(msg: str) -> None:
    img = Image.new("1", (128, 64), 0)
    draw = ImageDraw.Draw(img)
    draw.text((0, 0), "NanoClaw", font=font, fill=1)
    draw.text((0, 14), msg[:20], font=font_sm, fill=1)
    device.display(img)


page_fns = [page_agent, page_system, page_activity]
page_idx = 0

while True:
    s = read_status()
    if s is None:
        render_error("No status.json")
    else:
        lines = page_fns[page_idx](s)
        img = draw_page(lines)
        device.display(img)
        page_idx = (page_idx + 1) % NUM_PAGES

    time.sleep(PAGE_DURATION)
