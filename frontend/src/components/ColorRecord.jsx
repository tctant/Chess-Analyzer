// stacked horizontal w/d/l bar for white vs black. small companion to the
// time-class chart, lives in the same row of the dashboard.

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';


function CustomTooltip({ active, payload, label }) {

    if (!active || !payload || !payload.length) { return null; }

    var row   = payload[0].payload;
    var total = row.wins + row.draws + row.losses;
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
            <div style={{ fontWeight: 500, marginBottom: 4 }}>{label} ({total.toLocaleString()} games)</div>
            <div style={{ color: 'var(--green)' }}>Wins: {row.wins.toLocaleString()} ({pct(row.wins)}%)</div>
            <div style={{ color: 'var(--text-muted)' }}>Draws: {row.draws.toLocaleString()} ({pct(row.draws)}%)</div>
            <div style={{ color: 'var(--red)' }}>Losses: {row.losses.toLocaleString()} ({pct(row.losses)}%)</div>
        </div>
    );
}


export function ColorRecord({ record }) {

    var data = [
        { color: 'White', wins: record.white.win, draws: record.white.draw, losses: record.white.loss },
        { color: 'Black', wins: record.black.win, draws: record.black.draw, losses: record.black.loss }
    ];

    return (
        <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer>
                <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        type="category"
                        dataKey="color"
                        tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        width={50}
                    />
                    <Tooltip
                        cursor={{ fill: 'var(--surface-2)' }}
                        content={<CustomTooltip />}
                    />
                    <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 8, color: 'var(--text-muted)' }}
                        iconType="square"
                        iconSize={10}
                    />
                    <Bar dataKey="wins"   stackId="a" fill="var(--green)" name="Wins" />
                    <Bar dataKey="draws"  stackId="a" fill="var(--tan)"   name="Draws" />
                    <Bar dataKey="losses" stackId="a" fill="var(--red)"   name="Losses" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
