/**
 * A page's selection in its URL (`?item=…`, `?event=…`, …), so a reload or a shared link opens the same view.
 * The language (`?lang=`) is kept as it is.
 */

/** The value of query parameter `name`, or null. */
function urlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

/** Replaces the page's query by `params` (empty / null values left out), keeping `?lang=`. */
function setUrlParams(params) {
    const url = new URL(window.location.href);
    const query = new URLSearchParams();
    const lang = url.searchParams.get('lang');
    if (lang) {
        query.set('lang', lang);
    }
    for (const [name, value] of Object.entries(params)) {
        if (value !== null && value !== undefined && value !== '') {
            query.set(name, String(value));
        }
    }
    window.history.replaceState(null, '', `${url.pathname}${query.size ? `?${query}` : ''}${url.hash}`);
}

/** Link to the page `page` (e.g. 'events') with the selection `params` in its query. */
function pageHref(page, params) {
    const query = Object.entries(params).map(([name, value]) => `${name}=${encodeURIComponent(value)}`);
    return `${import.meta.env.BASE_URL}${page}.html?${query.join('&')}`;
}

/** Link to Item Sources for `itemId`. */
function itemSourcesHref(itemId) {
    return pageHref('sources', { item: itemId });
}

/** Link to the Event Shops tab of `eventId`. */
function eventPlanHref(eventId) {
    return pageHref('events', { event: `event:${eventId}` });
}

export { urlParam, setUrlParams, pageHref, itemSourcesHref, eventPlanHref };
