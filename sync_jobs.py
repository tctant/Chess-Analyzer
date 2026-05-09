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

import fetch_games


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
        conn = sqlite3.connect(db_path)
        try:
            fetch_games.sync_user(username, conn)
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
