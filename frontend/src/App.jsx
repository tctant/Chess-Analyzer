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


var TZ_OFFSET_HOURS = 0;


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


export default function App() {

    return (
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route path="/u/:username" element={<UserPage />} />
                <Route path="/"            element={<LandingPage />} />
                <Route path="*"            element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}


function LandingPage() {

    var navigate               = useNavigate();
    var [theme, toggleTheme]   = useTheme();
    var [input, setInput]      = useState('');

    var onSubmit = e => {
        e.preventDefault();
        var trimmed = input.trim();
        if (trimmed) { navigate(`/u/${trimmed}`); }
    };

    return (
        <div className="app">
            <div className="app-header">
                <div>
                    <div className="eyebrow">Chess.com analytics</div>
                    <h1>Chess Analyzer</h1>
                    <div className="meta">
                        Personal performance dashboard for any Chess.com player.
                    </div>
                </div>
                <div className="header-right">
                    <ThemeToggle theme={theme} onToggle={toggleTheme} />
                </div>
            </div>

            <form className="username-form" onSubmit={onSubmit}>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Enter a Chess.com username"
                    autoComplete="off"
                    autoFocus
                />
                <button type="submit" disabled={!input.trim()}>
                    View dashboard
                </button>
            </form>

            <div className="status">
                Try a username like <a href="/u/MagnusCarlsen">MagnusCarlsen</a> or{' '}
                <a href="/u/Hikaru">Hikaru</a>.
                <div style={{ marginTop: 8, fontSize: 13 }}>
                    New usernames will sync from Chess.com automatically. The first
                    sync takes a couple minutes for active players.
                </div>
            </div>
        </div>
    );
}


function UserPage() {

    var { username }         = useParams();
    var navigate             = useNavigate();
    var [theme, toggleTheme] = useTheme();

    var [input, setInput]     = useState(username);
    var [summary, setSummary] = useState(null);
    var [error, setError]     = useState(null);
    var [loading, setLoading] = useState(false);

    // refetch when the route's :username changes
    useEffect(() => {

        if (!username) { return; }
        setInput(username);
        var cancelled = false;
        setLoading(true);
        setError(null);
        fetchSummary(username, TZ_OFFSET_HOURS)
            .then(data => { if (!cancelled) { setSummary(data); } })
            .catch(err => { if (!cancelled) { setError(err.message); setSummary(null); } })
            .finally(()  => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [username]);

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
        fetchSummary(username, TZ_OFFSET_HOURS)
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
                                <span className="subtitle">Min 20 games per hour</span>
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
                                tzOffsetHours={TZ_OFFSET_HOURS}
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
