// searchable game log card. paginated table view of all games with filters,
// click a row to open the analysis modal. the search endpoint omits pgn
// (its heavy in bulk), so the modal fetches the actual pgn on demand.

import { useState, useEffect, useRef } from 'react';
import { searchGames, fetchGameByUrl } from '../api';
import { AnalysisBoard } from './AnalysisBoard';


var TIME_CLASS_OPTIONS = [
    { key: '',       label: 'All' },
    { key: 'bullet', label: 'Bullet' },
    { key: 'blitz',  label: 'Blitz' },
    { key: 'rapid',  label: 'Rapid' },
    { key: 'daily',  label: 'Daily' }
];

var COLOR_OPTIONS = [
    { key: '',      label: 'Both' },
    { key: 'white', label: 'White' },
    { key: 'black', label: 'Black' }
];

var RESULT_OPTIONS = [
    { key: '',     label: 'Any' },
    { key: 'win',  label: 'Wins' },
    { key: 'draw', label: 'Draws' },
    { key: 'loss', label: 'Losses' }
];

var PAGE_SIZE = 25;


export function GameLog({ username }) {

    var [opponent, setOpponent]   = useState('');
    var [color, setColor]         = useState('');
    var [result, setResult]       = useState('');
    var [timeClass, setTimeClass] = useState('');
    var [page, setPage]           = useState(0);

    var [data, setData]       = useState(null);
    var [loading, setLoading] = useState(false);
    var [error, setError]     = useState(null);

    // analysis modal state
    var [analyzeGame, setAnalyzeGame]   = useState(null);
    var [analyzeError, setAnalyzeError] = useState(null);

    // any filter change resets to page 0. opponent gets debounced so we
    // dont hammer the api on every keystroke.
    var debouncedOpponent = useDebounced(opponent, 300);

    useEffect(() => { setPage(0); }, [debouncedOpponent, color, result, timeClass]);

    useEffect(() => {

        var cancelled = false;
        setLoading(true);
        setError(null);
        searchGames(username, {
            opponent:  debouncedOpponent || null,
            color:     color     || null,
            result:    result    || null,
            timeClass: timeClass || null,
            limit:     PAGE_SIZE,
            offset:    page * PAGE_SIZE
        })
            .then(d  => { if (!cancelled) { setData(d); } })
            .catch(e => { if (!cancelled) { setError(e.message); setData(null); } })
            .finally(() => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [username, debouncedOpponent, color, result, timeClass, page]);

    async function onAnalyze(url) {

        setAnalyzeError(null);
        try {
            var game = await fetchGameByUrl(username, url);
            setAnalyzeGame(game);
        } catch (e) {
            setAnalyzeError(e.message);
        }
    }

    var totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

    return (
        <>
            <div className="card-header">
                <h2>Game log</h2>
                {data && (
                    <span className="subtitle">
                        {data.total.toLocaleString()} {data.total === 1 ? 'game' : 'games'}
                    </span>
                )}
            </div>

            <div className="game-log-filters">
                <input
                    className="game-log-search"
                    type="text"
                    value={opponent}
                    onChange={e => setOpponent(e.target.value)}
                    placeholder="Search by opponent…"
                    autoComplete="off"
                />
                <Select value={color}     onChange={setColor}     options={COLOR_OPTIONS}      label="Color" />
                <Select value={result}    onChange={setResult}    options={RESULT_OPTIONS}     label="Result" />
                <Select value={timeClass} onChange={setTimeClass} options={TIME_CLASS_OPTIONS} label="Time" />
            </div>

            {error        && <div className="games-list-status">Couldn't load: {error}</div>}
            {analyzeError && <div className="games-list-status">Couldn't open game: {analyzeError}</div>}

            <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.12s' }}>
                {data && data.rows.length === 0 && (
                    <div className="games-list-status">No games match these filters.</div>
                )}

                {data && data.rows.length > 0 && (
                    <div className="game-log-table">
                        {data.rows.map(g => (
                            <GameRow key={g.url} game={g} onAnalyze={() => onAnalyze(g.url)} />
                        ))}
                    </div>
                )}
            </div>

            {data && data.total > PAGE_SIZE && (
                <Pager
                    page={page}
                    totalPages={totalPages}
                    onChange={setPage}
                    disabled={loading}
                />
            )}

            {analyzeGame && (
                <AnalysisBoard game={analyzeGame} onClose={() => setAnalyzeGame(null)} />
            )}
        </>
    );
}


function GameRow({ game, onAnalyze }) {

    var date    = new Date(game.end_time * 1000);
    var dateStr = date.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });

    return (
        <div className="game-row">
            <span className="game-date">{dateStr}</span>
            <span className="game-vs">
                <span className={`color-badge ${game.my_color}`}>
                    {game.my_color[0].toUpperCase()}
                </span>
                <span>{game.opponent}</span>
                <span className="game-vs-sep">·</span>
                <span className="game-rating">{game.opp_rating}</span>
            </span>
            <span className={`game-result ${game.result}`}>
                {game.result === 'win'  ? 'W' :
                 game.result === 'loss' ? 'L' : 'D'}
            </span>
            <button className="analyze-btn" onClick={onAnalyze}>
                Analyze
            </button>
        </div>
    );
}


function Select({ value, onChange, options, label }) {

    return (
        <label className="game-log-select">
            <span className="game-log-select-label">{label}</span>
            <select value={value} onChange={e => onChange(e.target.value)}>
                {options.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                ))}
            </select>
        </label>
    );
}


function Pager({ page, totalPages, onChange, disabled }) {

    return (
        <div className="pager">
            <button
                onClick={() => onChange(page - 1)}
                disabled={disabled || page === 0}
            >
                ← Prev
            </button>
            <span className="pager-status">
                Page {page + 1} of {totalPages.toLocaleString()}
            </span>
            <button
                onClick={() => onChange(page + 1)}
                disabled={disabled || page >= totalPages - 1}
            >
                Next →
            </button>
        </div>
    );
}


// simple debounce - returns the value only after `delay` ms of no change.
// used so the opponent search box doesnt fire a request per keystroke.
function useDebounced(value, delay) {

    var [out, setOut] = useState(value);
    var timer         = useRef(null);

    useEffect(() => {

        if (timer.current) { clearTimeout(timer.current); }
        timer.current = setTimeout(() => setOut(value), delay);
        return () => { if (timer.current) { clearTimeout(timer.current); } };
    }, [value, delay]);

    return out;
}