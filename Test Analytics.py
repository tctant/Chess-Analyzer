"""
quick correctness check. builds an in-memory db with games whose results
are known, runs every analytics function, asserts the numbers come back
the way the docstrings claim. run before touching anything in analytics.py.
"""

import sqlite3
import importlib.util


# load fetch_games + analytics from the project dir without polluting sys.path
spec_fg = importlib.util.spec_from_file_location("fg", "fetch_games.py")
fg = importlib.util.module_from_spec(spec_fg)
spec_fg.loader.exec_module(fg)

spec_an = importlib.util.spec_from_file_location("an", "analytics.py")
an = importlib.util.module_from_spec(spec_an)
spec_an.loader.exec_module(an)


USER = "testuser"


def make_game(url, ts, my_color, my_result, opp_result, eco, time_class, my_rating=1500):

    if my_color == "white":
        white = {"username": USER,  "rating": my_rating, "result": my_result}
        black = {"username": "opp", "rating": 1500,      "result": opp_result}
    else:
        white = {"username": "opp", "rating": 1500,      "result": opp_result}
        black = {"username": USER,  "rating": my_rating, "result": my_result}
    return {
        "url":          url,
        "pgn":          "fake pgn",
        "time_control": "600",
        "end_time":     ts,
        "rated":        True,
        "time_class":   time_class,
        "rules":        "chess",
        "white":        white,
        "black":        black,
        "eco":          f"https://www.chess.com/openings/{eco}" if eco else None,
        "accuracies":   None,
    }


# 5 wins, 3 losses, 2 draws split across known openings and time classes
games = [
    # 3 wins as white in caro-kann (blitz)
    make_game("u1",  1700000000, "white", "win",        "resigned",   "Caro-Kann-Defense", "blitz", 1500),
    make_game("u2",  1700001000, "white", "win",        "checkmated", "Caro-Kann-Defense", "blitz", 1510),
    make_game("u3",  1700002000, "white", "win",        "timeout",    "Caro-Kann-Defense", "blitz", 1520),
    # 2 wins as black in sicilian (rapid)
    make_game("u4",  1700003000, "black", "win",        "resigned",   "Sicilian-Defense",  "rapid", 1600),
    make_game("u5",  1700004000, "black", "win",        "resigned",   "Sicilian-Defense",  "rapid", 1610),
    # 2 losses as white
    make_game("u6",  1700005000, "white", "resigned",   "win",        "Caro-Kann-Defense", "blitz", 1525),
    make_game("u7",  1700006000, "white", "checkmated", "win",        "Italian-Game",      "bullet", 1400),
    # 1 loss as black
    make_game("u8",  1700007000, "black", "timeout",    "win",        "Sicilian-Defense",  "rapid", 1605),
    # 2 draws
    make_game("u9",  1700008000, "white", "agreed",     "agreed",     "Caro-Kann-Defense", "blitz", 1530),
    make_game("u10", 1700009000, "black", "stalemate",  "stalemate",  "Sicilian-Defense",  "rapid", 1615),
]

conn = sqlite3.connect(":memory:")
fg.init_db(conn)
for g in games:
    fg.store_game(conn, USER, g)


# record_by_color
rec = an.record_by_color(conn, USER)
assert rec["white"] == {"win": 3, "loss": 2, "draw": 1, "total": 6}, rec["white"]
assert rec["black"] == {"win": 2, "loss": 1, "draw": 1, "total": 4}, rec["black"]
print("[OK] record_by_color")


# top_openings - keyed by (eco, color) since we split by color
ops = an.top_openings(conn, USER, min_games=1)
ops_by_key = {(o["eco"], o["color"]): o for o in ops}

ck_white = ops_by_key.get(("Caro-Kann-Defense", "white"))
assert ck_white is not None, "Caro-Kann-Defense as white should exist"
assert ck_white["games"] == 5 and ck_white["wins"] == 3 and ck_white["losses"] == 1 and ck_white["draws"] == 1, ck_white

sd_black = ops_by_key.get(("Sicilian-Defense", "black"))
assert sd_black is not None, "Sicilian-Defense as black should exist"
assert sd_black["games"] == 4 and sd_black["wins"] == 2 and sd_black["losses"] == 1 and sd_black["draws"] == 1, sd_black

ig = ops_by_key.get(("Italian-Game", "white"))
assert ig and ig["games"] == 1 and ig["losses"] == 1, ig

assert ops[0]["games"] == 5, "most-played should come first"
print("[OK] top_openings (split by color)")


# top_openings with time_class filter - blitz only
ops_blitz = an.top_openings(conn, USER, min_games=1, time_class="blitz")
total_blitz_rows = sum(o["games"] for o in ops_blitz)
assert total_blitz_rows == 5, f"expected 5 blitz games, got {total_blitz_rows}"
assert not any(o["eco"] == "Italian-Game" for o in ops_blitz), "italian was bullet"
assert not any(o["eco"] == "Sicilian-Defense" for o in ops_blitz), "sicilian was rapid"
print("[OK] top_openings time_class filter")


# performance_by_time_class
perf = an.performance_by_time_class(conn, USER)
assert perf["blitz"]["games"] == 5, perf["blitz"]
assert perf["blitz"]["wins"] == 3 and perf["blitz"]["losses"] == 1 and perf["blitz"]["draws"] == 1
assert perf["rapid"]["games"] == 4
assert perf["bullet"]["games"] == 1 and perf["bullet"]["losses"] == 1
print("[OK] performance_by_time_class")


# rating_progression
prog = an.rating_progression(conn, USER)
assert set(prog.keys()) == {"blitz", "rapid", "bullet"}
assert len(prog["blitz"]) == 5
assert prog["blitz"] == sorted(prog["blitz"], key=lambda p: p["t"]), "should be time-sorted"
assert prog["blitz"][-1]["rating"] == 1530, prog["blitz"][-1]
print("[OK] rating_progression")


# activity_heatmap - all 10 games should land in valid (dow, hour) cells
heat = an.activity_heatmap(conn, USER)
total_in_heatmap = sum(c["games"] for c in heat)
assert total_in_heatmap == 10, total_in_heatmap
for c in heat:
    assert 0 <= c["day_of_week"] <= 6
    assert 0 <= c["hour"]        <= 23
print("[OK] activity_heatmap")


# timezone offset should shift hour buckets
heat_utc = an.activity_heatmap(conn, USER, tz_offset_hours=0)
heat_pho = an.activity_heatmap(conn, USER, tz_offset_hours=-7)
hours_utc = sorted({c["hour"] for c in heat_utc})
hours_pho = sorted({c["hour"] for c in heat_pho})
assert hours_utc != hours_pho, "timezone offset should change hour buckets"
print("[OK] timezone offset behaves as expected")


# since_days filter - games are around late 2023 so since_days=1 excludes all
heat_recent = an.activity_heatmap(conn, USER, since_days=1)
assert sum(c["games"] for c in heat_recent) == 0, "since_days=1 should return 0"
heat_all = an.activity_heatmap(conn, USER, since_days=None)
assert sum(c["games"] for c in heat_all) == 10
print("[OK] heatmap since_days filter")


print("\nAll analytics tests passed.")
