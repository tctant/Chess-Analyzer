// triggers fetch_games for a user via the api. polls /sync/status on a
// 1.5s interval while the job runs and calls onComplete when it finishes
// so the dashboard can refetch.

import { useState, useEffect, useRef } from 'react';

var POLL_MS = 1500;


async function startSync(username) {

    var res = await fetch(`/api/users/${encodeURIComponent(username)}/sync`, {
        method: 'POST'
    });
    if (!res.ok) {
        var body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
}


async function fetchStatus(username) {

    var res = await fetch(`/api/users/${encodeURIComponent(username)}/sync/status`);
    if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
    return res.json();
}


export function SyncButton({ username, onComplete }) {

    var [job, setJob]     = useState(null);
    var [error, setError] = useState(null);
    var pollRef           = useRef(null);

    // a sync still running across a page refresh? pick it up where it left off
    useEffect(() => {

        if (!username) { return; }
        var cancelled = false;
        fetchStatus(username).then(j => {
            if (cancelled) { return; }
            if (j.state === 'syncing' || j.state === 'queued') {
                setJob(j);
                startPolling();
            }
        }).catch(() => {});
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [username]);

    function startPolling() {

        if (pollRef.current) { return; }
        pollRef.current = setInterval(async () => {
            try {
                var j = await fetchStatus(username);
                setJob(j);
                if (j.state === 'done' || j.state === 'error' || j.state === 'idle') {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    if (j.state === 'done' && onComplete) { onComplete(j); }
                }
            } catch (e) {
                // swallow transient poll errors - request is short, next tick
                // will retry. only the initial start sets visible error state.
            }
        }, POLL_MS);
    }

    // cleanup the interval on unmount
    useEffect(() => {

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, []);

    async function onClick() {

        setError(null);
        try {
            var j = await startSync(username);
            setJob(j);
            startPolling();
        } catch (e) {
            setError(e.message);
        }
    }

    var running = job && (job.state === 'syncing' || job.state === 'queued');
    var label   = !running                  ? 'Sync'
                : job.state === 'queued'    ? 'Queued…'
                : job.state === 'syncing'   ? 'Syncing…'
                : 'Working…';

    return (
        <div className="sync-button-wrap">
            <button
                type="button"
                className="sync-button"
                onClick={onClick}
                disabled={running || !username}
                title="Pull latest games from Chess.com. First sync for an active player takes 2-3 minutes."
            >
                {label}
            </button>
            {(running || job?.state === 'done' || job?.state === 'error' || error) && (
                <div className={`sync-status ${job?.state || (error ? 'error' : '')}`}>
                    {error
                        ? `Couldn't start: ${error}`
                        : job?.message || ''}
                </div>
            )}
            {!running && !job && !error && (
                <div className="sync-hint">First sync ~2-3 min</div>
            )}
        </div>
    );
}
