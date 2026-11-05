// dashboard top-openings card. table with W/D/L bars, click a row to
// drop down a list of recent games in that opening, click analyze to
// open the engine board.

import { useState, useEffect, Fragment } from 'react';
import { fetchOpenings, fetchGames } from '../api';
import { AnalysisBoard } from './AnalysisBoard';


// win rate thresholds for tinting the win-rate pill on each row
var GOOD_THRESHOLD = 0.52;
var BAD_THRESHOLD  = 0.48;

var TIME_CLASS_FILTERS = [
    { key: 'all',    label: 'All' },
    { key: 'bullet', label: 'Bullet' },
    { key: 'blitz',  label: 'Blitz' },
    { key: 'rapid',  label: 'Rapid' },
    { key: 'daily',  label: 'Daily' }
];

var RANGE_FILTERS = [
    { key: 'all',   label: 'All time', sinceDays: null },
    { key: 'year',  label: 'Year',     sinceDays: 365  },
    { key: 'month', label: 'Month',    sinceDays: 30   },
    { key: 'week',  label: 'Week',     sinceDays: 7    }
];


// chess.com eco slugs are wordy. make them readable.
//   "Sicilian-Defense-Marshall-Counterattack-4.exd5-exd5"
//     -> "Sicilian Defense · Marshall Counterattack"
function prettify(eco) {

    var cleaned = eco.replace(/-(\d+\.[\w-]+)+$/, '');
    var parts   = cleaned.split('-');
    var familyEnders = new Set([
        'Defense', 'Opening', 'Game', 'Gambit', 'Attack', 'System'
    ]);
    var split = -1;
    for (var i = 0; i < parts.length; i++) {
        if (familyEnders.has(parts[i])) {
            split = i;
            break;
        }
    }
    if (split === -1) { return parts.join(' '); }
    var family  = parts.slice(0, split + 1).join(' ');
    var variant = parts.slice(split + 1).join(' ');
    return variant ? `${family} · ${variant}` : family;
}


// `username` triggers refetch; `initial` is the openings list bundled
// in the /summary call so the first paint can be instant.
export function OpeningsTable({ username, initial }) {

    var [timeClass, setTimeClass] = useState('all');
    var [range, setRange]         = useState('all');
    var [openings, setOpenings]   = useState(initial || []);
    var [loading, setLoading]     = useState(false);

    // reset to bundled summary data when the user changes
    useEffect(() => {
        setOpenings(initial || []);
        setTimeClass('all');
        setRange('all');
    }, [initial]);

    // refetch whenever a filter is non-default. when both are 'all' the
    // cached `initial` data is fine, no need to hit the api.
    useEffect(() => {

        if (timeClass === 'all' && range === 'all') {
            setOpenings(initial || []);
            return;
        }
        var sinceDays = RANGE_FILTERS.find(r => r.key === range)?.sinceDays ?? null;
        var cancelled = false;
        setLoading(true);
        fetchOpenings(username, {
            timeClass: timeClass === 'all' ? null : timeClass,
            sinceDays
        })
            .then(data => { if (!cancelled) { setOpenings(data); } })
            .catch(() => {})
            .finally(() => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [username, timeClass, range, initial]);

    return (
        <>
            <div className="card-header">
                <h2>Top openings</h2>
                <div className="card-header-right">
                    <FilterPills
                        options={TIME_CLASS_FILTERS}
                        value={timeClass}
                        onChange={setTimeClass}
                    />
                    <FilterPills
                        options={RANGE_FILTERS}
                        value={range}
                        onChange={setRange}
                    />
                </div>
            </div>
            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
                <Table
                    rows={openings.slice(0, 8)}
                    username={username}
                    timeClass={timeClass}
                    range={range}
                />
            </div>
        </>
    );
}


function Table({ rows, username, timeClass, range }) {

    var [expandedKey, setExpandedKey] = useState(null);
    var [analyzeGame, setAnalyzeGame] = useState(null);

    if (!rows.length) {
        return (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                No openings with at least 5 games in this combination.
            </div>
        );
    }
    return (
        <>
            <table className="openings-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Opening</th>
                        <th className="num">Games</th>
                        <th className="num">Win rate</th>
                        <th style={{ width: '28%' }}>W / D / L</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(o => {
                        var key = `${o.eco}-${o.color}`;
                        var pillClass = o.win_rate > GOOD_THRESHOLD ? 'good'
                                      : o.win_rate < BAD_THRESHOLD  ? 'bad'
                                      : '';
                        var isExpanded = expandedKey === key;
                        return (
                            <Fragment key={key}>
                                <tr
                                    className={`opening-row ${isExpanded ? 'expanded' : ''}`}
                                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                                >
                                    <td className="expand-toggle">
                                        <span className={`chev ${isExpanded ? 'open' : ''}`}>›</span>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <ColorBadge color={o.color} />
                                            <span>{prettify(o.eco)}</span>
                                        </div>
                                    </td>
                                    <td className="num games">{o.games}</td>
                                    <td className="num">
                                        <span className={`win-pill ${pillClass}`}>
                                            {(o.win_rate * 100).toFixed(1)}%
                                        </span>
                                    </td>
                                    <td>
                                        <div className="wdl-bar">
                                            <div style={{ background: 'var(--green)', width: `${o.win_rate  * 100}%` }} />
                                            <div style={{ background: 'var(--tan)',   width: `${o.draw_rate * 100}%` }} />
                                            <div style={{ background: 'var(--red)',   width: `${o.loss_rate * 100}%` }} />
                                        </div>
                                    </td>
                                </tr>
                                {isExpanded && (
                                    <tr className="opening-expand-row">
                                        <td colSpan={5}>
                                            <GamesList
                                                username={username}
                                                eco={o.eco}
                                                color={o.color}
                                                timeClass={timeClass === 'all' ? null : timeClass}
                                                sinceDays={RANGE_FILTERS.find(r => r.key === range)?.sinceDays ?? null}
                                                onAnalyze={g => setAnalyzeGame(g)}
                                            />
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
            {analyzeGame && (
                <AnalysisBoard game={analyzeGame} onClose={() => setAnalyzeGame(null)} />
            )}
        </>
    );
}


function GamesList({ username, eco, color, timeClass, sinceDays, onAnalyze }) {

    var [games, setGames] = useState(null);
    var [error, setError] = useState(null);

    useEffect(() => {

        var cancelled = false;
        fetchGames(username, { eco, color, timeClass, sinceDays, limit: 20 })
            .then(data => { if (!cancelled) { setGames(data); } })
            .catch(err  => { if (!cancelled) { setError(err.message); } });
        return () => { cancelled = true; };
    }, [username, eco, color, timeClass, sinceDays]);

    if (error)         { return <div className="games-list-status">Couldn't load games: {error}</div>; }
    if (!games)        { return <div className="games-list-status">Loading games…</div>; }
    if (!games.length) { return <div className="games-list-status">No games match these filters.</div>; }

    return (
        <div className="games-list">
            {games.map(g => (
                <div key={g.url} className={`game-row result-${g.result}`}>
                    <div className="game-date">
                        {new Date(g.end_time * 1000).toLocaleDateString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric'
                        })}
                    </div>
                    <div className="game-vs">
                        <span className="game-rating">({g.my_rating ?? '-'})</span>
                        <span className="game-vs-sep">vs</span>
                        <span>{g.opponent}</span>
                        <span className="game-rating">({g.opp_rating ?? '-'})</span>
                    </div>
                    <div className={`game-result ${g.result}`}>{g.result.toUpperCase()}</div>
                    <button className="analyze-btn" onClick={() => onAnalyze(g)}>
                        Analyze
                    </button>
                </div>
            ))}
        </div>
    );
}


function ColorBadge({ color }) {

    var isWhite = color === 'white';
    return (
        <span
            className={`color-badge ${isWhite ? 'white' : 'black'}`}
            title={`Played as ${color}`}
            aria-label={`Played as ${color}`}
        >
            {isWhite ? 'W' : 'B'}
        </span>
    );
}


// reusable segmented-button group, used by this component and Heatmap.
// kept inline rather than splitting into its own file for one widget.
export function FilterPills({ options, value, onChange }) {

    return (
        <div className="filter-pills" role="group">
            {options.map(opt => (
                <button
                    key={opt.key}
                    className={value === opt.key ? 'active' : ''}
                    onClick={() => onChange(opt.key)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
