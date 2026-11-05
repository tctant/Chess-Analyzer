// horizontal stacked w/d/l bars per time class. one row per format the user
// has played, bar length scales to total game count and stack widths show
// the win/draw/loss split. shows shape, magnitude, and sample size at once -
// replaces the earlier floating-bars-with-percentages version which was
// hard to read across rating ranges.

var DISPLAY_ORDER = ['bullet', 'blitz', 'rapid', 'daily'];


export function TimeClassChart({ performance }) {

    var rows = DISPLAY_ORDER
        .filter(tc => performance[tc] && performance[tc].games > 0)
        .map(tc => ({
            key:     tc,
            name:    tc[0].toUpperCase() + tc.slice(1),
            games:   performance[tc].games,
            wins:    performance[tc].wins,
            draws:   performance[tc].draws,
            losses:  performance[tc].losses,
            winRate: performance[tc].win_rate
        }));

    if (rows.length === 0) {
        return <div className="time-class-empty">No games yet.</div>;
    }

    // peg the longest bar to the format with the most games, scale the
    // rest relative to that so you can compare totals across formats
    var maxGames = Math.max(...rows.map(r => r.games));

    return (
        <div className="time-class-rows">
            {rows.map(r => {
                var widthPct = (r.games  / maxGames) * 100;
                var winPct   = (r.wins   / r.games)  * 100;
                var drawPct  = (r.draws  / r.games)  * 100;
                var lossPct  = (r.losses / r.games)  * 100;

                return (
                    <div key={r.key} className="time-class-row">
                        <div className="time-class-label">
                            <span className={`time-class-dot tc-${r.key}`} />
                            {r.name}
                        </div>
                        <div className="time-class-bar-wrap">
                            <div className="time-class-bar" style={{ width: `${widthPct}%` }}>
                                <div className="bar-segment win"  style={{ width: `${winPct}%`  }} />
                                <div className="bar-segment draw" style={{ width: `${drawPct}%` }} />
                                <div className="bar-segment loss" style={{ width: `${lossPct}%` }} />
                            </div>
                        </div>
                        <div className="time-class-stats">
                            <span className="time-class-rate">{(r.winRate * 100).toFixed(1)}%</span>
                            <span className="time-class-games">{r.games.toLocaleString()} games</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
