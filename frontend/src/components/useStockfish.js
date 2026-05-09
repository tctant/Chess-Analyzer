// stockfish 16 lite, single-threaded wasm, served from cdn. loaded as a
// web worker so analysis doesnt block the ui.
//
// the lite build is ~600KB and runs ~700K nodes/sec on a modern laptop,
// plenty for the 12-22 depths we use here. multi-threaded builds need
// cross-origin isolation headers we dont want to deal with.
//
// the cdn-via-worker dance: workers can only load same-origin urls
// directly, so we fetch the script as text, wrap it in a blob url, and
// hand that to the Worker constructor. standard pattern.

import { useEffect, useRef, useState, useCallback } from 'react';

var STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';


// turn stockfish's centipawn / mate score into a display string and a
// signed eval ("white advantage in pawns", positive = white better)
export function formatScore(score) {

    if (!score) { return { text: '0.0', signed: 0 }; }
    if (score.kind === 'mate') {
        return {
            text:   `M${Math.abs(score.value)}`,
            signed: score.value > 0 ? 100 : -100,
            mate:   score.value
        };
    }
    var pawns = score.value / 100;
    var sign  = pawns > 0 ? '+' : '';
    return { text: `${sign}${pawns.toFixed(2)}`, signed: pawns };
}


// useStockfish: spawn a worker, send positions to analyze, get
// { depth, score, pv } updates back.
//
// one worker per hook instance (one per AnalysisBoard). a new analyze()
// cancels the previous one. worker is terminated on unmount.
export function useStockfish() {

    var workerRef       = useRef(null);
    var [ready, setReady] = useState(false);
    var [info, setInfo]   = useState({ depth: 0, score: null, pv: null });

    // pin the fen we're "currently analyzing" so stale info events from a
    // previous position can be discarded
    var currentFenRef = useRef(null);

    useEffect(() => {

        var cancelled = false;

        fetch(STOCKFISH_URL)
            .then(r => r.text())
            .then(src => {
                if (cancelled) { return; }
                var blob   = new Blob([src], { type: 'application/javascript' });
                var worker = new Worker(URL.createObjectURL(blob));
                workerRef.current = worker;

                worker.onmessage = e => {
                    var line = typeof e.data === 'string' ? e.data : e.data?.data || '';
                    if (!line) { return; }

                    if (line === 'uciok') {
                        worker.postMessage('setoption name MultiPV value 1');
                        worker.postMessage('isready');
                    } else if (line === 'readyok') {
                        setReady(true);
                    } else if (line.startsWith('info ')) {
                        var parsed = parseInfo(line);
                        if (parsed) {
                            // tag the update with the fen we're analyzing so
                            // the consumer can drop stale data after a move
                            var fen = currentFenRef.current;
                            setInfo(prev => ({
                                depth:    parsed.depth ?? prev.depth,
                                score:    parsed.score ?? prev.score,
                                pv:       parsed.pv    ?? prev.pv,
                                fenForPv: parsed.pv ? fen : prev.fenForPv
                            }));
                        }
                    }
                };

                worker.postMessage('uci');
            })
            .catch(err => {
                console.warn('stockfish failed to load:', err);
            });

        return () => {
            cancelled = true;
            if (workerRef.current) {
                workerRef.current.postMessage('quit');
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, []);

    var stop = useCallback(() => {

        if (!workerRef.current) { return; }
        workerRef.current.postMessage('stop');
    }, []);

    // analyze a position. opts.depth (preferred) or opts.movetime in ms.
    // calling again cancels the prior analysis and clears the previous pv
    // so consumers dont see stale arrows from an old position.
    var analyze = useCallback((fen, opts = {}) => {

        if (!workerRef.current || !ready) { return; }
        currentFenRef.current = fen;
        setInfo({ depth: 0, score: null, pv: null, fenForPv: null });
        workerRef.current.postMessage('stop');
        workerRef.current.postMessage(`position fen ${fen}`);
        if (opts.depth) {
            workerRef.current.postMessage(`go depth ${opts.depth}`);
        } else if (opts.movetime) {
            workerRef.current.postMessage(`go movetime ${opts.movetime}`);
        } else {
            workerRef.current.postMessage('go depth 18');
        }
    }, [ready]);

    return { ready, info, analyze, stop };
}


// parse a stockfish uci 'info' line into { depth, score, pv }
// example: "info depth 14 seldepth 20 multipv 1 score cp 35 nodes 51234 pv e2e4 e7e5 ..."
function parseInfo(line) {

    var tokens = line.split(/\s+/);
    var depth = null, score = null, pv = null;
    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t === 'depth') {
            depth = parseInt(tokens[i + 1], 10);
        } else if (t === 'score') {
            var kind = tokens[i + 1];   // 'cp' or 'mate'
            var val  = parseInt(tokens[i + 2], 10);
            score = { kind: kind === 'mate' ? 'mate' : 'cp', value: val };
        } else if (t === 'pv') {
            pv = tokens.slice(i + 1);
            break;
        }
    }
    return { depth, score, pv };
}
