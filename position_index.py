"""
builds the position_moves table by replaying every games pgn and recording
one row per (game, ply): the position, the move played from it (by either
side), which side the user was on, and how the game ended for the user.

backs both the personal tab in the analysis modal and the position explorer
page ("how many times have i reached this position and how did it go").

run after sync (or once to backfill an existing database):
    python position_index.py             # every user
    python position_index.py MooMooTNT   # one user

idempotent. tracks indexed games by url so re-runs only process new games.
sync_jobs also calls index_user after every sync so the ui stays current.
"""

from __future__ import annotations

import io
import os
import sqlite3
import sys
import time

import chess
import chess.pgn

import analytics


DB_PATH = os.environ.get("CHESS_DB_PATH", "chess_data.db")

# v1 only stored the users own moves, so positions where the opponent was
# to move never showed up. bumping this drops and rebuilds the tables.
INDEX_VERSION = 2

# positions past move 25 basically never repeat across games, and indexing
# the whole game roughly triples the table size for no real gain
MAX_PLY = 50


def position_key(board):

    # drop halfmove + fullmove counters so transpositions key to the same
    # position. python-chess only writes the e.p. square when a capture is
    # actually legal, so 1.e4 and 1.e4 via a different move order match.
    parts = board.fen().split(" ")
    return " ".join(parts[:4])


def key_from_fen(fen):

    # normalize whatever fen the frontend sends through the same path the
    # indexer uses. chess.js and python-chess disagree on when to include
    # the e.p. square, string-splitting alone isnt enough.
    try:
        return position_key(chess.Board(fen))
    except ValueError:
        return None


def ensure_schema(conn):

    conn.execute("CREATE TABLE IF NOT EXISTS position_index_meta (key TEXT PRIMARY KEY, value TEXT)")
    row = conn.execute("SELECT value FROM position_index_meta WHERE key = 'version'").fetchone()
    version = int(row[0]) if row else 0

    if version != INDEX_VERSION:
        conn.executescript("""
            DROP TABLE IF EXISTS position_moves;
            DROP TABLE IF EXISTS position_indexed_games;
        """)

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS position_moves (
            username     TEXT NOT NULL,
            position_fen TEXT NOT NULL,
            move_uci     TEXT NOT NULL,
            move_san     TEXT NOT NULL,
            by_user      INTEGER NOT NULL,
            user_color   TEXT NOT NULL,
            result       TEXT NOT NULL,
            time_class   TEXT,
            game_url     TEXT NOT NULL,
            ply          INTEGER NOT NULL,
            PRIMARY KEY (username, game_url, ply)
        );
        CREATE INDEX IF NOT EXISTS idx_position_lookup
            ON position_moves (username, position_fen);

        CREATE TABLE IF NOT EXISTS position_indexed_games (
            game_url   TEXT PRIMARY KEY,
            indexed_at INTEGER NOT NULL
        );
    """)
    conn.execute(
        "INSERT OR REPLACE INTO position_index_meta (key, value) VALUES ('version', ?)",
        (str(INDEX_VERSION),),
    )
    conn.commit()


def index_game(conn, username, game_url, time_class, white_username, white_result, black_result, pgn):

    rows = _game_rows(username, game_url, time_class, white_username, white_result, black_result, pgn)
    if rows:
        conn.executemany(
            "INSERT OR IGNORE INTO position_moves "
            "(username, position_fen, move_uci, move_san, by_user, user_color, result, time_class, game_url, ply) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )

    # mark it even when the pgn was junk, otherwise the explorer keeps
    # thinking theres unindexed work and re-kicks the indexer forever
    conn.execute(
        "INSERT OR REPLACE INTO position_indexed_games (game_url, indexed_at) VALUES (?, ?)",
        (game_url, int(time.time())),
    )
    return len(rows)


def _game_rows(username, game_url, time_class, white_username, white_result, black_result, pgn):

    if not pgn:
        return []

    try:
        game = chess.pgn.read_game(io.StringIO(pgn))
    except Exception:
        return []
    if game is None: return []

    # skip chess960 / odd starting positions, they'd never match the
    # explorer's standard start anyway
    if game.headers.get("SetUp") == "1" or "FEN" in game.headers:
        return []

    user_lower    = username.lower()
    user_is_white = (white_username or "").lower() == user_lower
    user_color    = "white" if user_is_white else "black"
    bucket        = analytics._classify(white_result if user_is_white else black_result)

    board = game.board()
    rows  = []
    ply   = 0

    for move in game.mainline_moves():

        if ply >= MAX_PLY:
            break

        try:
            san = board.san(move)
        except Exception:
            # malformed move in a malformed pgn - keep what we have
            break

        by_user = 1 if board.turn == user_is_white else 0
        rows.append((user_lower, position_key(board), move.uci(), san, by_user,
                     user_color, bucket, time_class, game_url, ply))
        board.push(move)
        ply += 1
    else:
        # game ended inside the window - record the final position with an
        # empty move so "reached this position" counts include it
        if ply < MAX_PLY:
            rows.append((user_lower, position_key(board), "", "", 0,
                         user_color, bucket, time_class, game_url, ply))

    return rows


def unindexed_count(conn, username):

    row = conn.execute("""
        SELECT COUNT(*)
        FROM games g
        LEFT JOIN position_indexed_games p ON p.game_url = g.url
        WHERE g.username = ? AND p.game_url IS NULL
    """, (username.lower(),)).fetchone()
    return row[0] if row else 0


def index_user(conn, username, on_progress=None):

    user = username.lower()
    ensure_schema(conn)
    cur = conn.execute("""
        SELECT g.url, g.time_class, g.white_username, g.white_result, g.black_result, g.pgn
        FROM games g
        LEFT JOIN position_indexed_games p ON p.game_url = g.url
        WHERE g.username = ? AND p.game_url IS NULL
    """, (user,))

    games = cur.fetchall()
    if not games:
        print(f"  {username}: nothing to index (already up to date)")
        return 0

    print(f"  {username}: indexing {len(games):,} games...")
    total_rows = 0
    started = time.time()
    for i, (url, tc, wu, wr, br, pgn) in enumerate(games, 1):

        total_rows += index_game(conn, user, url, tc, wu, wr, br, pgn)

        # commit every 500 games. one big transaction holds the lock too long,
        # one-per-game is way too slow on windows.
        if i % 500 == 0:
            conn.commit()
            elapsed = time.time() - started
            rate = i / elapsed if elapsed else 0
            print(f"    {i:>6,} / {len(games):,}  ({rate:.0f} games/sec)")
            if on_progress: on_progress(i, len(games))
    conn.commit()
    if on_progress: on_progress(len(games), len(games))

    print(f"  {username}: done. {total_rows:,} position rows recorded "
          f"in {time.time() - started:.1f}s")
    return len(games)


def main():

    target_user = sys.argv[1] if len(sys.argv) > 1 else None

    conn = sqlite3.connect(DB_PATH)
    ensure_schema(conn)

    if target_user:
        index_user(conn, target_user)
    else:
        users = [r[0] for r in conn.execute(
            "SELECT DISTINCT username FROM games"
        ).fetchall()]
        print(f"indexing {len(users)} user(s): {', '.join(users)}")
        for u in users:
            index_user(conn, u)

    conn.close()
    print("done.")


if __name__ == "__main__":
    main()
