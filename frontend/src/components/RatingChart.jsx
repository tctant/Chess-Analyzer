// rating-over-time chart, one line per time class. handles a few quirks:
// - downsamples to ~200 points per series (recharts gets slow at 5000+)
// - extends each series forward to "now" with a flat line so a format you
//   stopped playing 6 months ago doesnt visually drop off the edge
// - clamps the y-axis to 2nd-98th percentile so a fresh provisional rating
//   doesnt squash the whole chart

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';


var SERIES_ORDER = ['blitz', 'rapid', 'bullet', 'daily'];


function downsample(series, target = 200) {

    if (series.length <= target) { return series; }
    var step = Math.ceil(series.length / target);
    var out = [];
    for (var i = 0; i < series.length; i += step) {
        out.push(series[i]);
    }
    if (out[out.length - 1] !== series[series.length - 1]) {
        out.push(series[series.length - 1]);
    }
    return out;
}


function percentileDomain(progression) {

    var all = [];
    for (var series of Object.values(progression)) {
        for (var p of series) { all.push(p.rating); }
    }
    if (all.length < 10) { return ['auto', 'auto']; }
    all.sort((a, b) => a - b);
    var at  = q => all[Math.floor((all.length - 1) * q)];
    var lo  = at(0.02);
    var hi  = at(0.98);
    var pad = Math.max(50, (hi - lo) * 0.05);
    return [Math.floor((lo - pad) / 50) * 50, Math.ceil((hi + pad) / 50) * 50];
}


function formatTickDate(t) {

    var d     = new Date(t * 1000);
    var month = d.toLocaleDateString('en-US', { month: 'short' });
    var yy    = String(d.getFullYear()).slice(-2);
    return `${month} '${yy}`;
}


function formatTooltipDate(t) {

    return new Date(t * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    });
}


export function RatingChart({ progression }) {

    // find the latest timestamp across every series. each series gets
    // extended forward to either that timestamp or now, whichever is later -
    // its more accurate to say "you're still 1800 in daily, you just havent
    // played" than to let the line vanish six months ago.
    var nowSec          = Math.floor(Date.now() / 1000);
    var latestTimestamp = 0;
    for (var series of Object.values(progression)) {
        if (series.length) {
            latestTimestamp = Math.max(latestTimestamp, series[series.length - 1].t);
        }
    }
    var flatlineEnd = Math.max(latestTimestamp, nowSec);

    // unified x-axis dataset. each row has whatever series exist at that t,
    // missing slots are undefined and recharts skips them with connectNulls.
    var allRows = {};
    for (var tc of SERIES_ORDER) {
        var ser = progression[tc];
        if (!ser || !ser.length) { continue; }
        var sampled = downsample(ser);
        for (var point of sampled) {
            var key = point.t;
            if (!allRows[key]) { allRows[key] = { t: key }; }
            allRows[key][tc] = point.rating;
        }
        // synthetic flatline point at the global end with the last known rating
        var lastRating = sampled[sampled.length - 1].rating;
        if (!allRows[flatlineEnd]) { allRows[flatlineEnd] = { t: flatlineEnd }; }
        allRows[flatlineEnd][tc] = lastRating;
    }

    var data         = Object.values(allRows).sort((a, b) => a.t - b.t);
    var [yMin, yMax] = percentileDomain(progression);

    return (
        <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                        dataKey="t"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={formatTickDate}
                        stroke="var(--text-subtle)"
                        tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        minTickGap={50}
                    />
                    <YAxis
                        stroke="var(--text-subtle)"
                        tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        domain={[yMin, yMax]}
                        width={40}
                    />
                    <Tooltip
                        labelFormatter={formatTooltipDate}
                        contentStyle={{
                            background:   'var(--surface)',
                            border:       '1px solid var(--border-2)',
                            borderRadius: 8,
                            fontSize:     12,
                            boxShadow:    '0 4px 12px rgba(0, 0, 0, 0.06)'
                        }}
                        labelStyle={{ color: 'var(--text)', fontWeight: 500, marginBottom: 4 }}
                        itemStyle={{ color: 'var(--text)', padding: '2px 0' }}
                    />
                    {SERIES_ORDER.map(tc =>
                        progression[tc] && progression[tc].length ? (
                            <Line
                                key={tc}
                                type="monotone"
                                dataKey={tc}
                                stroke={`var(--${tc})`}
                                strokeWidth={1.6}
                                dot={false}
                                connectNulls
                                isAnimationActive={false}
                                name={tc[0].toUpperCase() + tc.slice(1)}
                            />
                        ) : null
                    )}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
