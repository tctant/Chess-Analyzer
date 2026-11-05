// win rate by hour of day. answers the "do i play worse late at night"
// question. y-axis auto-scales around the user's overall win rate so the
// noise floor of a typical hour doesnt dominate the visible range.

import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine
} from 'recharts';


// any hour with fewer than this many games is suppressed from the line.
// without it, a 1-game bucket gives a 0% or 100% spike that's just noise.
var MIN_GAMES_FOR_POINT = 20;


function formatHourShort(h) {

    if (h === 0)  { return '12 AM'; }
    if (h === 6)  { return '6 AM';  }
    if (h === 12) { return '12 PM'; }
    if (h === 18) { return '6 PM';  }
    return '';
}


function formatHourLong(h) {

    if (h === 0)  { return '12 AM'; }
    if (h === 12) { return '12 PM'; }
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
}


function CustomTooltip({ active, payload, label }) {

    if (!active || !payload || !payload.length) { return null; }

    var row   = payload[0].payload;
    var total = row.games;
    var pct   = n => total ? ((n / total) * 100).toFixed(1) : '0.0';

    return (
        <div style={{
            background:   'var(--surface)',
            border:       '1px solid var(--border-2)',
            borderRadius: 8,
            padding:      '8px 10px',
            fontSize:     12,
            boxShadow:    '0 4px 12px rgba(0, 0, 0, 0.06)',
            color:        'var(--text)'
        }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
                {formatHourLong(label)} · {total.toLocaleString()} games
            </div>
            {row.winRate === null ? (
                <div style={{ color: 'var(--text-subtle)' }}>Not enough games</div>
            ) : (
                <>
                    <div style={{ color: 'var(--green)' }}>Wins: {row.wins.toLocaleString()} ({pct(row.wins)}%)</div>
                    <div style={{ color: 'var(--text-muted)' }}>Draws: {row.draws.toLocaleString()} ({pct(row.draws)}%)</div>
                    <div style={{ color: 'var(--red)' }}>Losses: {row.losses.toLocaleString()} ({pct(row.losses)}%)</div>
                </>
            )}
        </div>
    );
}


export function HourPerformance({ data }) {

    var totalGames = 0;
    var totalWins  = 0;
    for (var d of data) {
        totalGames += d.games;
        totalWins  += d.wins;
    }
    var baselineWinRate = totalGames ? (totalWins / totalGames) * 100 : 50;

    var chartData = data.map(d => ({
        hour:    d.hour,
        games:   d.games,
        wins:    d.wins,
        draws:   d.draws,
        losses:  d.losses,
        winRate: d.games >= MIN_GAMES_FOR_POINT && d.win_rate !== null
            ? +(d.win_rate * 100).toFixed(1)
            : null
    }));

    // y-domain that auto-fits but stays sensible. clamp the floor 5 points
    // below baseline so a single low-rate hour doesnt squash the chart,
    // ceiling 5 above so the line has room at the top.
    var validRates = chartData.map(d => d.winRate).filter(v => v !== null);
    var lo = Math.min(baselineWinRate - 5, ...validRates) - 2;
    var hi = Math.max(baselineWinRate + 5, ...validRates) + 2;

    return (
        <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 28, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatHourShort}
                        interval={0}
                    />
                    <YAxis
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        domain={[Math.floor(lo), Math.ceil(hi)]}
                        tickFormatter={v => `${v}%`}
                        width={36}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-2)', strokeWidth: 1 }} />
                    <ReferenceLine
                        y={baselineWinRate}
                        stroke="var(--text-subtle)"
                        strokeDasharray="3 3"
                        label={{
                            value:    `${baselineWinRate.toFixed(1)}% avg`,
                            position: 'right',
                            fill:     'var(--text-subtle)',
                            fontSize: 10
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="winRate"
                        stroke="var(--blitz)"
                        strokeWidth={2}
                        dot={{ fill: 'var(--blitz)', r: 2.5 }}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                        name="Win rate"
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
