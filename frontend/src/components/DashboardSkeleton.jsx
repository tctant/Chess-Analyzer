// shaped placeholders shown while the dashboard summary fetch is in flight.
// the layout matches the eventual dashboard so the page doesnt jump when
// real data lands.

export function DashboardSkeleton() {

    return (
        <div className="dashboard skeleton-mode">
            <div className="metric-cards">
                {[0, 1, 2, 3].map(i => (
                    <div key={i} className="metric-card">
                        <div className="skeleton skeleton-line" style={{ width: '40%', height: 8 }} />
                        <div className="skeleton skeleton-line" style={{ width: '60%', height: 24, marginTop: 10 }} />
                    </div>
                ))}
            </div>

            <SkeletonCard height={220} title="Rating progression" />
            <SkeletonCard height={320} title="Top openings" />
            <SkeletonCard height={180} title="Win rate by hour of day" />

            <div className="row-2">
                <SkeletonCard height={200} title="Win rate by time control" />
                <SkeletonCard height={200} title="Record by color" />
            </div>

            <SkeletonCard height={200} title="Activity heatmap" />
        </div>
    );
}


function SkeletonCard({ height, title }) {

    return (
        <div className="card">
            <div className="card-header">
                <h2 style={{ opacity: 0.4 }}>{title}</h2>
            </div>
            <div className="skeleton skeleton-block" style={{ height }} />
        </div>
    );
}
