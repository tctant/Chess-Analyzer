"""
sync orchestration. one user at a time, in-memory job table.
the ui hits start_sync which spawns a background thread, then polls
get_job for progress. clicking sync again while one's running just
returns the existing job rather than starting a second one.

not a real queue - if this ever needs concurrent users, swap for celery
or rq. for one user it's fine.
"""

import sqlite3
import threading
import time
import traceback

import analytics
import fetch_games
import position_index


# username -> job dict. state cycles through queued -> syncing -> done | error
_JOBS = {}
_LOCK = threading.Lock()


def get_job(username):

    user = username.lower()
    with _LOCK:
        return dict(_JOBS[user]) if user in _JOBS else None


def _set(username, **fields):

    user = username.lower()
    with _LOCK:
        if user not in _JOBS:
            return
        _JOBS[user].update(fields)
        _JOBS[user]["updated_at"] = int(time.time())


def _is_active(username):

    user = username.lower()
    with _LOCK:
        job = _JOBS.get(user)
        if not job: return False
        return job["state"] in ("queued", "syncing")


def start_sync(username, db_path):

    user = username.lower()

    if _is_active(user):
        return get_job(user)

    with _LOCK:
        _JOBS[user] = {
            "username":     user,
            "state":        "queued",
            "started_at":   int(time.time()),
            "updated_at":   int(time.time()),
            "message":      "Queued",
            "games_synced": None,
            "error":        None,
        }

    t = threading.Thread(target=_run, args=(user, db_path), daemon=True)
    t.start()
    return get_job(user)


def _run(username, db_path):

    try:
        _set(username, state="syncing", message="Fetching games from Chess.com")
        conn = sqlite3.connect(db_path, timeout=30)
        try:
            fetch_games.sync_user(username, conn)
            analytics.tune_db(conn)

            # keep the position explorer in step with new games. incremental,
            # so after the first run this only touches what just came in
            _set(username, message="Indexing positions")
            position_index.index_user(
                conn, username,
                on_progress=lambda done, total: _set(
                    username, message=f"Indexing positions {done:,}/{total:,}"),
            )
            row = conn.execute(
                "SELECT COUNT(*) FROM games WHERE username = ?", (username,)
            ).fetchone()
            total = row[0] if row else 0
        finally:
            conn.close()

        _set(username,
             state="done",
             message=f"Done \u00b7 {total:,} games",
             games_synced=total)
    except Exception as e:

        # log the trace to stderr so we can debug, surface a short message via the api
        traceback.print_exc()
        _set(username, state="error", error=str(e), message=f"Failed: {e}")


# standalone index jobs, for when the explorer page finds games that never
# went through a ui sync (cli sync, or a db built before v2 of the index)
_INDEX_JOBS = {}


def get_index_job(username):

    user = username.lower()
    with _LOCK:
        return dict(_INDEX_JOBS[user]) if user in _INDEX_JOBS else None


def start_index(username, db_path):

    user = username.lower()
    with _LOCK:
        job = _INDEX_JOBS.get(user)
        if job and job["state"] == "indexing":
            return dict(job)
        _INDEX_JOBS[user] = {"state": "indexing", "done": 0, "total": None, "error": None}

    t = threading.Thread(target=_run_index, args=(user, db_path), daemon=True)
    t.start()
    return get_index_job(user)


def _run_index(username, db_path):

    def progress(done, total):

        with _LOCK:
            _INDEX_JOBS[username].update(done=done, total=total)

    try:
        conn = sqlite3.connect(db_path, timeout=30)
        try:
            position_index.index_user(conn, username, on_progress=progress)
        finally:
            conn.close()
        with _LOCK:
            _INDEX_JOBS[username]["state"] = "done"
    except Exception as e:
        traceback.print_exc()
        with _LOCK:
            _INDEX_JOBS[username].update(state="error", error=str(e))
