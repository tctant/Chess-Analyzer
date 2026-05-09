// engine analysis from chessdb.cn for the current position. used to have
// lichess + masters tabs too but lichess explorer went down feb 2026 and
// chessdb is more useful for opening study anyway (engine eval + expected
// score per move).

import { useState, useEffect } from 'react';
import { Chess } from 'chess.js';


async function fetchExplorer(fen) {

    var params = new URLSearchParams({ fen });
    var res    = await fetch(`/api/explorer/chessdb?${params}`);
    if (!res.ok) {
        var body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.message || `HTTP ${res.status}`);
    }
    return res.json();
}


function uciToSan(fen, uci) {

    if (!uci || uci.length < 4) { return null; }
    var chess = new Chess(fen);
    try {
        var m = chess.move({
            from: uci.slice(0, 2),
            to:   uci.slice(2, 4),
            promotion: uci.length > 4 ? uci[4] : undefined
        });
        return m ? m.san : null;
    } catch (e) {
        return null;
    }
}


export function OpeningExplorer({ fen, onPickMove }) {

    var [data, setData]       = useState(null);
    var [loading, setLoading] = useState(false);
    var [error, setError]     = useState(null);

    useEffect(() => {

        var cancelled = false;
        setLoading(true);
        setError(null);
        fetchExplorer(fen)
            .then(d  => { if (!cancelled) { setData(d); } })
            .catch(e => { if (!cancelled) { setError(e.message); setData(null); } })
            .finally(() => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [fen]);

    return (
        <div className="explorer">
            {error   && <div className="explorer-status">Couldn't load: {error}</div>}
            {loading && !data && <div className="explorer-status">Loading…</div>}

            {!error && data && data.moves && data.moves.length > 0 && (
                <>
                    <div className="explorer-list" style={{ opacity: loading ? 0.6 : 1 }}>
                        {data.moves.slice(0, 10).map((m, i) => {

                            var san     = m.san || uciToSan(fen, m.uci) || m.uci;
                            var pickArg = pickArgFromUci(m.uci, san);
                            var isBest  = i === 0;

                            return (
                                <button
                                    key={m.uci}
                                    className={`explorer-row engine-row ${isBest ? 'is-best' : ''}`}
                                    onClick={() => pickArg && onPickMove(pickArg)}
                                    title={m.note ? `${san} \u00b7 ${m.note}` : san}
                                >
                                    <span className="explorer-san">{san}</span>
                                    <span className="engine-score">{formatScore(m.score, data.side_to_move)}</span>
                                    <div className="engine-winrate-bar">
                                        <div
                                            className="engine-winrate-fill"
                                            style={{ width: m.winrate != null ? `${m.winrate}%` : '0%' }}
                                        />
                                    </div>
                                    <span className="engine-winrate-label">
                                        {m.winrate != null ? `${m.winrate.toFixed(0)}%` : '-'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="explorer-footnote">
                        Engine analysis from <a href="https://www.chessdb.cn" target="_blank" rel="noopener noreferrer">chessdb.cn</a>.
                        Win % is expected score for the side to move.
                    </div>
                </>
            )}

            {!error && !loading && data && (!data.moves || data.moves.length === 0) && (
                <div className="explorer-status">No engine data for this position.</div>
            )}
        </div>
    );
}


function pickArgFromUci(uci, san) {

    if (!uci || uci.length < 4) { return null; }
    return {
        from: uci.slice(0, 2),
        to:   uci.slice(2, 4),
        san,
        promotion: uci.length > 4 ? uci[4] : undefined
    };
}


// chessdb scores are centipawns from side-to-move pov. flip for black
// so positive always reads as "white is better", matching the eval bar.
function formatScore(score, sideToMove) {

    if (score == null) { return '-'; }
    var fromWhite = sideToMove === 'b' ? -score : score;
    var pawns     = fromWhite / 100;
    var sign      = pawns >= 0 ? '+' : '';
    return `${sign}${pawns.toFixed(2)}`;
}
