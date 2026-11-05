// the analysis modal. opens when you click "analyze" on any game row.
// shows the position, an eval bar fed by stockfish, the move list with
// per-move clock readings, and an opening explorer tab. left/right arrows
// navigate moves, "play from here" enters a sandbox where you can try
// alternative lines.

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Chess } from 'chess.js';
import Chessground from '@react-chess/chessground';
import { useStockfish, formatScore } from './useStockfish';
import { OpeningExplorer } from './OpeningExplorer';


var DEPTHS = [
    { key: 'quick',    label: 'Quick',    depth: 12 },
    { key: 'standard', label: 'Standard', depth: 18 },
    { key: 'deep',     label: 'Deep',     depth: 22 }
];


// chess.com pgns annotate every move with {[%clk H:MM:SS(.s)]} - the clock
// reading at the time the move was played. parse those out so we can
// show per-move time in the move list.
function parseClockSec(comment) {

    if (!comment) { return null; }
    var m = comment.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
    if (!m) { return null; }
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}


// "180+2" -> { base: 180, increment: 2 }, "600" -> { base: 600, increment: 0 }
function parseTimeControl(tc) {

    if (!tc) { return { base: 0, increment: 0 }; }
    var m = String(tc).match(/^(\d+)(?:\+(\d+))?$/);
    if (!m) { return { base: 0, increment: 0 }; }
    return { base: parseInt(m[1], 10), increment: m[2] ? parseInt(m[2], 10) : 0 };
}


// turn chess.js move history into a clean list of moves where each entry
// has the resulting fen, the clock reading at that point, and the time
// the player actually spent on the move (with increment math).
function expandPgn(pgn) {

    var game = new Chess();
    try {
        game.loadPgn(pgn);
    } catch {
        return { startFen: new Chess().fen(), moves: [], headers: {} };
    }
    var headers  = game.header();
    var startFen = headers.FEN || new Chess().fen();
    var tc       = parseTimeControl(headers.TimeControl);

    // map every commented position to its raw comment string so we can
    // look up the clock reading for the move that produced that position
    var commentsByFen = {};
    try {
        for (var c of game.getComments()) {
            commentsByFen[c.fen] = c.comment;
        }
    } catch {
        // chess.js versions vary on whether getComments exists - if it doesnt,
        // fall through silently with no clock data
    }

    var replay = new Chess(startFen);
    var moves  = [];

    // each colour's previous clock reading, for "time spent on this move"
    var prevClock = { w: tc.base || null, b: tc.base || null };

    for (var m of game.history({ verbose: true })) {
        replay.move({ from: m.from, to: m.to, promotion: m.promotion });
        var fen      = replay.fen();
        var clockSec = parseClockSec(commentsByFen[fen]);

        // time spent = previous clock - current clock + increment.
        // first move has no reliable "previous", leave spentSec null.
        var spentSec = null;
        var before   = prevClock[m.color];
        if (clockSec != null && before != null) {
            var delta = before - clockSec + tc.increment;
            // negative deltas mean malformed clock data (or the player hit
            // the clock late) - clamp to 0 so the ui doesnt look weird
            spentSec = Math.max(0, delta);
        }
        if (clockSec != null) { prevClock[m.color] = clockSec; }

        moves.push({
            san:   m.san,
            fen,
            color: m.color,
            from:  m.from,
            to:    m.to,
            ply:   moves.length + 1,
            clockSec,
            spentSec
        });
    }
    return { startFen, moves, headers };
}


// chess.js -> chessground dests Map for the current position
function legalDests(chess) {

    var dests = new Map();
    for (var m of chess.moves({ verbose: true })) {
        if (!dests.has(m.from)) { dests.set(m.from, []); }
        dests.get(m.from).push(m.to);
    }
    return dests;
}


export function AnalysisBoard({ game, username, onClose }) {

    var { startFen, moves } = useMemo(() => expandPgn(game.pgn), [game.pgn]);

    var [moveIdx, setMoveIdx]         = useState(moves.length - 1);
    var [depthChoice, setDepthChoice] = useState('standard');
    var [explore, setExplore]         = useState(false);
    var [sidebarTab, setSidebarTab]   = useState('moves');   // 'moves' | 'explorer'

    // when the user enters explore mode we drop them into a sandbox chess
    // instance with their own moves applied
    var exploreChessRef           = useRef(null);
    var [exploreFen, setExploreFen] = useState(null);

    var currentFen = useMemo(() => {
        if (explore && exploreFen) { return exploreFen; }
        if (moveIdx < 0)            { return startFen; }
        return moves[moveIdx]?.fen ?? startFen;
    }, [explore, exploreFen, moveIdx, moves, startFen]);

    var { ready: sfReady, info, analyze } = useStockfish();

    var turnColor = useMemo(() => {
        try {
            return new Chess(currentFen).turn() === 'w' ? 'white' : 'black';
        } catch {
            return 'white';
        }
    }, [currentFen]);

    var orientation = game.my_color === 'black' ? 'black' : 'white';

    // re-trigger stockfish on every position change
    useEffect(() => {

        if (!sfReady) { return; }
        var depth = DEPTHS.find(d => d.key === depthChoice)?.depth ?? 18;
        analyze(currentFen, { depth });
    }, [sfReady, currentFen, depthChoice, analyze]);

    // arrow-key navigation
    var goTo = useCallback(idx => {

        setExplore(false);
        setExploreFen(null);
        exploreChessRef.current = null;
        setMoveIdx(Math.max(-1, Math.min(moves.length - 1, idx)));
    }, [moves.length]);

    useEffect(() => {

        var handler = e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { return; }
            if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(moveIdx - 1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); goTo(moveIdx + 1); }
            if (e.key === 'Home')       { e.preventDefault(); goTo(-1); }
            if (e.key === 'End')        { e.preventDefault(); goTo(moves.length - 1); }
            if (e.key === 'Escape')     { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [moveIdx, moves.length, goTo, onClose]);

    // "play from here" sandbox
    var startExplore = () => {
        var chess = new Chess(currentFen);
        exploreChessRef.current = chess;
        setExploreFen(chess.fen());
        setExplore(true);
    };

    var onUserMove = useCallback((orig, dest) => {

        var chess = exploreChessRef.current;
        if (!chess) { return; }
        var move;
        try {
            move = chess.move({ from: orig, to: dest, promotion: 'q' });
        } catch {
            return;
        }
        if (!move) { return; }
        setExploreFen(chess.fen());
    }, []);

    var exitExplore = () => {
        setExplore(false);
        setExploreFen(null);
        exploreChessRef.current = null;
    };

    // play a move suggested by the opening explorer. auto-enters explore
    // mode from the current position if were still in replay mode, so the
    // user doesnt have to click "play from here" first.
    var playExplorerMove = useCallback(moveSpec => {

        var chess = exploreChessRef.current;
        if (!chess) {
            chess = new Chess(currentFen);
            exploreChessRef.current = chess;
            setExplore(true);
        }
        try {
            chess.move({
                from: moveSpec.from,
                to:   moveSpec.to,
                promotion: moveSpec.promotion || 'q'
            });
        } catch {
            return;
        }
        setExploreFen(chess.fen());
    }, [currentFen]);

    // chessground config. the react wrapper takes the same shape as the
    // raw chessground constructor.
    var cgConfig = useMemo(() => {

        var base = {
            fen: currentFen,
            orientation,
            turnColor,
            animation: { duration: 200 },
            drawable:  { enabled: true, eraseOnClick: true, autoShapes: [] }
        };
        if (explore && exploreChessRef.current) {
            base.movable = {
                free:   false,
                color:  turnColor,
                dests:  legalDests(exploreChessRef.current),
                events: { after: onUserMove }
            };
        } else {
            base.movable = { free: false, color: undefined, dests: new Map() };
            if (moveIdx >= 0) { base.lastMove = [moves[moveIdx].from, moves[moveIdx].to]; }
        }
        // best-move arrow from stockfish. only render when the pv's first
        // move is from the current position - prevents stale arrows from a
        // previous position lingering while the engine starts fresh.
        if (info.pv && info.pv.length && info.pv[0].length >= 4 && info.fenForPv === currentFen) {
            var orig = info.pv[0].slice(0, 2);
            var dest = info.pv[0].slice(2, 4);
            base.drawable.autoShapes = [{ orig, dest, brush: 'paleBlue' }];
        }
        return base;
    }, [currentFen, orientation, turnColor, explore, moveIdx, moves, info.pv, info.fenForPv, onUserMove]);

    var score = formatScore(info.score);
    var evalForOrientation = useMemo(() => {
        if (!info.score) { return 0; }
        var signed = score.signed;
        if (turnColor === 'black') { signed = -signed; }
        return signed;
    }, [info.score, score.signed, turnColor]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="analysis-modal" onClick={e => e.stopPropagation()}>
                <header className="analysis-header">
                    <div>
                        <div className="analysis-title">
                            {game.my_color === 'white' ? 'White' : 'Black'} vs {game.opponent}
                            {game.opp_rating ? ` (${game.opp_rating})` : ''}
                        </div>
                        <div className="analysis-sub">
                            {new Date(game.end_time * 1000).toLocaleDateString()} ·
                            {' '}{game.time_class} ·
                            {' '}<span className={`result-tag ${game.result}`}>{game.result.toUpperCase()}</span>
                            {' · '}<a href={game.url} target="_blank" rel="noreferrer">View on chess.com</a>
                        </div>
                    </div>
                    <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
                </header>

                <div className="analysis-body">
                    <div className="analysis-board-wrap">
                        <EvalBar
                            evaluation={evalForOrientation}
                            mate={score.mate}
                            orientation={orientation}
                        />
                        <div className="analysis-board">
                            <Chessground contained config={cgConfig} />
                        </div>
                    </div>

                    <div className="analysis-side">
                        <div className="eval-readout">
                            <div className="eval-score">
                                {!sfReady ? 'Loading engine…' : score.text}
                            </div>
                            <div className="eval-meta">
                                {sfReady && info.depth ? `depth ${info.depth}` : ''}
                            </div>
                        </div>

                        <div className="analysis-controls">
                            <div className="analysis-pills">
                                {DEPTHS.map(d => (
                                    <button
                                        key={d.key}
                                        className={depthChoice === d.key ? 'active' : ''}
                                        onClick={() => setDepthChoice(d.key)}
                                    >
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                            {!explore ? (
                                <button className="explore-btn" onClick={startExplore}>
                                    Play from here
                                </button>
                            ) : (
                                <button className="explore-btn active" onClick={exitExplore}>
                                    Exit exploration
                                </button>
                            )}
                        </div>

                        <div className="sidebar-tabs">
                            <button
                                className={sidebarTab === 'moves' ? 'active' : ''}
                                onClick={() => setSidebarTab('moves')}
                            >
                                Game moves
                            </button>
                            <button
                                className={sidebarTab === 'explorer' ? 'active' : ''}
                                onClick={() => setSidebarTab('explorer')}
                            >
                                Explorer
                            </button>
                        </div>

                        {sidebarTab === 'moves' && (
                            <MoveList
                                moves={moves}
                                moveIdx={moveIdx}
                                onSelect={goTo}
                                disabled={explore}
                            />
                        )}
                        {sidebarTab === 'explorer' && (
                            <OpeningExplorer fen={currentFen} username={username} onPickMove={playExplorerMove} />
                        )}

                        <div className="nav-buttons">
                            <button onClick={() => goTo(-1)}                disabled={moveIdx === -1}                  title="Start (Home)">⏮</button>
                            <button onClick={() => goTo(moveIdx - 1)}       disabled={moveIdx === -1}                  title="Previous (←)">◀</button>
                            <button onClick={() => goTo(moveIdx + 1)}       disabled={moveIdx === moves.length - 1}    title="Next (→)">▶</button>
                            <button onClick={() => goTo(moves.length - 1)}  disabled={moveIdx === moves.length - 1}    title="End (End)">⏭</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


function EvalBar({ evaluation, mate, orientation }) {

    // logistic squash of the eval into 0..100. k=2 means +/- 2 pawns maps
    // to ~88/12, which lines up with how lichess and chess.com draw their
    // bars at this rating range.
    var whitePct;
    if (mate != null) {
        whitePct = mate > 0 ? 100 : 0;
    } else {
        var sig = 1 / (1 + Math.exp(-evaluation / 2));
        whitePct = sig * 100;
    }

    var flip = orientation === 'black';
    return (
        <div className={`eval-bar ${flip ? 'flipped' : ''}`}>
            <div className="eval-fill" style={{ height: `${whitePct}%` }} />
        </div>
    );
}


// 9:54 / 0:42 / 1:23:45. h:mm:ss only when there's an hour to show.
function formatClock(seconds) {

    if (seconds == null) { return null; }
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}


// classify time-spent so the css can tint long thinks differently. thresholds
// picked by feel for what reads as "quick / pondered / long / time scramble"
// in blitz play - tweak as needed.
function classifyThink(spentSec, clockSec) {

    if (spentSec == null) { return ''; }
    if (clockSec != null && clockSec < 30) { return 'time-scramble'; }
    if (spentSec >= 30) { return 'long-think'; }
    if (spentSec >= 10) { return 'medium-think'; }
    return '';
}


function MoveList({ moves, moveIdx, onSelect, disabled }) {

    var pairs = [];
    for (var i = 0; i < moves.length; i += 2) {
        pairs.push({
            number:   Math.floor(i / 2) + 1,
            white:    moves[i],
            black:    moves[i + 1],
            whiteIdx: i,
            blackIdx: i + 1
        });
    }

    // any clock data at all? if not, hide the time column entirely so daily
    // games (no clock annotations in pgn) look the same as before.
    var hasClocks = moves.some(m => m.clockSec != null);

    var listRef = useRef(null);
    useEffect(() => {
        if (!listRef.current || moveIdx < 0) { return; }
        var el = listRef.current.querySelector(`[data-ply="${moveIdx}"]`);
        if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }, [moveIdx]);

    return (
        <div className={`move-list ${hasClocks ? 'with-clocks' : ''}`} ref={listRef}>
            {pairs.map(p => (
                <div key={p.number} className="move-row">
                    <span className="move-num">{p.number}.</span>
                    <MoveCell
                        move={p.white}
                        ply={p.whiteIdx}
                        active={p.whiteIdx === moveIdx}
                        disabled={disabled}
                        onSelect={onSelect}
                        showClock={hasClocks}
                    />
                    {p.black ? (
                        <MoveCell
                            move={p.black}
                            ply={p.blackIdx}
                            active={p.blackIdx === moveIdx}
                            disabled={disabled}
                            onSelect={onSelect}
                            showClock={hasClocks}
                        />
                    ) : <span />}
                </div>
            ))}
        </div>
    );
}


function MoveCell({ move, ply, active, disabled, onSelect, showClock }) {

    var clockText  = showClock ? formatClock(move.clockSec) : null;
    var thinkClass = classifyThink(move.spentSec, move.clockSec);
    var tooltip    = move.spentSec != null
        ? `${move.san} · ${move.spentSec.toFixed(1)}s spent`
        : move.san;

    return (
        <button
            data-ply={ply}
            className={`move ${active ? 'active' : ''} ${thinkClass}`}
            onClick={() => onSelect(ply)}
            disabled={disabled}
            title={tooltip}
        >
            <span className="move-san">{move.san}</span>
            {clockText && <span className="move-clock">{clockText}</span>}
        </button>
    );
}
