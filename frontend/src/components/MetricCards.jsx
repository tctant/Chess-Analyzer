// the four big stat cards across the top of the dashboard. total games,
// win rate, current blitz, current rapid. each card has a sublabel that
// shows trailing 12-month delta if available, peak rating otherwise.

function ratingChangeOverDays(series, days) {

    if (!series || series.length < 2) { return null; }

    var latest   = series[series.length - 1];
    var cutoff   = latest.t - days * 86400;
    var baseline = null;
    for (var point of series) {
        if (point.t >= cutoff) {
            baseline = point.rating;
            break;
        }
    }
    if (baseline === null) { return null; }
    return { delta: latest.rating - baseline, days };
}


function peakRating(series) {

    if (!series || !series.length) { return null; }
    return series.reduce((m, p) => Math.max(m, p.rating), -Infinity);
}


function formatDelta(delta) {

    if (delta === 0) { return 'Flat over the past year'; }
    var sign = delta > 0 ? '+' : '';
    return `${sign}${delta} in the past year`;
}


export function MetricCards({ summary }) {

    var rec         = summary.record_by_color;
    var totalGames  = rec.white.total + rec.black.total;
    var totalWins   = rec.white.win   + rec.black.win;
    var totalDraws  = rec.white.draw  + rec.black.draw;
    var totalLosses = rec.white.loss  + rec.black.loss;
    var winRate     = totalGames ? (totalWins / totalGames) * 100 : 0;

    var prog = summary.rating_progression;

    var latest = tc => {
        var series = prog[tc];
        return series && series.length ? series[series.length - 1].rating : null;
    };

    var sub = tc => {
        var series = prog[tc];
        if (!series || !series.length) { return null; }
        var change = ratingChangeOverDays(series, 365);
        if (change) { return formatDelta(change.delta); }
        var peak = peakRating(series);
        return peak ? `Peak ${peak}` : null;
    };

    var blitzRating = latest('blitz');
    var rapidRating = latest('rapid');

    return (
        <div className="metric-cards">
            <Metric
                label="Total games"
                value={totalGames.toLocaleString()}
                sub="Across all time classes"
            />
            <Metric
                label="Win rate"
                value={`${winRate.toFixed(1)}%`}
                sub={`${totalWins.toLocaleString()} W \u00b7 ${totalDraws.toLocaleString()} D \u00b7 ${totalLosses.toLocaleString()} L`}
            />
            <Metric
                label="Blitz"
                value={blitzRating ?? '-'}
                sub={sub('blitz')}
                tint="blitz"
            />
            <Metric
                label="Rapid"
                value={rapidRating ?? '-'}
                sub={sub('rapid')}
                tint="rapid"
            />
        </div>
    );
}


function Metric({ label, value, sub, tint }) {

    var valueClass = tint ? `value tinted-${tint}` : 'value';
    return (
        <div className="metric-card">
            <div className="label">{label}</div>
            <div className={valueClass}>{value}</div>
            {sub && <div className="sub">{sub}</div>}
        </div>
    );
}
