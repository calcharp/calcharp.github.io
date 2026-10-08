#!/usr/bin/env python3
"""Pull newly rated Goodreads books into data/books.json (no historical backfill)."""
from __future__ import annotations

import colorsys
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS_PATH = ROOT / "data" / "books.json"
SYNC_PATH = ROOT / "data" / "books-sync.json"

USER_AGENT = "calcharp-books-sync/1.0 (+https://calcharp.github.io)"
RSS_PAGES = 3  # Goodreads caps ~100/page; a few pages covers growth


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def parse_gr_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return parsedate_to_datetime(text).date()
    except (TypeError, ValueError, IndexError):
        return None


def isbn10_to_13(isbn10: str) -> str | None:
    raw = re.sub(r"[^0-9Xx]", "", isbn10 or "")
    if len(raw) != 10:
        return None
    core = "978" + raw[:-1]
    total = sum((1 if i % 2 == 0 else 3) * int(d) for i, d in enumerate(core))
    check = (10 - (total % 10)) % 10
    return core + str(check)


def normalize_isbn13(isbn: str | None) -> str | None:
    raw = re.sub(r"[^0-9Xx]", "", isbn or "")
    if len(raw) == 13 and raw.isdigit():
        return raw
    if len(raw) == 10:
        return isbn10_to_13(raw)
    return None


def split_title(raw: str) -> tuple[str, str | None]:
    title = re.sub(r"\s+", " ", (raw or "").strip())
    title = re.sub(
        r"\s*\((?:Penguin|Oxford|Vintage|Modern Library)[^)]*\)\s*$",
        "",
        title,
    )
    if ":" in title:
        head, tail = title.split(":", 1)
        head, tail = head.strip(), tail.strip()
        if head and tail and len(head) >= 3:
            return head, tail
    return title, None


def hash_int(text: str) -> int:
    h = 0
    for ch in text:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def spine_for(title: str) -> dict:
    """Deterministic warm cloth-ish spine colors."""
    h = (hash_int(title) % 360) / 360.0
    s = 0.28 + (hash_int(title + ":s") % 40) / 100.0
    v = 0.28 + (hash_int(title + ":v") % 35) / 100.0
    r, g, b = colorsys.hsv_to_rgb(h, min(s, 0.62), min(v, 0.58))
    bg = (int(r * 255), int(g * 255), int(b * 255))
    edge = tuple(min(255, int(c * 1.32 + 24)) for c in bg)
    lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]
    ink = (245, 236, 220) if lum < 140 else (30, 24, 18)
    return {
        "bg": f"#{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}",
        "edge": f"#{edge[0]:02x}{edge[1]:02x}{edge[2]:02x}",
        "ink": f"#{ink[0]:02x}{ink[1]:02x}{ink[2]:02x}",
    }


def prefer_cover(url: str | None) -> str:
    cover = (url or "").strip()
    if not cover:
        return ""
    return re.sub(r"\._S[XY]\d+_\.", "._SY475_.", cover)


def fetch_json(url: str) -> dict | list | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None


def dewey_from_open_library(isbn13: str | None) -> tuple[str | None, str | None]:
    """Return (dewey, short label) from Open Library when available."""
    if not isbn13:
        return None, None
    data = fetch_json(
        "https://openlibrary.org/api/books"
        f"?bibkeys=ISBN:{urllib.parse.quote(isbn13)}&format=json&jscmd=data"
    )
    if not isinstance(data, dict):
        return None, None
    entry = data.get(f"ISBN:{isbn13}") or {}
    classes = entry.get("classifications") or {}
    deweys = classes.get("dewey_decimal_class") or []
    if not deweys:
        return None, None
    dewey = re.sub(r"[^0-9.]", "", str(deweys[0]).split()[0])
    if not dewey:
        return None, None
    subjects = entry.get("subjects") or []
    label = None
    if subjects and isinstance(subjects[0], dict):
        label = (subjects[0].get("name") or "").strip() or None
    if label and len(label) > 48:
        label = label[:45].rstrip() + "…"
    return dewey, label


def fetch_rss(user_id: str, shelf: str, page: int) -> bytes:
    url = (
        f"https://www.goodreads.com/review/list_rss/{user_id}"
        f"?shelf={urllib.parse.quote(shelf)}&page={page}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def iter_rss_items(user_id: str, shelf: str):
    seen_ids: set[str] = set()
    for page in range(1, RSS_PAGES + 1):
        try:
            raw = fetch_rss(user_id, shelf, page)
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and page > 1:
                break
            raise
        root = ET.fromstring(raw)
        items = root.findall("./channel/item")
        if not items:
            break
        for item in items:
            book_id = (item.findtext("book_id") or "").strip()
            if not book_id or book_id in seen_ids:
                continue
            seen_ids.add(book_id)
            yield item
        if len(items) < 20:
            break


def event_date(item: ET.Element) -> date | None:
    return parse_gr_date(item.findtext("user_read_at")) or parse_gr_date(
        item.findtext("user_date_added")
    )


def item_to_book(item: ET.Element) -> dict:
    book_id = (item.findtext("book_id") or "").strip()
    raw_title = (item.findtext("title") or "").strip()
    title, subtitle = split_title(raw_title)
    author = re.sub(r"\s+", " ", (item.findtext("author_name") or "").strip())
    rating = int(float(item.findtext("user_rating") or 0))
    cover = prefer_cover(
        item.findtext("book_large_image_url")
        or item.findtext("book_medium_image_url")
        or item.findtext("book_image_url")
    )
    isbn13 = normalize_isbn13(item.findtext("isbn"))
    book = {
        "id": book_id,
        "title": title or raw_title or "Untitled",
        "author": author,
        "cover": cover,
        "url": f"https://www.goodreads.com/book/show/{book_id}",
        "rating": rating,
        "spine": spine_for(title or book_id),
        "spineSource": "pending",
    }
    if subtitle:
        book["subtitle"] = subtitle
    if isbn13:
        book["isbn13"] = isbn13
    dewey, dewey_label = dewey_from_open_library(isbn13)
    if dewey:
        book["dewey"] = dewey
        if dewey_label:
            book["deweyLabel"] = dewey_label
    return book


def dewey_sort_key(book: dict) -> tuple:
    # Numeric-aware: 519.5 before 530.8 before 999
    raw = str(book.get("dewey") or "999")
    parts: list[int] = []
    for chunk in raw.split("."):
        digits = re.sub(r"\D", "", chunk)
        parts.append(int(digits) if digits else 0)
    while len(parts) < 3:
        parts.append(0)
    return (tuple(parts), book.get("title") or "")


def sync() -> int:
    cfg = load_json(
        SYNC_PATH,
        {
            "goodreads_user_id": "194048917",
            "shelf": "read",
            "min_rating": 4,
            "since": date.today().isoformat(),
        },
    )
    user_id = str(cfg.get("goodreads_user_id") or "194048917")
    shelf = str(cfg.get("shelf") or "read")
    min_rating = int(cfg.get("min_rating") or 4)
    since = date.fromisoformat(str(cfg.get("since") or date.today().isoformat()))

    books = load_json(BOOKS_PATH, [])
    if not isinstance(books, list):
        raise SystemExit("data/books.json must be a JSON array")

    existing = {str(b.get("id")) for b in books if isinstance(b, dict) and b.get("id")}
    added: list[dict] = []

    for item in iter_rss_items(user_id, shelf):
        book_id = (item.findtext("book_id") or "").strip()
        if not book_id or book_id in existing:
            continue
        try:
            rating = int(float(item.findtext("user_rating") or 0))
        except ValueError:
            continue
        if rating < min_rating:
            continue
        when = event_date(item)
        if when is None or when < since:
            continue
        book = item_to_book(item)
        books.append(book)
        existing.add(book_id)
        added.append(book)
        print(f"add {rating}* [{when.isoformat()}] {book['title']} — {book['author']}")

    if added:
        books.sort(key=dewey_sort_key)
        save_json(BOOKS_PATH, books)

    cfg["last_run"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cfg["last_added"] = [b["id"] for b in added]
    cfg["last_added_count"] = len(added)
    save_json(SYNC_PATH, cfg)

    print(f"done: added {len(added)} book(s); shelf now {len(books)}")
    return len(added)


if __name__ == "__main__":
    sync()
