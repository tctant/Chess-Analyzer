# Chess Analyzer

A personal Chess.com analytics dashboard. Type a username, get every game they've ever played sliced into a dashboard with rating progression, opening performance, time-of-day breakdowns, and a per-game engine analyzer.

Built mostly because chess.com's own "stats" page only goes back 90 days and skips a lot of stuff I wanted to see.

---

## What it does

Type a Chess.com username and you get:

- Total games, win rate, current ratings across blitz/rapid/bullet
- Rating progression line chart per time class, going back as far as the account has games
- Top openings table split by ECO + color, with W/D/L bars and click-to-drill into individual games
- Win rate by hour of day. The "do I actually play worse after midnight" question
- Activity heatmap (day-of-week × hour) with all-time / year / month / week filters
- Searchable game log with filters for opponent, color, result, time class
- Click any game and you get a Stockfish-powered analyzer with eval bar, move list with per-move clock readings, an opening explorer (engine analysis from chessdb.cn), and a "play from here" sandbox

If the username isn't in the database yet, hit the Sync button and it'll pull every game from Chess.com's public API. Most accounts take a couple minutes the first time, then incremental sync after that.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate            # or source .venv/bin/activate on mac/linux
pip install -r requirements.txt
```

Open `fetch_games.py` and replace the email in `USER_AGENT` with your own. Chess.com asks API consumers to identify themselves so they can reach out if your client misbehaves.

Then in two terminals:

```bash
.\run.ps1                          # backend at :8000
.\run-frontend.ps1                 # frontend at :5173
```

Or use the VS Code "Start All" task which does both.

For the very first sync of a new user from the CLI:

```bash
python fetch_games.py MooMooTNT
```

You don't have to use the CLI - the Sync button in the UI does the same thing in a background thread - but the CLI is faster for the first big pull because there's no polling overhead.

## How it works

Backend is FastAPI in front of a SQLite database. One table for games, one for which months have been pulled per user, plus an optional position-moves index for the personal opening explorer.

Aggregations all live in `analytics.py` as plain functions that take `(conn, username)` and return JSON-shaped dicts. The api file is mostly thin endpoints around those - this kept the testing easy (see `Test Analytics.py`, which builds an in-memory db with known counts and asserts every aggregation returns the right numbers).

Frontend is React + Vite + Recharts, no Redux, no fancy state library. The `/api/users/<u>/summary` endpoint returns the whole dashboard in one response so first paint is fast, and individual filter changes (year/month/week, time class) refetch only the affected card.

### Things that turned into real engineering problems

**Lichess explorer went down in February 2026.**
Originally the opening explorer was a Lichess proxy. Their explorer infrastructure broke and stayed broken (see github lichess-org/lila #19610, still open). Switched the engine tab to chessdb.cn which serves engine analysis with expected score per move. Kept the lichess key around in the api so the frontend can show a "this tab is unavailable" state instead of just hiding it - if/when lichess comes back, flipping the switch is one line.

**Stockfish in the browser via blob worker.**
The plan was to load Stockfish 16 lite as a Web Worker. Turns out Workers can only load same-origin scripts directly, and Stockfish is on a CDN. The fix is to fetch the script as text, wrap it in a Blob URL, and hand that to `new Worker()`. Standard pattern but took a while to find. The lite build is ~600KB and runs ~700K nodes/sec on a modern laptop, plenty for the 12-22 depths the UI exposes. Multi-threaded builds need cross-origin isolation headers I didn't want to commit to.

**Chessground is fussy about sizing.**
The board renders into a div, but its internal wrappers don't inherit container dimensions cleanly. If you don't force `width: 100%; height: 100%` on the right nested elements, the board collapses to 0×0 in a flex container and you spend an hour wondering why the pieces are invisible. There's CSS in styles.css specifically for this.

**Personal opening explorer needed its own index.**
For the "what have I played from this position" tab, querying live by replaying every game's PGN was way too slow (~9000 games × full mainline replay every time someone clicked an explorer move). So `position_index.py` builds a `position_moves` table once: every position the user has played from, every move they made from there, and the result of that game. With the right index it's a single GROUP BY. The indexer is idempotent and tracks indexed games by URL so re-runs only process new games.

**Timezone bug in the heatmap.**
Initially the heatmap used the server's local time, which meant if you moved the backend it would suddenly show different hours. Fixed by passing `tz_offset_hours` from the frontend (defaulting to 0 = UTC, with a comment in the analytics that explains the `tz_offset_hours=-7` for Phoenix case). The since_days filter computes the cutoff in unix seconds so timezone doesn't affect which games are included, only how the included games get bucketed for display.

**Click data on PGNs.**
chess.com PGNs annotate every move with `{[%clk H:MM:SS]}` - the clock reading at the time the move was played. Parsing those out lets the move list show per-move clock + time spent, with CSS tints for long thinks and time scrambles. Not all PGNs have them (daily games don't), so the move list checks for any clock data at all and switches layout if there's none.

**The "Undefined" opening filter.**
Chess.com tags some games with `eco: "Undefined"` when their database doesn't recognize the opening. These were dominating the top-openings table because there were so many of them. Filtered out at the SQL level, not in JS - want to count them out of the totals too.

## File structure

```
chess/
├── api.py              ← fastapi endpoints, opening explorer proxy
├── analytics.py        ← all the aggregation functions
├── fetch_games.py      ← chess.com api -> sqlite
├── sync_jobs.py        ← background sync threads + status table
├── position_index.py   ← personal opening explorer index builder
├── Test Analytics.py   ← correctness checks against a fake db
├── requirements.txt
├── run.ps1
├── run-frontend.ps1
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx     ← router shell, dashboard page
        ├── main.jsx
        ├── api.js      ← fetch wrapper
        ├── styles.css
        └── components/
            ├── MetricCards.jsx
            ├── RatingChart.jsx
            ├── ColorRecord.jsx
            ├── TimeClassChart.jsx
            ├── OpeningsTable.jsx
            ├── HourPerformance.jsx
            ├── Heatmap.jsx
            ├── GameLog.jsx
            ├── SyncButton.jsx
            ├── AnalysisBoard.jsx
            ├── OpeningExplorer.jsx
            ├── useStockfish.js
            ├── ErrorBoundary.jsx
            └── DashboardSkeleton.jsx
```

## Stack

- FastAPI + SQLite for the backend, no ORM, just sqlite3 with named parameters
- React 18 + Vite for the frontend
- Recharts for the charts
- chessground (the lichess board library) + chess.js for the analyzer
- Stockfish 16 lite as a Web Worker for engine analysis
- chessdb.cn for the opening engine view
- Inter via Google Fonts

## Sanity-check it

If something looks off, you can poke at the raw db:

```bash
sqlite3 chess_data.db
```

```sql
-- how many games per user
SELECT username, COUNT(*) FROM games GROUP BY username;

-- win rate as white for a given user
SELECT
    SUM(CASE WHEN white_result = 'win' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS win_rate_white
FROM games
WHERE white_username = 'moomootnt';

-- top openings by frequency
SELECT eco, COUNT(*) AS n
FROM games
WHERE username = 'moomootnt'
GROUP BY eco
ORDER BY n DESC
LIMIT 10;
```

Or run the analytics module directly for a json dump:

```bash
python analytics.py moomootnt
```

And `python "Test Analytics.py"` builds an in-memory db with games whose results are known and asserts every aggregation returns the expected numbers. Run that before touching anything in `analytics.py`.
