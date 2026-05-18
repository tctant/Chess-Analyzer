// 7x24 day-of-week x hour heatmap. shows when the user actually plays.
// the all-time view ships with the dashboard summary; year/month/week
// trigger a refetch since they need a server-side since_days cutoff.

import { useState, useEffect } from 'react';
import { fetchHeatmap } from '../api';
import { FilterPills } from './OpeningsTable';


var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var RANGE_FILTERS = [
    { key: 'all',   label: 'All time', sinceDays: null },
    { key: 'year',  label: 'Year',     sinceDays: 365  },
    { key: 'month', label: 'Month',    sinceDays: 30   },
    { key: 'week',  label: 'Week',     sinceDays: 7    }
];


function formatHour(h) {

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


export function Heatmap({ username, tzOffsetHours, tzLabel, initial }) {

    var [range, setRange]     = useState('all');
    var [cells, setCells]     = useState(initial || []);
    var [loading, setLoading] = useState(false);

    useEffect(() => {
        setCells(initial || []);
        setRange('all');
    }, [initial]);

    useEffect(() => {

        if (range === 'all') { return; }
        var opt = RANGE_FILTERS.find(r => r.key === range);
        if (!opt) { return; }

        var cancelled = false;
        setLoading(true);
        fetchHeatmap(username, tzOffsetHours, opt.sinceDays)
            .then(data => { if (!cancelled) { setCells(data); } })
            .catch(() => {})
            .finally(() => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [username, tzOffsetHours, range]);

    var onSelectFilter = key => {
        if (key === range) { return; }
        if (key === 'all') { setCells(initial || []); }
        setRange(key);
    };

    return (
        <>
            <div className="card-header">
                <h2>Activity heatmap</h2>
                <div className="card-header-right">
                    <FilterPills
                        options={RANGE_FILTERS}
                        value={range}
                        onChange={onSelectFilter}
                    />
                    <span className="subtitle">Times shown in {tzLabel || 'UTC'}</span>
                </div>
            </div>
            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
                <HeatmapGrid cells={cells} />
            </div>
        </>
    );
}


function HeatmapGrid({ cells }) {

    // build a 7x24 matrix from the sparse cell list
    var grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    var max  = 0;
    for (var cell of cells) {
        grid[cell.day_of_week][cell.hour] = cell.games;
        if (cell.games > max) { max = cell.games; }
    }

    if (max === 0) {
        return (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                No games in this range.
            </div>
        );
    }

    return (
        <div className="heatmap">
            <div></div>
            {Array.from({ length: 24 }, (_, h) => (
                <div key={`h-${h}`} className="col-label">
                    {formatHour(h)}
                </div>
            ))}
            {DAYS.map((day, d) => (
                <Row key={day} day={day} dayIdx={d} grid={grid} max={max} />
            ))}
        </div>
    );
}


function Row({ day, dayIdx, grid, max }) {

    return (
        <>
            <div className="row-label">{day}</div>
            {grid[dayIdx].map((games, hour) => {
                var intensity = max ? 0.06 + (games / max) * 0.88 : 0.06;
                return (
                    <div
                        key={`${dayIdx}-${hour}`}
                        className="cell"
                        style={{ '--intensity': intensity }}
                        title={`${day} ${formatHourLong(hour)} · ${games} games`}
                    />
                );
            })}
        </>
    );
}
