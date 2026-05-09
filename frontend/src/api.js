// thin api client. vite proxies /api/* to fastapi in dev (see vite.config.js)
// so we use relative urls and dont have to think about cors.

async function fetchJson(url) {

    var res = await fetch(url);
    if (!res.ok) {
        var detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Request failed with ${res.status}`);
    }
    return res.json();
}


export function fetchSummary(username, tzOffsetHours) {

    var params = new URLSearchParams({ tz_offset_hours: tzOffsetHours });
    return fetchJson(`/api/users/${encodeURIComponent(username)}/summary?${params}`);
}


// timeClass is null for "all" or one of bullet|blitz|rapid|daily
// sinceDays is null for "all time", otherwise integer days back from now
export function fetchOpenings(
    username,
    { timeClass = null, sinceDays = null, limit = 20, minGames = 5 } = {}
) {
    var params = new URLSearchParams({ limit, min_games: minGames });
    if (timeClass)          { params.set('time_class', timeClass); }
    if (sinceDays !== null) { params.set('since_days', sinceDays); }
    return fetchJson(`/api/users/${encodeURIComponent(username)}/top-openings?${params}`);
}


export function fetchHeatmap(username, tzOffsetHours, sinceDays = null) {

    var params = new URLSearchParams({ tz_offset_hours: tzOffsetHours });
    if (sinceDays !== null) { params.set('since_days', sinceDays); }
    return fetchJson(`/api/users/${encodeURIComponent(username)}/activity-heatmap?${params}`);
}


export function fetchHourPerformance(username, tzOffsetHours) {

    var params = new URLSearchParams({ tz_offset_hours: tzOffsetHours });
    return fetchJson(`/api/users/${encodeURIComponent(username)}/performance-by-hour?${params}`);
}


// individual games matching the filters - drives the click-to-drill flow
export function fetchGames(
    username,
    { eco = null, color = null, timeClass = null, sinceDays = null, limit = 20 } = {}
) {
    var params = new URLSearchParams({ limit });
    if (eco)                { params.set('eco', eco); }
    if (color)              { params.set('color', color); }
    if (timeClass)          { params.set('time_class', timeClass); }
    if (sinceDays !== null) { params.set('since_days', sinceDays); }
    return fetchJson(`/api/users/${encodeURIComponent(username)}/games?${params}`);
}


// searchable game log, paginated and filterable. backs the GameLog table.
export function searchGames(
    username,
    {
        opponent     = null,
        color        = null,
        result       = null,
        timeClass    = null,
        eco          = null,
        sinceDays    = null,
        minOppRating = null,
        maxOppRating = null,
        limit        = 50,
        offset       = 0
    } = {}
) {
    var params = new URLSearchParams({ limit, offset });
    if (opponent)              { params.set('opponent', opponent); }
    if (color)                 { params.set('color', color); }
    if (result)                { params.set('result', result); }
    if (timeClass)             { params.set('time_class', timeClass); }
    if (eco)                   { params.set('eco', eco); }
    if (sinceDays !== null)    { params.set('since_days', sinceDays); }
    if (minOppRating !== null) { params.set('min_opp_rating', minOppRating); }
    if (maxOppRating !== null) { params.set('max_opp_rating', maxOppRating); }
    return fetchJson(`/api/users/${encodeURIComponent(username)}/games/search?${params}`);
}


// single game (with PGN) by url. search results omit the heavy PGN field
// so this is what the analysis modal uses to load the actual moves.
export function fetchGameByUrl(username, url) {

    var params = new URLSearchParams({ url });
    return fetchJson(`/api/users/${encodeURIComponent(username)}/games/by-url?${params}`);
}
