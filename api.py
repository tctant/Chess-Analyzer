"""
fastapi server. wraps analytics.py as json endpoints and proxies the
opening explorer.

run locally:
    uvicorn api:app --reload

then http://localhost:8000/docs gives you the auto-generated api browser
which is genuinely the best part of fastapi.

a few decisions worth flagging:
- one sqlite connection per request, no pool. fine for one user, swap
  to a pool if this ever sees real concurrent traffic.
- cors is wide open because the dev frontend lives on a different port
  (vite 5173, this is 8000). tighten before deploy.
- sync runs in a background thread (sync_jobs.py) so the post returns
  immediately and the ui can poll for progress.
"""

from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Any

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import analytics
import sync_jobs


DB_PATH = os.environ.get("CHESS_DB_PATH", "chess_data.db")


app = FastAPI(
    title="Chess Analyzer API",
    description="Personal chess game analytics from Chess.com PubAPI data.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten before deploying anywhere public
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@contextmanager
def db_conn():

    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()


def assert_user_synced(conn: sqlite3.Connection, username: str) -> None:

    user = username.lower()
    row = conn.execute(
        "SELECT COUNT(*) FROM games WHERE username = ?", (user,)
    ).fetchone()
    if not row or row[0] == 0:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No games found for '{username}'. "
                f"Run: python fetch_games.py {username}"
            ),
        )


@app.get("/api/health")
def health() -> dict[str, str]:

    return {"status": "ok"}


@app.get("/api/users/{username}/record-by-color")
def get_record_by_color(username: str) -> dict[str, Any]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.record_by_color(conn, username)


@app.get("/api/users/{username}/performance-by-time-class")
def get_performance_by_time_class(username: str) -> dict[str, Any]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.performance_by_time_class(conn, username)


@app.get("/api/users/{username}/top-openings")
def get_top_openings(
    username: str,
    limit: int = 20,
    min_games: int = 5,
    time_class: str | None = None,
    since_days: int | None = None,
) -> list[dict[str, Any]]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.top_openings(
            conn, username,
            limit=limit, min_games=min_games,
            time_class=time_class, since_days=since_days,
        )


@app.get("/api/users/{username}/performance-by-hour")
def get_performance_by_hour(
    username: str,
    tz_offset_hours: int = 0,
) -> list[dict[str, Any]]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.performance_by_hour(
            conn, username, tz_offset_hours=tz_offset_hours
        )


@app.get("/api/users/{username}/games")
def get_games(
    username: str,
    eco: str | None = None,
    color: str | None = None,
    time_class: str | None = None,
    since_days: int | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.games(
            conn, username,
            eco=eco, color=color, time_class=time_class,
            since_days=since_days, limit=limit,
        )


@app.get("/api/users/{username}/games/search")
def search_games(
    username: str,
    opponent: str | None = None,
    color: str | None = None,
    result: str | None = None,
    time_class: str | None = None,
    eco: str | None = None,
    since_days: int | None = None,
    min_opp_rating: int | None = None,
    max_opp_rating: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:

    limit  = min(max(limit, 1), 100)
    offset = max(offset, 0)

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.search_games(
            conn, username,
            opponent=opponent, color=color, result=result,
            time_class=time_class, eco=eco, since_days=since_days,
            min_opp_rating=min_opp_rating, max_opp_rating=max_opp_rating,
            limit=limit, offset=offset,
        )


@app.get("/api/users/{username}/games/by-url")
def get_game_by_url(username: str, url: str) -> dict[str, Any]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        row = conn.execute(
            "SELECT url, end_time, time_class, time_control, eco, pgn,"
            " white_username, white_rating, white_result,"
            " black_username, black_rating, black_result"
            " FROM games WHERE url = ? AND username = ?",
            (url, username.lower()),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        user       = username.lower()
        i_am_white = row[6] == user
        my_color   = "white" if i_am_white else "black"
        my_rating  = row[7]  if i_am_white else row[10]
        my_result  = row[8]  if i_am_white else row[11]
        opp        = row[9]  if i_am_white else row[6]
        opp_rating = row[10] if i_am_white else row[7]
        return {
            "url":          row[0],
            "end_time":     row[1],
            "time_class":   row[2],
            "time_control": row[3],
            "eco":          row[4],
            "pgn":          row[5],
            "my_color":     my_color,
            "my_rating":    my_rating,
            "my_result":    my_result,
            "result":       analytics._classify(my_result),
            "opponent":     opp,
            "opp_rating":   opp_rating,
        }


@app.get("/api/users/{username}/rating-progression")
def get_rating_progression(username: str) -> dict[str, Any]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.rating_progression(conn, username)


@app.get("/api/users/{username}/activity-heatmap")
def get_activity_heatmap(
    username: str,
    tz_offset_hours: int = 0,
    since_days: int | None = None,
) -> list[dict[str, int]]:

    with db_conn() as conn:
        assert_user_synced(conn, username)
        return analytics.activity_heatmap(
            conn, username,
            tz_offset_hours=tz_offset_hours, since_days=since_days,
        )


@app.get("/api/users/{username}/summary")
def get_summary(
    username: str,
    tz_offset_hours: int = 0,
) -> dict[str, Any]:

    # all the dashboard panels in one response so the frontend doesnt
    # need to fan out into six parallel requests on first load
    with db_conn() as conn:
        assert_user_synced(conn, username)
        return {
            "username": username.lower(),
            "record_by_color":           analytics.record_by_color(conn, username),
            "performance_by_time_class": analytics.performance_by_time_class(conn, username),
            "top_openings":              analytics.top_openings(conn, username),
            "rating_progression":        analytics.rating_progression(conn, username),
            "activity_heatmap":          analytics.activity_heatmap(
                conn, username, tz_offset_hours=tz_offset_hours
            ),
            "performance_by_hour":       analytics.performance_by_hour(
                conn, username, tz_offset_hours=tz_offset_hours
            ),
        }


@app.post("/api/users/{username}/sync")
def post_sync(username: str) -> dict[str, Any]:

    # username has to look like a chess.com handle, reject obvious junk
    clean = username.strip()
    if not clean or len(clean) > 25 or not all(
        c.isalnum() or c in "-_" for c in clean
    ):
        raise HTTPException(status_code=400, detail="Invalid username")

    return sync_jobs.start_sync(clean, DB_PATH)


@app.get("/api/users/{username}/sync/status")
def get_sync_status(username: str) -> dict[str, Any]:

    job = sync_jobs.get_job(username)
    if not job:
        return {"state": "idle", "username": username.lower()}
    return job


# opening explorer
#
# was a lichess proxy until feb 2026 when their explorer infra went down
# (github lichess-org/lila #19610, no fix in sight). switched to chessdb.cn
# which serves engine analysis, plus a personal index built from the user's
# own games. the lichess key is kept around so the frontend can show a
# "down" tab gracefully instead of just hiding it.

CHESSDB_BASE       = "http://www.chessdb.cn/cdb.php"
CHESSDB_TIMEOUT    = 8

EXPLORER_CACHE_TTL  = 600
_EXPLORER_CACHE_MAX = 500
_explorer_cache: dict[str, tuple[float, dict]] = {}


def _cache_get(key):

    hit = _explorer_cache.get(key)
    if not hit: return None
    if time.time() - hit[0] > EXPLORER_CACHE_TTL:
        _explorer_cache.pop(key, None)
        return None
    return hit[1]


def _cache_set(key, data):

    if len(_explorer_cache) >= _EXPLORER_CACHE_MAX:
        # evict the oldest entry. we don't need a real lru here, just want
        # the dict to stop growing forever.
        oldest = min(_explorer_cache.items(), key=lambda kv: kv[1][0])[0]
        _explorer_cache.pop(oldest, None)
    _explorer_cache[key] = (time.time(), data)


def _normalize_chessdb(raw, fen):

    side = "w" if " w " in fen else "b"
    moves_in = (raw.get("moves") or []) if isinstance(raw, dict) else []
    out = []
    for m in moves_in:

        try:
            winrate = float(m.get("winrate")) if m.get("winrate") is not None else None
        except (TypeError, ValueError):
            winrate = None

        # score is centipawns from side-to-move's perspective
        score = m.get("score")
        try:    score = int(score) if score is not None else None
        except (TypeError, ValueError): score = None

        out.append({
            "uci":     m.get("uci"),
            "san":     m.get("san"),
            "score":   score,
            "rank":    m.get("rank"),
            "winrate": winrate,
            "note":    m.get("note"),
        })
    return {
        "source":       "chessdb",
        "side_to_move": side,
        "moves":        out,
        "status":       raw.get("status") if isinstance(raw, dict) else None,
    }


def fetch_chessdb(fen):

    cache_key = f"chessdb::{fen}"
    cached = _cache_get(cache_key)
    if cached is not None: return cached

    params = {"action": "queryall", "board": fen, "json": "1"}
    try:
        resp = requests.get(
            CHESSDB_BASE, params=params,
            headers={"User-Agent": "ChessAnalyzer/0.2"},
            timeout=CHESSDB_TIMEOUT,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"chessdb upstream error: {e}")

    if not resp.ok:
        raise HTTPException(status_code=resp.status_code,
                            detail=f"chessdb returned {resp.status_code}")

    # chessdb returns plain text "unknown" / "invalid board" / "checkmate" /
    # "stalemate" / "nobestmove" instead of json for those cases, even with
    # json=1 in the query. handle without erroring.
    text = (resp.text or "").strip()
    text_starters = ("unknown", "invalid", "checkmate", "stalemate", "nobestmove")
    if any(text.startswith(s) for s in text_starters):
        data = {
            "source":       "chessdb",
            "side_to_move": "w" if " w " in fen else "b",
            "moves":        [],
            "status":       text,
        }
        _cache_set(cache_key, data)
        return data

    try:
        raw = resp.json()
    except ValueError:
        data = {
            "source":       "chessdb",
            "side_to_move": "w" if " w " in fen else "b",
            "moves":        [],
            "status":       text[:80],
        }
        _cache_set(cache_key, data)
        return data

    data = _normalize_chessdb(raw, fen)
    _cache_set(cache_key, data)
    return data


def fetch_personal(conn, username, fen):

    user = username.lower()

    # normalize fen the same way position_index does - drop halfmove + fullmove
    parts   = fen.split(" ")
    pos_key = " ".join(parts[:4])

    rows = conn.execute("""
        SELECT
            move_uci,
            move_san,
            SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
            COUNT(*) AS total,
            MAX(game_url) AS last_game_url
        FROM position_moves
        WHERE username = ? AND position_fen = ?
        GROUP BY move_uci, move_san
        ORDER BY total DESC
    """, (user, pos_key)).fetchall()

    moves = [{
        "uci":           r[0],
        "san":           r[1],
        "wins":          r[2],
        "draws":         r[3],
        "losses":        r[4],
        "total":         r[5],
        "last_game_url": r[6],
    } for r in rows]

    total = sum(m["total"] for m in moves)
    return {
        "source":   "personal",
        "username": user,
        "total_games_from_position": total,
        "moves":    moves,
    }


def position_index_exists(conn):

    # whether to even offer the personal tab. avoids confusing "0 games"
    # responses when the index hasnt been built yet.
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='position_moves'"
    ).fetchone()
    return row is not None


@app.get("/api/explorer/{db}")
def get_explorer(
    db: str,
    fen: str,
    username: str | None = None,
):

    if db == "chessdb":
        return fetch_chessdb(fen)

    if db == "personal":
        if not username:
            raise HTTPException(
                status_code=400,
                detail="personal explorer requires a username query param",
            )
        with db_conn() as conn:
            assert_user_synced(conn, username)
            if not position_index_exists(conn):
                raise HTTPException(
                    status_code=409,
                    detail=("Position index not built yet. "
                            "Run: python position_index.py " + username),
                )
            return fetch_personal(conn, username, fen)

    if db == "lichess":
        return {
            "source":  "lichess",
            "moves":   [],
            "status":  "unavailable",
            "message": (
                "Lichess opening explorer is currently down "
                "(GitHub issue lichess-org/lila #19610, open since Feb 2026). "
                "Switch to the chessdb or personal tab."
            ),
        }

    raise HTTPException(
        status_code=400,
        detail="db must be 'chessdb', 'personal', or 'lichess'",
    )


@app.get("/api/users/{username}/explorer-status")
def get_explorer_status(username: str) -> dict[str, Any]:

    # tells the frontend which explorer tabs are usable so it can hide
    # or disable the ones that wont work
    with db_conn() as conn:
        has_index = position_index_exists(conn)
        if has_index:
            row = conn.execute(
                "SELECT COUNT(*) FROM position_moves WHERE username = ?",
                (username.lower(),),
            ).fetchone()
            personal_rows = row[0] if row else 0
        else:
            personal_rows = 0

    return {
        "chessdb_available":  True,
        "personal_available": personal_rows > 0,
        "personal_rows":      personal_rows,
        "lichess_available":  False,
    }
