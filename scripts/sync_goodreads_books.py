#!/usr/bin/env python3
"""Pull newly rated Goodreads books into data/books.json (no historical backfill).

Goodreads discontinued RSS in October 2026. Sync now reads a library CSV export:
  My Books → Import and export → Export Library
Save/overwrite as: data/goodreads_library_export.csv
Then run: python scripts/sync_goodreads_books.py
"""
from __future__ import annotations

import colorsys
import csv
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS_PATH = ROOT / "data" / "books.json"
SYNC_PATH = ROOT / "data" / "books-sync.json"
CSV_PATH = ROOT / "data" / "goodreads_library_export.csv"

USER_AGENT = "calcharp-books-sync/1.0 (+https://calcharp.github.io)"


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def parse_csv_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def clean_isbn_field(value: str | None) -> str:
    """Goodreads wraps ISBNs as =\"978...\" spreadsheet text."""
    raw = (value or "").strip()
    raw = re.sub(r'^="?|"?$', "", raw)
    return raw.strip()


def isbn10_to_13(isbn10: str) -> str | None:
    raw = re.sub(r"[^0-9Xx]", "", isbn10 or "")
    if len(raw) != 10:
        return None
    core = "978" + raw[:-1]
    total = sum((1 if i % 2 == 0 else 3) * int(d) for i, d in enumerate(core))
    check = (10 - (total % 10)) % 10
    return core + str(check)


def normalize_isbn13(isbn: str | None) -> str | None:
    raw = re.sub(r"[^0-9Xx]", "", clean_isbn_field(isbn) or "")
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


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


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


def cover_for(book_id: str, isbn13: str | None) -> str:
    if isbn13:
        ol = fetch_json(
            "https://openlibrary.org/api/books"
            f"?bibkeys=ISBN:{urllib.parse.quote(isbn13)}&format=json&jscmd=data"
        )
        if isinstance(ol, dict):
            entry = ol.get(f"ISBN:{isbn13}") or {}
            cover = entry.get("cover") or {}
            for key in ("large", "medium", "small"):
                if cover.get(key):
                    return prefer_cover(cover[key])
    try:
        html = fetch_text(f"https://www.goodreads.com/book/show/{book_id}")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return ""
    m = re.search(r'property="og:image"\s+content="([^"]+)"', html)
    return prefer_cover(m.group(1) if m else "")


def dewey_sort_key(book: dict) -> tuple:
    # True Dewey order: 813.52 before 813.6 (float class, not int segments)
    raw = re.sub(r"[^\d.]", "", str(book.get("dewey") or "999"))
    try:
        value = float(raw) if raw else 999.0
    except ValueError:
        value = 999.0
    return (value, book.get("title") or "")


def row_to_book(row: dict) -> dict:
    book_id = str(row.get("Book Id") or "").strip()
    raw_title = (row.get("Title") or "").strip()
    title, subtitle = split_title(raw_title)
    author = re.sub(r"\s+", " ", (row.get("Author") or "").strip())
    try:
        rating = int(float(row.get("My Rating") or 0))
    except ValueError:
        rating = 0
    isbn13 = normalize_isbn13(row.get("ISBN13")) or normalize_isbn13(row.get("ISBN"))
    cover = cover_for(book_id, isbn13)
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


def iter_csv_rows(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            yield row


def sync() -> int:
    cfg = load_json(
        SYNC_PATH,
        {
            "goodreads_user_id": "194048917",
            "shelf": "read",
            "min_rating": 4,
            "since": date.today().isoformat(),
            "csv_path": "data/goodreads_library_export.csv",
        },
    )
    shelf = str(cfg.get("shelf") or "read")
    min_rating = int(cfg.get("min_rating") or 4)
    since = date.fromisoformat(str(cfg.get("since") or date.today().isoformat()))
    csv_path = ROOT / str(cfg.get("csv_path") or "data/goodreads_library_export.csv")
    if not csv_path.is_absolute():
        # allow either repo-relative or already-rooted
        candidate = Path(cfg.get("csv_path") or CSV_PATH)
        csv_path = candidate if candidate.is_absolute() else ROOT / candidate

    if not csv_path.exists():
        raise SystemExit(
            "Goodreads RSS was discontinued in October 2026.\n"
            f"Missing CSV export: {csv_path.relative_to(ROOT)}\n"
            "Export from Goodreads: My Books → Import and export → Export Library\n"
            f"Save/overwrite that file as {csv_path.relative_to(ROOT)} and re-run."
        )

    books = load_json(BOOKS_PATH, [])
    if not isinstance(books, list):
        raise SystemExit("data/books.json must be a JSON array")

    existing = {str(b.get("id")) for b in books if isinstance(b, dict) and b.get("id")}
    added: list[dict] = []

    for row in iter_csv_rows(csv_path):
        book_id = str(row.get("Book Id") or "").strip()
        if not book_id or book_id in existing:
            continue
        exclusive = (row.get("Exclusive Shelf") or "").strip().lower()
        if exclusive and exclusive != shelf.lower():
            continue
        try:
            rating = int(float(row.get("My Rating") or 0))
        except ValueError:
            continue
        if rating < min_rating:
            continue
        when = parse_csv_date(row.get("Date Read")) or parse_csv_date(row.get("Date Added"))
        if when is None or when < since:
            continue
        book = row_to_book(row)
        books.append(book)
        existing.add(book_id)
        added.append(book)
        print(f"add {rating}* [{when.isoformat()}] {book['title']} — {book['author']}")

    books.sort(key=dewey_sort_key)
    save_json(BOOKS_PATH, books)

    cfg["last_run"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cfg["last_added"] = [b["id"] for b in added]
    cfg["last_added_count"] = len(added)
    cfg["source"] = "csv"
    cfg["csv_path"] = str(Path(cfg.get("csv_path") or "data/goodreads_library_export.csv"))
    cfg["note"] = (
        "Goodreads RSS ended Oct 2026. Place an Export Library CSV at csv_path. "
        "Only auto-add books on Exclusive Shelf matching shelf, rated >= min_rating, "
        "with Date Read/Added on or after since."
    )
    save_json(SYNC_PATH, cfg)

    print(f"done: added {len(added)} book(s); shelf now {len(books)}")
    return len(added)


if __name__ == "__main__":
    sync()
