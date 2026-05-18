// the dashboard shell. router decides between landing page and per-user
// dashboard; the dashboard fetches /summary once and feeds each card the
// piece it cares about. error boundaries wrap every card so one bad chart
// cant blank the whole page.

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, Navigate } from 'react-router-dom';

import { fetchSummary }       from './api';
import { MetricCards }        from './components/MetricCards';
import { RatingChart }        from './components/RatingChart';
import { ColorRecord }        from './components/ColorRecord';
import { TimeClassChart }     from './components/TimeClassChart';
import { OpeningsTable }      from './components/OpeningsTable';
import { Heatmap }            from './components/Heatmap';
import { HourPerformance }    from './components/HourPerformance';
import { GameLog }            from './components/GameLog';
import { SyncButton }         from './components/SyncButton';
import { ErrorBoundary }      from './components/ErrorBoundary';
import { DashboardSkeleton }  from './components/DashboardSkeleton';


// the user whose data was pre-synced at build time. landing on the root
// redirects to their dashboard so visitors see something immediately.
var DEFAULT_USERNAME = 'MooMooTNT';


function useTheme() {

    var [theme, setTheme] = useState(() => {
        if (typeof window === 'undefined') { return 'light'; }
        var stored = window.localStorage.getItem('theme');
        if (stored === 'light' || stored === 'dark') { return stored; }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        window.localStorage.setItem('theme', theme);
    }, [theme]);

    return [theme, () => setTheme(t => t === 'dark' ? 'light' : 'dark')];
}


// 'local' or 'utc'. local is auto-detected from the browser. persisted to
// localStorage so the choice sticks across reloads.
function useTimezone() {

    var [mode, setMode] = useState(() => {
        if (typeof window === 'undefined') { return 'local'; }
        var stored = window.localStorage.getItem('tz_mode');
        return stored === 'utc' ? 'utc' : 'local';
    });

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem('tz_mode', mode);
        }
    }, [mode]);

    var offsetHours = mode === 'utc'
        ? 0
        : -new Date().getTimezoneOffset() / 60;

    return { mode, setMode, offsetHours };
}


function tzLabel(mode) {

    if (mode === 'utc') { return 'UTC'; }
    // 'America/Phoenix' -> 'Phoenix'
    try {
        var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        var parts = zone.split('/');
        return parts[parts.length - 1].replace(/_/g, ' ');
    } catch (e) {
        return 'Local';
    }
}


function SunIcon() {

    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
    );
}


function MoonIcon() {

    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
    );
}


function ThemeToggle({ theme, onToggle }) {

    return (
        <button
            className="theme-toggle"
            onClick={onToggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
    );
}


function TimezoneToggle({ mode, onChange }) {

    return (
        <select
            className="tz-toggle"
            value={mode}
            onChange={e => onChange(e.target.value)}
            title="Timezone for the heatmap and hour-of-day charts"
        >
            <option value="local">{tzLabel('local')}</option>
            <option value="utc">UTC</option>
        </select>
    );
}


export default function App() {

    return (
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route path="/u/:username" element={<UserPage />} />
                <Route path="/" element={<Navigate to={`/u/${DEFAULT_USERNAME}`} replace />} />
                <Route path="*" element={<Navigate to={`/u/${DEFAULT_USERNAME}`} replace />} />
            </Routes>
        </BrowserRouter>
    );
}


function UserPage() {

    var { username }         = useParams();
    var navigate             = useNavigate();
    var [theme, toggleTheme] = useTheme();
    var tz                   = useTimezone();

    var [input, setInput]     = useState(username);
    var [summary, setSummary] = useState(null);
    var [error, setError]     = useState(null);
    var [loading, setLoading] = useState(false);

    // refetch when the route's :username changes, or when the user flips
    // the timezone toggle (which affects the heatmap and hour data)
    useEffect(() => {

        if (!username) { return; }
        setInput(username);
        var cancelled = false;
        setLoading(true);
        setError(null);
        fetchSummary(username, tz.offsetHours)
            .then(data => { if (!cancelled) { setSummary(data); } })
            .catch(err => { if (!cancelled) { setError(err.message); setSummary(null); } })
            .finally(()  => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [username, tz.offsetHours]);

    var onSubmit = e => {
        e.preventDefault();
        var trimmed = input.trim();
        if (trimmed && trimmed !== username) {
            navigate(`/u/${trimmed}`);
        }
    };

    // sync just finished -> drop the cached summary and refetch
    var onSyncComplete = () => {
        setSummary(null);
        setError(null);
        setLoading(true);
        fetchSummary(username, tz.offsetHours)
            .then(setSummary)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    var totalGames = summary
        ? summary.record_by_color.white.total + summary.record_by_color.black.total
        : 0;

    return (
        <div className="app">
            <div className="app-header">
                <div>
                    <div className="eyebrow">Chess.com analytics</div>
                    <h1>{summary ? username : 'Chess Analyzer'}</h1>
                    {summary && (
                        <div className="meta">{totalGames.toLocaleString()} games</div>
                    )}
                </div>
                <div className="header-right">
                    <TimezoneToggle mode={tz.mode} onChange={tz.setMode} />
                    <ThemeToggle theme={theme} onToggle={toggleTheme} />
                </div>
            </div>

            <form className="username-form" onSubmit={onSubmit}>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Chess.com username"
                    autoComplete="off"
                />
                <button type="submit" disabled={loading || !input.trim()}>
                    {loading ? 'Loading…' : 'Load'}
                </button>
                <SyncButton username={username} onComplete={onSyncComplete} />
            </form>

            {error && (
                <div className="status">
                    <strong>Couldn't load.</strong> {error}
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                        Click <strong>Sync</strong> above to pull this user's games from Chess.com.
                        The first sync takes 2-3 minutes for active players.
                    </div>
                </div>
            )}

            {!error && !summary && loading && <DashboardSkeleton />}

            {!error && summary && (
                <div className="dashboard">
                    <ErrorBoundary label="Couldn't render summary cards">
                        <MetricCards summary={summary} />
                    </ErrorBoundary>

                    <ErrorBoundary label="Couldn't render rating chart">
                        <div className="card">
                            <div className="card-header">
                                <h2>Rating progression</h2>
                                <RatingLegend progression={summary.rating_progression} />
                            </div>
                            <RatingChart progression={summary.rating_progression} />
                        </div>
                    </ErrorBoundary>

                    <ErrorBoundary label="Couldn't render openings table">
                        <div className="card">
                            <OpeningsTable username={username} initial={summary.top_openings} />
                        </div>
                    </ErrorBoundary>

                    <ErrorBoundary label="Couldn't render hour performance">
                        <div className="card">
                            <div className="card-header">
                                <h2>Win rate by hour of day</h2>
                                <span className="subtitle">Min 20 games per hour · {tzLabel(tz.mode)}</span>
                            </div>
                            <HourPerformance data={summary.performance_by_hour} />
                        </div>
                    </ErrorBoundary>

                    <div className="row-2">
                        <ErrorBoundary label="Couldn't render time class chart">
                            <div className="card">
                                <div className="card-header">
                                    <h2>Win rate by time control</h2>
                                </div>
                                <TimeClassChart performance={summary.performance_by_time_class} />
                            </div>
                        </ErrorBoundary>
                        <ErrorBoundary label="Couldn't render color record">
                            <div className="card">
                                <div className="card-header">
                                    <h2>Record by color</h2>
                                </div>
                                <ColorRecord record={summary.record_by_color} />
                            </div>
                        </ErrorBoundary>
                    </div>

                    <ErrorBoundary label="Couldn't render activity heatmap">
                        <div className="card">
                            <Heatmap
                                username={username}
                                tzOffsetHours={tz.offsetHours}
                                tzLabel={tzLabel(tz.mode)}
                                initial={summary.activity_heatmap}
                            />
                        </div>
                    </ErrorBoundary>

                    <ErrorBoundary label="Couldn't render game log">
                        <div className="card">
                            <GameLog username={username} />
                        </div>
                    </ErrorBoundary>
                </div>
            )}
        </div>
    );
}


function RatingLegend({ progression }) {

    var order   = ['blitz', 'rapid', 'bullet', 'daily'];
    var present = order.filter(tc => progression[tc] && progression[tc].length);
    return (
        <div className="legend-inline">
            {present.map(tc => (
                <span key={tc}>
                    <i style={{ background: `var(--${tc})` }} />
                    {tc[0].toUpperCase() + tc.slice(1)}
                </span>
            ))}
        </div>
    );
}
