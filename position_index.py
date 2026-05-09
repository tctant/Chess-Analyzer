"""
builds the position_moves table by replaying every games pgn and recording
(user, position, move, result) tuples for the personal opening explorer.

run after sync (or once to backfill an existing database):
    python position_index.py             # every user
    python position_index.py MooMooTNT   # one user

idempotent. tracks indexed games by url so re-runs only process new games.
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


def position_key(board):

    # drop halfmove + fullmove counters so transpositions key to the same
    # position. en passant target stays - a position with a real e.p.
    # capture available is a different position than one without.
    parts = board.fen().split(" ")
    return " ".join(parts[:4])


def ensure_schema(conn):

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS position_moves (
            username     TEXT NOT NULL,
            position_fen TEXT NOT NULL,
            move_uci     TEXT NOT NULL,
            move_san     TEXT NOT NULL,
            result       TEXT NOT NULL,
            time_class   TEXT,
            game_url     TEXT NOT NULL,
            ply          INTEGER NOT NULL,
            PRIMARY KEY (username, position_fen, game_url, ply)
        );
        CREATE INDEX IF NOT EXISTS idx_position_lookup
            ON position_moves (username, position_fen);
        CREATE INDEX IF NOT EXISTS idx_position_game
            ON position_moves (game_url);

        CREATE TABLE IF NOT EXISTS position_indexed_games (
            game_url   TEXT PRIMARY KEY,
            indexed_at INTEGER NOT NULL
        );
    """)
    conn.commit()


def index_game(conn, username, game_url, time_class, white_username, white_result, black_result, pgn):

    if not pgn:
        return 0

    try:
        game = chess.pgn.read_game(io.StringIO(pgn))
    except Exception:
        return 0
    if game is None: return 0

    user_lower = username.lower()
    user_is_white = (white_username or "").lower() == user_lower
    user_result_str = white_result if user_is_white else black_result
    bucket = analytics._classify(user_result_str)

    board = game.board()
    rows = []
    ply = 0

    for move in game.mainline_moves():

        # only record moves the user themselves played - the explorer
        # answers "what did i play here", not what got played against them
        is_users_move = board.turn == user_is_white

        if is_users_move:

            try:
                san = board.san(move)
            except Exception:
                # malformed move in a malformed pgn - bail on this game
                break
            rows.append((
                user_lower,
                position_key(board),
                move.uci(),
                san,
                bucket,
                time_class,
                game_url,
                ply,
            ))

        try:
            board.push(move)
        except Exception:
            break
        ply += 1

    if not rows: return 0

    conn.executemany(
        "INSERT OR IGNORE INTO position_moves "
        "(username, position_fen, move_uci, move_san, result, time_class, game_url, ply) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.execute(
        "INSERT OR REPLACE INTO position_indexed_games (game_url, indexed_at) VALUES (?, ?)",
        (game_url, int(time.time())),
    )
    return len(rows)


def index_user(conn, username):

    user = username.lower()
    cur = conn.execute("""
        SELECT g.url, g.time_class, g.white_username, g.white_result, g.black_result, g.pgn
        FROM games g
        LEFT JOIN position_indexed_games p ON p.game_url = g.url
        WHERE g.username = ? AND p.game_url IS NULL
    """, (user,))

    games = cur.fetchall()
    if not games:
        print(f"  {username}: nothing to index (already up to date)")
        return

    print(f"  {username}: indexing {len(games):,} games...")
    total_rows = 0
    started = time.time()
    for i, (url, tc, wu, wr, br, pgn) in enumerate(games, 1):

        n = index_game(conn, user, url, tc, wu, wr, br, pgn)
        total_rows += n

        # commit every 500 games. one big transaction holds the lock too long,
        # one-per-game is way too slow on windows.
        if i % 500 == 0:
            conn.commit()
            elapsed = time.time() - started
            rate = i / elapsed if elapsed else 0
            print(f"    {i:>6,} / {len(games):,}  ({rate:.0f} games/sec)")
    conn.commit()

    print(f"  {username}: done. {total_rows:,} position-moves recorded "
          f"in {time.time() - started:.1f}s")


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
