"""
pulls a chess.com user's full game history into a local sqlite db.

usage:
    python fetch_games.py <username>

incremental and idempotent. only the current month and any new months
are fetched on re-run - old months on chess.com are immutable so once
you've pulled them you don't need to again.
"""

import sqlite3
import sys
import time
from datetime import datetime, timezone

import requests


DB_PATH    = "chess_data.db"
API_BASE   = "https://api.chess.com/pub"

# chess.com asks api consumers to identify themselves so they can reach out
# if your client misbehaves. swap the email if you fork this.
USER_AGENT = "ChessAnalyzer/0.1 (contact:tctant@gmail.com)"


SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    url            TEXT PRIMARY KEY,
    username       TEXT NOT NULL,
    end_time       INTEGER NOT NULL,
    time_class     TEXT,
    time_control   TEXT,
    rated          INTEGER,
    rules          TEXT,
    eco            TEXT,
    white_username TEXT,
    white_rating   INTEGER,
    white_result   TEXT,
    black_username TEXT,
    black_rating   INTEGER,
    black_result   TEXT,
    white_accuracy REAL,
    black_accuracy REAL,
    pgn            TEXT
);

CREATE INDEX IF NOT EXISTS idx_games_user_time
    ON games(username, end_time);

CREATE TABLE IF NOT EXISTS synced_months (
    username   TEXT NOT NULL,
    month      TEXT NOT NULL,
    synced_at  INTEGER NOT NULL,
    PRIMARY KEY (username, month)
);
"""


def init_db(conn):

    conn.executescript(SCHEMA)
    conn.commit()


def http_get(url):

    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def list_archive_urls(username):

    # returns one url per month the user has played in, in chronological order
    data = http_get(f"{API_BASE}/player/{username}/games/archives")
    return data.get("archives", [])


def month_from_archive_url(archive_url):

    # '.../games/2024/01' -> '2024/01'
    parts = archive_url.rstrip("/").split("/")
    return f"{parts[-2]}/{parts[-1]}"


def store_game(conn, username, game):

    accuracies = game.get("accuracies") or {}

    # the 'eco' field on chess.com games is a url to their opening page like
    # 'https://www.chess.com/openings/Caro-Kann-Defense'. we keep just the
    # slug. the actual ECO codes come from parsing the [ECO] tag in the pgn.
    eco_url  = game.get("eco")
    eco_slug = eco_url.rsplit("/", 1)[-1] if eco_url else None

    conn.execute(
        """
        INSERT OR REPLACE INTO games (
            url, username, end_time, time_class, time_control, rated, rules, eco,
            white_username, white_rating, white_result,
            black_username, black_rating, black_result,
            white_accuracy, black_accuracy, pgn
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            game["url"],
            username,
            game["end_time"],
            game.get("time_class"),
            game.get("time_control"),
            1 if game.get("rated") else 0,
            game.get("rules"),
            eco_slug,
            game["white"]["username"].lower(),
            game["white"]["rating"],
            game["white"]["result"],
            game["black"]["username"].lower(),
            game["black"]["rating"],
            game["black"]["result"],
            accuracies.get("white"),
            accuracies.get("black"),
            game.get("pgn"),
        ),
    )


def sync_user(username, conn):

    username = username.lower()
    init_db(conn)

    print(f"Listing archives for {username}...")
    archive_urls = list_archive_urls(username)
    print(f"  Found {len(archive_urls)} months of history.")

    cursor = conn.execute(
        "SELECT month FROM synced_months WHERE username = ?", (username,)
    )
    already_synced = {row[0] for row in cursor.fetchall()}

    # always re-fetch the current month - it's still being written to
    current_month = datetime.now(timezone.utc).strftime("%Y/%m")

    to_fetch = []
    for archive_url in archive_urls:
        month = month_from_archive_url(archive_url)
        if month not in already_synced or month == current_month:
            to_fetch.append((month, archive_url))

    if not to_fetch:
        print("  Nothing new to fetch.")
    else:
        print(f"  Fetching {len(to_fetch)} month(s)...")

    for i, (month, archive_url) in enumerate(to_fetch, start=1):

        print(f"  [{i}/{len(to_fetch)}] {month}", end=" ", flush=True)
        data  = http_get(archive_url)
        games = data.get("games", [])
        for game in games:
            store_game(conn, username, game)
        conn.execute(
            "INSERT OR REPLACE INTO synced_months VALUES (?, ?, ?)",
            (username, month, int(time.time())),
        )
        conn.commit()
        print(f"-> {len(games)} games")

        # chess.com's rate limit is informal - serial requests are unlimited
        # as long as you wait for each response. small sleep keeps us safely
        # in that lane in case retries fire.
        time.sleep(0.1)

    total = conn.execute(
        "SELECT COUNT(*) FROM games WHERE username = ?", (username,)
    ).fetchone()[0]
    print(f"Done. {total} total games stored for {username}.")


def main():

    if len(sys.argv) != 2:
        print("Usage: python fetch_games.py <chess.com username>", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    try:
        sync_user(sys.argv[1], conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
