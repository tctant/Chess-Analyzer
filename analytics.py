"""
aggregations over the games table that fetch_games.py populates. each
public function takes (conn, username) and returns plain json-serializable
python so fastapi can hand it back unchanged.

conventions used everywhere below:
- usernames are lowercased before any query - they're stored lowercased
- 'my_result' / 'my_color' / 'my_rating' = the user's side of the game
  regardless of whether they were white or black
- draws are detected by result string, see DRAW_RESULTS
"""

from __future__ import annotations

import sqlite3
from typing import Any


# every result string that means "draw" on chess.com. anything else that
# isn't 'win' is treated as a loss (resigned / checkmated / timeout / etc.)
DRAW_RESULTS = frozenset({
    "agreed",
    "repetition",
    "stalemate",
    "50move",
    "insufficient",
    "timevsinsufficient",
})


def _classify(my_result: str | None) -> str:

    if my_result == "win":
        return "win"
    if my_result in DRAW_RESULTS:
        return "draw"
    return "loss"


def _connect(db_path: str) -> sqlite3.Connection:

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_row_factory(conn: sqlite3.Connection) -> None:

    # public functions accept any sqlite3.Connection. set Row factory
    # defensively so callers don't have to remember to.
    conn.row_factory = sqlite3.Row


# sql fragments reused below, all queries take :user as a named parameter
_USER_IN_GAME = "(white_username = :user OR black_username = :user)"
_MY_RESULT = (
    "CASE WHEN white_username = :user "
    "THEN white_result ELSE black_result END"
)
_MY_COLOR = (
    "CASE WHEN white_username = :user THEN 'white' ELSE 'black' END"
)
_MY_RATING = (
    "CASE WHEN white_username = :user THEN white_rating ELSE black_rating END"
)


def rating_progression(
    conn: sqlite3.Connection, username: str
) -> dict[str, list[dict[str, int]]]:

    # one time series per time class:
    #   {"blitz": [{"t": <unix>, "rating": 1500}, ...], "rapid": [...], ...}
    # rated games only so unrated games dont yank the line around
    _ensure_row_factory(conn)
    user = username.lower()
    sql = f"""
        SELECT
            end_time,
            time_class,
            {_MY_RATING} AS rating
        FROM games
        WHERE {_USER_IN_GAME}
          AND rated = 1
          AND time_class IS NOT NULL
        ORDER BY end_time
    """
    series: dict[str, list[dict[str, int]]] = {}
    for row in conn.execute(sql, {"user": user}):
        if row["rating"] is None:
            continue
        series.setdefault(row["time_class"], []).append(
            {"t": row["end_time"], "rating": row["rating"]}
        )
    return series


def record_by_color(
    conn: sqlite3.Connection, username: str
) -> dict[str, dict[str, int]]:

    # returns:
    #   {"white": {"win": N, "loss": N, "draw": N, "total": N},
    #    "black": {...}}
    _ensure_row_factory(conn)
    user = username.lower()
    sql = f"""
        SELECT
            {_MY_COLOR}  AS color,
            {_MY_RESULT} AS my_result
        FROM games
        WHERE {_USER_IN_GAME}
    """
    out: dict[str, dict[str, int]] = {
        "white": {"win": 0, "loss": 0, "draw": 0, "total": 0},
        "black": {"win": 0, "loss": 0, "draw": 0, "total": 0},
    }
    for row in conn.execute(sql, {"user": user}):
        bucket = _classify(row["my_result"])
        out[row["color"]][bucket]   += 1
        out[row["color"]]["total"]  += 1
    return out


def top_openings(
    conn: sqlite3.Connection,
    username: str,
    limit: int = 20,
    min_games: int = 5,
    time_class: str | None = None,
    since_days: int | None = None,
) -> list[dict[str, Any]]:

    # most-played openings (by ECO slug + color) with the user's W/D/L rate.
    # rows are unique (eco, color) - playing the sicilian as black is a
    # different stat than facing it as white, so they stay separate.
    #
    # min_games drops (eco, color) pairs below the threshold so a single
    # fluke game doesnt top the list.
    _ensure_row_factory(conn)
    user = username.lower()
    params: dict[str, Any] = {"user": user}

    extra_clauses = ""
    if time_class:
        extra_clauses += " AND time_class = :time_class"
        params["time_class"] = time_class
    if since_days is not None and since_days > 0:
        import time as _time
        params["since"] = int(_time.time()) - since_days * 86400
        extra_clauses += " AND end_time >= :since"

    sql = f"""
        SELECT
            eco,
            {_MY_COLOR}  AS color,
            {_MY_RESULT} AS my_result
        FROM games
        WHERE {_USER_IN_GAME}
          AND eco IS NOT NULL
          AND eco != 'Undefined'
          {extra_clauses}
    """

    counts: dict[tuple[str, str], dict[str, int]] = {}
    for row in conn.execute(sql, params):
        key    = (row["eco"], row["color"])
        bucket = _classify(row["my_result"])
        c = counts.setdefault(key, {"win": 0, "draw": 0, "loss": 0})
        c[bucket] += 1

    rows = []
    for (eco, color), c in counts.items():
        total = c["win"] + c["draw"] + c["loss"]
        if total < min_games:
            continue
        rows.append({
            "eco":       eco,
            "color":     color,
            "games":     total,
            "wins":      c["win"],
            "draws":     c["draw"],
            "losses":    c["loss"],
            "win_rate":  round(c["win"]  / total, 4),
            "draw_rate": round(c["draw"] / total, 4),
            "loss_rate": round(c["loss"] / total, 4),
        })
    rows.sort(key=lambda r: r["games"], reverse=True)
    return rows[:limit]


def performance_by_time_class(
    conn: sqlite3.Connection, username: str
) -> dict[str, dict[str, Any]]:

    # per time class: total games + win/draw/loss rates
    _ensure_row_factory(conn)
    user = username.lower()
    sql = f"""
        SELECT
            time_class,
            {_MY_RESULT} AS my_result
        FROM games
        WHERE {_USER_IN_GAME}
          AND time_class IS NOT NULL
    """
    counts: dict[str, dict[str, int]] = {}
    for row in conn.execute(sql, {"user": user}):
        bucket = _classify(row["my_result"])
        c = counts.setdefault(row["time_class"], {"win": 0, "draw": 0, "loss": 0})
        c[bucket] += 1

    out: dict[str, dict[str, Any]] = {}
    for tc, c in counts.items():
        total = c["win"] + c["draw"] + c["loss"]
        out[tc] = {
            "games":     total,
            "wins":      c["win"],
            "draws":     c["draw"],
            "losses":    c["loss"],
            "win_rate":  round(c["win"]  / total, 4) if total else 0,
            "draw_rate": round(c["draw"] / total, 4) if total else 0,
            "loss_rate": round(c["loss"] / total, 4) if total else 0,
        }
    return out


def activity_heatmap(
    conn: sqlite3.Connection,
    username: str,
    tz_offset_hours: int = 0,
    since_days: int | None = None,
) -> list[dict[str, int]]:

    # sparse cells (only buckets that have games):
    #   [{"day_of_week": 0..6, "hour": 0..23, "games": N}, ...]
    # day_of_week 0 = sunday (sqlite strftime('%w') convention).
    #
    # tz_offset_hours shifts game timestamps before bucketing - pass -7 for
    # phoenix so the heatmap reads in local time. since_days cutoff is
    # computed in unix seconds so timezone doesnt matter for the filter.
    _ensure_row_factory(conn)
    user           = username.lower()
    offset_seconds = tz_offset_hours * 3600
    params: dict[str, Any] = {"user": user, "offset": offset_seconds}

    since_clause = ""
    if since_days is not None and since_days > 0:
        import time as _time
        params["since"] = int(_time.time()) - since_days * 86400
        since_clause = "AND end_time >= :since"

    sql = f"""
        SELECT
            CAST(strftime('%w', end_time + :offset, 'unixepoch') AS INTEGER) AS dow,
            CAST(strftime('%H', end_time + :offset, 'unixepoch') AS INTEGER) AS hour,
            COUNT(*) AS n
        FROM games
        WHERE {_USER_IN_GAME}
          {since_clause}
        GROUP BY dow, hour
        ORDER BY dow, hour
    """
    return [
        {"day_of_week": row["dow"], "hour": row["hour"], "games": row["n"]}
        for row in conn.execute(sql, params)
    ]


def performance_by_hour(
    conn: sqlite3.Connection,
    username: str,
    tz_offset_hours: int = 0,
) -> list[dict[str, Any]]:

    # one row per hour-of-day (0..23) with games + win rate. always 24 rows;
    # hours with zero games come back with win_rate = None.
    #
    # this is the "do i lose more after midnight" view. the heatmap shows
    # activity, this shows performance.
    _ensure_row_factory(conn)
    user           = username.lower()
    offset_seconds = tz_offset_hours * 3600

    sql = f"""
        SELECT
            CAST(strftime('%H', end_time + :offset, 'unixepoch') AS INTEGER) AS hour,
            {_MY_RESULT} AS my_result
        FROM games
        WHERE {_USER_IN_GAME}
    """
    counts: dict[int, dict[str, int]] = {
        h: {"win": 0, "draw": 0, "loss": 0} for h in range(24)
    }
    for row in conn.execute(sql, {"user": user, "offset": offset_seconds}):
        bucket = _classify(row["my_result"])
        counts[row["hour"]][bucket] += 1

    out = []
    for hour in range(24):
        c     = counts[hour]
        total = c["win"] + c["draw"] + c["loss"]
        out.append({
            "hour":     hour,
            "games":    total,
            "wins":     c["win"],
            "draws":    c["draw"],
            "losses":   c["loss"],
            "win_rate": round(c["win"] / total, 4) if total else None,
        })
    return out


def games(
    conn: sqlite3.Connection,
    username: str,
    eco: str | None = None,
    color: str | None = None,
    time_class: str | None = None,
    since_days: int | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:

    # the user's most recent games matching the filters, with PGN. each row
    # is reshaped to a user-centric view (my_rating, opp_rating, etc.)
    # rather than the white/black storage shape.
    _ensure_row_factory(conn)
    user = username.lower()
    params: dict[str, Any] = {"user": user}

    extra = ""
    if eco:
        extra += " AND eco = :eco"
        params["eco"] = eco
    if time_class:
        extra += " AND time_class = :time_class"
        params["time_class"] = time_class
    if since_days is not None and since_days > 0:
        import time as _time
        params["since"] = int(_time.time()) - since_days * 86400
        extra += " AND end_time >= :since"
    if color == "white":
        extra += " AND white_username = :user"
    elif color == "black":
        extra += " AND black_username = :user"

    sql = f"""
        SELECT
            url, end_time, time_class, time_control, eco, pgn,
            white_username, white_rating, white_result,
            black_username, black_rating, black_result
        FROM games
        WHERE {_USER_IN_GAME}
          {extra}
        ORDER BY end_time DESC
        LIMIT :limit
    """
    params["limit"] = limit

    out = []
    for row in conn.execute(sql, params):
        i_am_white = row["white_username"] == user
        my_color   = "white" if i_am_white else "black"
        my_rating  = row["white_rating"]   if i_am_white else row["black_rating"]
        my_result  = row["white_result"]   if i_am_white else row["black_result"]
        opp        = row["black_username"] if i_am_white else row["white_username"]
        opp_rating = row["black_rating"]   if i_am_white else row["white_rating"]
        out.append({
            "url":           row["url"],
            "end_time":      row["end_time"],
            "time_class":    row["time_class"],
            "time_control":  row["time_control"],
            "eco":           row["eco"],
            "pgn":           row["pgn"],
            "my_color":      my_color,
            "my_rating":     my_rating,
            "my_result":     my_result,
            "result":        _classify(my_result),
            "opponent":      opp,
            "opp_rating":    opp_rating,
        })
    return out


def search_games(
    conn,
    username,
    *,
    opponent=None,
    color=None,
    result=None,
    time_class=None,
    eco=None,
    since_days=None,
    min_opp_rating=None,
    max_opp_rating=None,
    limit=50,
    offset=0,
):

    # paginated, filterable view of the game log without PGNs (which are
    # heavy). when the user clicks a row to open the analysis modal, the
    # frontend hits games() / by-url to grab the pgn on demand.
    _ensure_row_factory(conn)
    user = username.lower()
    params = {"user": user}
    extra = ""

    if opponent:
        extra += " AND ((white_username = :user AND black_username LIKE :opp)" \
                 " OR (black_username = :user AND white_username LIKE :opp))"
        params["opp"] = f"%{opponent.lower()}%"
    if color == "white":
        extra += " AND white_username = :user"
    elif color == "black":
        extra += " AND black_username = :user"
    if time_class:
        extra += " AND time_class = :time_class"
        params["time_class"] = time_class
    if eco:
        extra += " AND eco = :eco"
        params["eco"] = eco
    if since_days is not None and since_days > 0:
        import time as _time
        params["since"] = int(_time.time()) - since_days * 86400
        extra += " AND end_time >= :since"
    if min_opp_rating is not None:
        extra += " AND ((white_username = :user AND black_rating >= :min_opp)" \
                 "  OR (black_username = :user AND white_rating >= :min_opp))"
        params["min_opp"] = min_opp_rating
    if max_opp_rating is not None:
        extra += " AND ((white_username = :user AND black_rating <= :max_opp)" \
                 "  OR (black_username = :user AND white_rating <= :max_opp))"
        params["max_opp"] = max_opp_rating

    # result filter is the awkward one. each row's result string has to
    # bucket to win/draw/loss before we can match. doing it inline in sql
    # is uglier than CASE but a CASE in WHERE wont use indexes either way.
    result_clause = ""
    if result == "win":
        result_clause = (
            " AND ((white_username = :user AND white_result = 'win')"
            "   OR (black_username = :user AND black_result = 'win'))"
        )
    elif result == "draw":
        # mirrors DRAW_RESULTS at the top of this file
        draws = ",".join(f"'{r}'" for r in DRAW_RESULTS)
        result_clause = (
            f" AND ((white_username = :user AND white_result IN ({draws}))"
            f"   OR (black_username = :user AND black_result IN ({draws})))"
        )
    elif result == "loss":
        draws = ",".join(f"'{r}'" for r in DRAW_RESULTS)
        result_clause = (
            f" AND ((white_username = :user AND white_result NOT IN ({draws})"
            f"        AND white_result != 'win')"
            f"   OR (black_username = :user AND black_result NOT IN ({draws})"
            f"        AND black_result != 'win'))"
        )
    extra += result_clause

    # count query first - the frontend needs the total for pagination
    # count + win/draw breakdown in one pass. frontend uses this for the
    # head-to-head summary line when an opponent filter is active.
    _draws_list = ",".join(f"'{r}'" for r in DRAW_RESULTS)
    count_sql = f"""
        SELECT
            COUNT(*) AS n,
            SUM(CASE WHEN
                (white_username = :user AND white_result = 'win')
                OR (black_username = :user AND black_result = 'win')
            THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN
                (white_username = :user AND white_result IN ({_draws_list}))
                OR (black_username = :user AND black_result IN ({_draws_list}))
            THEN 1 ELSE 0 END) AS draws
        FROM games
        WHERE {_USER_IN_GAME}
          {extra}
    """
    crow   = conn.execute(count_sql, params).fetchone()
    total  = crow["n"]
    wins   = crow["wins"]  or 0
    draws  = crow["draws"] or 0
    losses = total - wins - draws

    sql = f"""
        SELECT
            url, end_time, time_class, time_control, eco,
            white_username, white_rating, white_result,
            black_username, black_rating, black_result
        FROM games
        WHERE {_USER_IN_GAME}
          {extra}
        ORDER BY end_time DESC
        LIMIT :limit OFFSET :offset
    """
    params["limit"]  = limit
    params["offset"] = offset

    rows = []
    for row in conn.execute(sql, params):
        i_am_white = row["white_username"] == user
        my_rating  = row["white_rating"]   if i_am_white else row["black_rating"]
        my_result  = row["white_result"]   if i_am_white else row["black_result"]
        opp        = row["black_username"] if i_am_white else row["white_username"]
        opp_rating = row["black_rating"]   if i_am_white else row["white_rating"]
        rows.append({
            "url":          row["url"],
            "end_time":     row["end_time"],
            "time_class":   row["time_class"],
            "time_control": row["time_control"],
            "eco":          row["eco"],
            "my_color":     "white" if i_am_white else "black",
            "my_rating":    my_rating,
            "result":       _classify(my_result),
            "opponent":     opp,
            "opp_rating":   opp_rating,
        })
    return {
        "total":   total,
        "limit":   limit,
        "offset":  offset,
        "summary": {"wins": wins, "draws": draws, "losses": losses},
        "rows":    rows,
    }


def _print_report(db_path: str, username: str) -> None:

    import json
    conn = _connect(db_path)
    try:
        print(f"\n=== Report for {username} ===\n")
        print("--- Record by color ---")
        print(json.dumps(record_by_color(conn, username), indent=2))
        print("\n--- Performance by time class ---")
        print(json.dumps(performance_by_time_class(conn, username), indent=2))
        print("\n--- Top 10 openings ---")
        print(json.dumps(top_openings(conn, username, limit=10), indent=2))
        print("\n--- Rating progression (counts only) ---")
        prog = rating_progression(conn, username)
        for tc, points in prog.items():
            print(f"  {tc}: {len(points)} points "
                  f"(latest = {points[-1]['rating'] if points else 'n/a'})")
        print("\n--- Activity heatmap (top 5 busiest hours) ---")
        cells = activity_heatmap(conn, username)
        cells.sort(key=lambda c: c["games"], reverse=True)
        print(json.dumps(cells[:5], indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python analytics.py <username>", file=sys.stderr)
        sys.exit(1)
    _print_report("chess_data.db", sys.argv[1])
