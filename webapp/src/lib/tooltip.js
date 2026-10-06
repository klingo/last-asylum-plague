/**
 * Minimal accessible info tooltip for small icon triggers inside scrollable tables.
 *
 * The tooltip is rendered into a single shared element appended directly to <body> (not a
 * table descendant) and positioned in JS via getBoundingClientRect(). This sidesteps clipping
 * from an ancestor's `overflow`: this page's tables sit inside `.table-wrap { overflow-x:
 * auto }`, and per the CSS Overflow spec, setting overflow on only one axis makes the other
 * axis compute to `auto` too — so a tooltip living inside that wrapper (e.g. a plain CSS
 * ::after) would get clipped whenever it's near the wrapper's top/bottom edge, which in
 * practice means the first or last table row.
 *
 * Screen reader support doesn't depend on this popup at all: each trigger is expected to
 * already carry a full `aria-label` (set by the caller) that's announced on focus regardless
 * of whether the visual popup is shown, so the popup itself is purely a sighted-user
 * convenience and is marked `aria-hidden="true"`. Per WCAG 1.4.13, it's dismissible (Escape),
 * and stays put until the trigger loses hover/focus.
 */

let tooltipEl = null;

function ensureTooltipEl() {
    if (tooltipEl) {
        return tooltipEl;
    }
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'app-tooltip';
    tooltipEl.setAttribute('aria-hidden', 'true');
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

function positionTooltip(trigger) {
    const el = ensureTooltipEl();
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = el.getBoundingClientRect();
    const spacing = 6;

    // Default above the trigger, flipping below it if there isn't room.
    let top = triggerRect.top - tooltipRect.height - spacing;
    if (top < 0) {
        top = triggerRect.bottom + spacing;
    }

    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tooltipRect.width - 4));

    el.style.top = `${top + window.scrollY}px`;
    el.style.left = `${left + window.scrollX}px`;
}

function showTooltip(trigger) {
    const el = ensureTooltipEl();
    el.textContent = trigger.dataset.tooltip || '';
    el.hidden = false;
    positionTooltip(trigger);
}

function hideTooltip() {
    if (tooltipEl) {
        tooltipEl.hidden = true;
    }
}

/**
 * Wires hover/focus/dismiss behavior for every `[data-tooltip]` element under `root` (info icons,
 * pills, ...). Safe
 * to call repeatedly (e.g. after re-rendering a table), since it only ever touches whatever
 * matching elements currently exist in the DOM.
 */
function enableInfoTooltips(root) {
    root.querySelectorAll('[data-tooltip]').forEach((trigger) => {
        trigger.addEventListener('mouseenter', () => showTooltip(trigger));
        trigger.addEventListener('mouseleave', hideTooltip);
        trigger.addEventListener('focus', () => showTooltip(trigger));
        trigger.addEventListener('blur', hideTooltip);
        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideTooltip();
            }
        });
    });
}

export { enableInfoTooltips };
