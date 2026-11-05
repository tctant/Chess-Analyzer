// the analysis modal drags in chessground, chess.js and the stockfish
// hook. loading it on first click keeps all of that out of the dashboard
// bundle - the modal is maybe 1 in 20 visits.

import { lazy, Suspense } from 'react';


var Inner = lazy(() => import('./AnalysisBoard').then(m => ({ default: m.AnalysisBoard })));


export function AnalysisBoard(props) {

    return (
        <Suspense fallback={<div className="modal-overlay"><div className="pe-note">Loading board…</div></div>}>
            <Inner {...props} />
        </Suspense>
    );
}
