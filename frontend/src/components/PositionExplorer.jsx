// position explorer page. a board you push pieces around on, and for every
// position it shows how many of your games reached it, how they went, and
// what got played next. the line lives in the url (?line=e2e4,e7e5) so a
// position can be linked straight to.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import Chessground from '@react-chess/chessground';

import { fetchPosition, fetchGameByUrl } from '../api';
import { AnalysisBoard } from './AnalysisBoard';


var COLORS = [
    { key: null,    label: 'Both' },
    { key: 'white', label: 'White' },
    { key: 'black', label: 'Black' }
];

var TIME_CLASSES = [
    { key: null,     label: 'All' },
    { key: 'bullet', label: 'Bullet' },
    { key: 'blitz',  label: 'Blitz' },
    { key: 'rapid',  label: 'Rapid' },
    { key: 'daily',  label: 'Daily' }
];


// promise cache shared across the page. the server caches too, but this
// skips the round trip entirely - going back a move or replaying a line
// you just looked at is instant.
var positionCache = new Map();
var CACHE_MAX     = 400;


function loadPosition(username, fen, color, timeClass) {

    var key = `${username}|${fen}|${color}|${timeClass}`;
    if (positionCache.has(key)) { return positionCache.get(key); }

    var p = fetchPosition(username, fen, { color, timeClass })
        .then(d => {
            // dont keep "still indexing" responses around, the next poll needs a real request
            if (d.status !== 'ready') { positionCache.delete(key); }
            return d;
        })
        .catch(e => {
            positionCache.delete(key);
            throw e;
        });

    if (positionCache.size >= CACHE_MAX) {
        positionCache.delete(positionCache.keys().next().value);
    }
    positionCache.set(key, p);
    return p;
}


// warm the cache for the likeliest next clicks so they render with no wait
function prefetchContinuations(username, fen, moves, color, timeClass) {

    for (var m of moves.slice(0, 3)) {
        var c = new Chess(fen);
        try {
            c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
        } catch {
            continue;
        }
        loadPosition(username, c.fen(), color, timeClass).catch(() => {});
    }
}


function legalDests(chess) {

    var dests = new Map();
    for (var m of chess.moves({ verbose: true })) {
        if (!dests.has(m.from)) { dests.set(m.from, []); }
        dests.get(m.from).push(m.to);
    }
    return dests;
}


// replay a list of uci moves, dropping anything illegal (a hand-edited url
// shouldnt crash the page)
function replay(ucis) {

    var chess = new Chess();
    var moves = [];
    for (var uci of ucis) {
        try {
            var m = chess.move({
                from: uci.slice(0, 2),
                to:   uci.slice(2, 4),
                promotion: uci.length > 4 ? uci[4] : undefined
            });
            moves.push({ uci, san: m.san, from: m.from, to: m.to });
        } catch {
            break;
        }
    }
    return moves;
}


function pct(n, total) {

    return total ? (n / total) * 100 : 0;
}


function scorePct(w, d, total) {

    return total ? Math.round(((w + d / 2) / total) * 100) : 0;
}


function WdlBar({ wins, draws, losses, showLabels }) {

    var total = wins + draws + losses;
    var segs  = [
        { key: 'win',  n: wins },
        { key: 'draw', n: draws },
        { key: 'loss', n: losses }
    ];
    return (
        <div className={`pe-wdl ${showLabels ? 'labelled' : ''}`}>
            {segs.map(s => s.n > 0 && (
                <div key={s.key} className={`pe-wdl-seg ${s.key}`} style={{ width: `${pct(s.n, total)}%` }}>
                    {showLabels && pct(s.n, total) >= 9 && `${Math.round(pct(s.n, total))}%`}
                </div>
            ))}
        </div>
    );
}


function Pills({ options, value, onChange }) {

    return (
        <div className="filter-pills">
            {options.map(o => (
                <button
                    key={o.label}
                    className={value === o.key ? 'active' : ''}
                    onClick={() => onChange(o.key)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}


export function PositionExplorer({ username }) {

    var [searchParams, setSearchParams] = useSearchParams();

    // full line plus a cursor into it, so stepping back and forward works
    // like a game viewer. playing a new move from mid-line drops the tail.
    var [line, setLine] = useState(() => {
        var raw = searchParams.get('line');
        return replay(raw ? raw.split(',').filter(Boolean) : []);
    });
    var [cursor, setCursor] = useState(line.length);

    var [color, setColor]         = useState(searchParams.get('color'));
    var [timeClass, setTimeClass] = useState(searchParams.get('tc'));
    var [orientation, setOrientation] = useState(searchParams.get('color') === 'black' ? 'black' : 'white');

    var [data, setData]       = useState(null);
    var [loading, setLoading] = useState(false);
    var [error, setError]     = useState(null);
    var [pollTick, setPollTick] = useState(0);
    var lastStatus = useRef(null);

    var [analyzeGame, setAnalyzeGame] = useState(null);

    var chess = useMemo(() => {
        var c = new Chess();
        for (var m of line.slice(0, cursor)) {
            c.move({ from: m.from, to: m.to, promotion: m.uci.length > 4 ? m.uci[4] : undefined });
        }
        return c;
    }, [line, cursor]);

    var fen       = chess.fen();
    var turnColor = chess.turn() === 'w' ? 'white' : 'black';

    // keep the url in step without piling up history entries
    useEffect(() => {

        var next = {};
        var played = line.slice(0, cursor).map(m => m.uci);
        if (played.length) { next.line = played.join(','); }
        if (color)         { next.color = color; }
        if (timeClass)     { next.tc = timeClass; }
        setSearchParams(next, { replace: true });
    }, [line, cursor, color, timeClass, setSearchParams]);

    useEffect(() => {

        var cancelled = false;
        var timer     = null;
        setLoading(true);
        setError(null);
        loadPosition(username, fen, color, timeClass)
            .then(d => {
                if (cancelled) { return; }
                lastStatus.current = d.status;
                setData({ ...d, fen });
                // first visit builds the index server side, poll until its done
                if (d.status === 'indexing') {
                    timer = setTimeout(() => setPollTick(t => t + 1), 2000);
                } else {
                    prefetchContinuations(username, fen, d.moves, color, timeClass);
                }
            })
            .catch(e => {
                if (cancelled) { return; }
                // a free-tier backend can drop a request while its busy indexing,
                // keep polling instead of parking on an error
                if (lastStatus.current === 'indexing') {
                    timer = setTimeout(() => setPollTick(t => t + 1), 3000);
                    return;
                }
                setError(e.message);
            })
            .finally(() => { if (!cancelled) { setLoading(false); } });
        return () => {
            cancelled = true;
            if (timer) { clearTimeout(timer); }
        };
    }, [username, fen, color, timeClass, pollTick]);

    var playMove = useCallback((from, to, promotion) => {

        var probe = new Chess(fen);
        var m;
        try {
            m = probe.move({ from, to, promotion: promotion || 'q' });
        } catch {
            return;
        }
        var uci = m.from + m.to + (m.promotion || '');

        // same move as the next one in the line - just step forward
        if (line[cursor] && line[cursor].uci === uci) {
            setCursor(cursor + 1);
            return;
        }
        setLine([...line.slice(0, cursor), { uci, san: m.san, from: m.from, to: m.to }]);
        setCursor(cursor + 1);
    }, [fen, line, cursor]);

    var goTo = useCallback(i => {

        setCursor(Math.max(0, Math.min(line.length, i)));
    }, [line.length]);

    useEffect(() => {

        var handler = e => {
            if (analyzeGame) { return; }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { return; }
            if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(cursor - 1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); goTo(cursor + 1); }
            if (e.key === 'Home')       { e.preventDefault(); goTo(0); }
            if (e.key === 'End')        { e.preventDefault(); goTo(line.length); }
            if (e.key === 'f')          { setOrientation(o => o === 'white' ? 'black' : 'white'); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cursor, line.length, goTo, analyzeGame]);

    var onColor = c => {
        setColor(c);
        if (c) { setOrientation(c); }
    };

    var ready = data && data.status === 'ready';
    var moves = ready ? data.moves : [];

    var cgConfig = useMemo(() => {

        var last = cursor > 0 ? line[cursor - 1] : null;

        // arrows for the three most played continuations, thicker = more games.
        // skip while the previous position's data is still on screen or the
        // arrows point at squares from the wrong position
        var top    = data && data.fen === fen ? moves.slice(0, 3) : [];
        var most   = top.length ? top[0].games : 1;
        var shapes = top.map(m => ({
            orig:  m.uci.slice(0, 2),
            dest:  m.uci.slice(2, 4),
            brush: 'paleBlue',
            modifiers: { lineWidth: 4 + Math.round((m.games / most) * 8) }
        }));

        return {
            fen,
            orientation,
            turnColor,
            lastMove:  last ? [last.from, last.to] : undefined,
            check:     chess.inCheck(),
            animation: { duration: 180 },
            movable: {
                free:   false,
                color:  turnColor,
                dests:  legalDests(chess),
                showDests: true,
                events: { after: (orig, dest) => playMove(orig, dest) }
            },
            premovable: { enabled: false },
            drawable:   { enabled: true, autoShapes: shapes }
        };
    }, [fen, orientation, turnColor, chess, line, cursor, moves, data, playMove]);

    var openGame = async url => {

        try {
            var g = await fetchGameByUrl(username, url);
            setAnalyzeGame(g);
        } catch (e) {
            setError(e.message);
        }
    };

    var userToMove = color ? turnColor === color : null;
    var movesTitle = userToMove === null ? 'Moves played here'
                   : userToMove          ? 'Your moves'
                   : 'Opponent replies';

    var pastIndexDepth = ready && cursor >= data.max_ply;

    return (
        <div className="pe">
            <div className="pe-board-col">
                <div className="pe-board board-frame">
                    <Chessground contained config={cgConfig} />
                </div>

                <div className="pe-controls">
                    <button onClick={() => goTo(0)} disabled={cursor === 0} title="Start (Home)">⏮</button>
                    <button onClick={() => goTo(cursor - 1)} disabled={cursor === 0} title="Back (←)">◀</button>
                    <button onClick={() => goTo(cursor + 1)} disabled={cursor >= line.length} title="Forward (→)">▶</button>
                    <button onClick={() => goTo(line.length)} disabled={cursor >= line.length} title="End">⏭</button>
                    <button
                        className="pe-flip"
                        onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
                        title="Flip board (f)"
                    >
                        Flip
                    </button>
                    <button
                        className="pe-reset"
                        onClick={() => { setLine([]); setCursor(0); }}
                        disabled={line.length === 0}
                    >
                        Reset
                    </button>
                </div>

                <div className="pe-line">
                    {line.length === 0 && <span className="pe-line-empty">Move a piece to start a line.</span>}
                    {line.map((m, i) => (
                        <span key={i} className="pe-line-ply">
                            {i % 2 === 0 && <span className="pe-line-num">{i / 2 + 1}.</span>}
                            <button
                                className={i === cursor - 1 ? 'active' : i >= cursor ? 'ahead' : ''}
                                onClick={() => goTo(i + 1)}
                            >
                                {m.san}
                            </button>
                        </span>
                    ))}
                </div>
            </div>

            <div className="pe-side">
                <div className="pe-filters">
                    <Pills options={COLORS} value={color} onChange={onColor} />
                    <Pills options={TIME_CLASSES} value={timeClass} onChange={setTimeClass} />
                </div>

                {error && <div className="pe-note error">Couldn't load: {error}</div>}

                {data && data.status === 'indexing' && (
                    <div className="pe-note">
                        Building your position index for the first time
                        {data.total ? ` (${data.done.toLocaleString()} / ${data.total.toLocaleString()} games)` : ''}.
                        This takes about a minute and only happens once.
                    </div>
                )}

                {!data && loading && <div className="pe-note">Loading…</div>}

                {ready && (
                    <div className="pe-results" style={{ opacity: loading ? 0.6 : 1 }}>
                        <section className="pe-summary">
                            <div className="pe-count">
                                <span className="pe-count-n">{data.games.toLocaleString()}</span>
                                <span className="pe-count-label">
                                    {data.games === 1 ? 'game reached this position' : 'games reached this position'}
                                </span>
                            </div>
                            {data.games > 0 && (
                                <>
                                    <WdlBar wins={data.wins} draws={data.draws} losses={data.losses} showLabels />
                                    <div className="pe-wdl-legend">
                                        <span className="win">{data.wins.toLocaleString()} won</span>
                                        <span className="draw">{data.draws.toLocaleString()} drawn</span>
                                        <span className="loss">{data.losses.toLocaleString()} lost</span>
                                        <span className="pe-score">{scorePct(data.wins, data.draws, data.games)}% score</span>
                                    </div>
                                </>
                            )}
                        </section>

                        {pastIndexDepth && (
                            <div className="pe-note">Positions are indexed through move {data.max_ply / 2}, so counts stop here.</div>
                        )}

                        {!pastIndexDepth && data.games === 0 && (
                            <div className="pe-note">
                                You haven't reached this position
                                {color ? ` as ${color}` : ''}{timeClass ? ` in ${timeClass}` : ''}.
                            </div>
                        )}

                        {moves.length > 0 && (
                            <section>
                                <h3 className="pe-h3">{movesTitle}</h3>
                                <table className="pe-moves">
                                    <thead>
                                        <tr>
                                            <th>Move</th>
                                            <th className="num">Games</th>
                                            <th>Result</th>
                                            <th className="num">Score</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {moves.map(m => (
                                            <tr
                                                key={m.uci}
                                                onClick={() => playMove(m.uci.slice(0, 2), m.uci.slice(2, 4), m.uci[4])}
                                            >
                                                <td className="pe-san">
                                                    {m.san}
                                                    {userToMove === null && m.mine === m.games && <span className="pe-you">you</span>}
                                                </td>
                                                <td className="num">{m.games.toLocaleString()}</td>
                                                <td className="pe-bar-cell">
                                                    <WdlBar wins={m.wins} draws={m.draws} losses={m.losses} />
                                                </td>
                                                <td className="num pe-score-cell">{scorePct(m.wins, m.draws, m.games)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>
                        )}

                        {data.recent.length > 0 && (
                            <section>
                                <h3 className="pe-h3">Recent games from here</h3>
                                <div className="pe-recent">
                                    {data.recent.map(g => (
                                        <div key={g.url} className="pe-recent-row">
                                            <span className={`color-badge ${g.my_color}`} />
                                            <span className="pe-recent-opp">
                                                {g.opponent}
                                                {g.opp_rating ? <span className="pe-recent-rating"> {g.opp_rating}</span> : null}
                                            </span>
                                            <span className="pe-recent-meta">
                                                {g.time_class} · {new Date(g.end_time * 1000).toLocaleDateString()}
                                            </span>
                                            <span className={`game-result ${g.result}`}>{g.result}</span>
                                            <button className="analyze-btn" onClick={() => openGame(g.url)}>Analyze</button>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>

            {analyzeGame && (
                <AnalysisBoard game={analyzeGame} username={username} onClose={() => setAnalyzeGame(null)} />
            )}
        </div>
    );
}
