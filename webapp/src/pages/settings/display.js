/**
 * Settings > Display: which entries the Today page lists. A tab per kind of entry (as the Calendar groups them: its
 * schedule groups, the event rotations and the Kingdom War) with a tile for each event, pass, track, event rotation and
 * Kingdom War event (`todayEntries`): its art, its name and a
 * switch; off hides the entry on Today (`hiddenTodayEntries`; display only, the plan and the Calendar keep it). A tab
 * says how many of its entries are shown once some are hidden.
 */
import { getSettings, setTodayEntryHidden } from '../../ui/settings.js';
import { SCHEDULE_KIND_LABELS } from '../../ui/labels.js';
import { eventImageUrl, scheduleImage, scheduleName } from '../../ui/event-banner.js';
import { escapeAttr, escapeHtml } from '../../ui/html.js';
import { tHtml } from '../../ui/i18n.js';
import { todayEntries } from '../../core/schedule.js';

let data = null;
let entries = [];
// The kind whose tab is open.
let activeKind = null;

const tabs = () => document.getElementById('display-tabs');
const panel = () => document.getElementById('display-panel');

/** The tabs, one per kind with entries; "(6/9)" once some of its entries are hidden. */
function renderTabs() {
    const hidden = new Set(getSettings().hiddenTodayEntries);
    tabs().innerHTML = Object.entries(SCHEDULE_KIND_LABELS)
        .map(([kind, labelKey]) => {
            const ofKind = entries.filter((entry) => entry.kind === kind);
            if (ofKind.length === 0) {
                return '';
            }
            const shown = ofKind.filter(({ id }) => !hidden.has(id)).length;
            const counts = shown < ofKind.length ? ` (${shown}/${ofKind.length})` : '';
            return `<button type="button" role="tab" class="display-tab" data-kind="${kind}" aria-selected="${kind === activeKind}">${tHtml(labelKey)}${counts}</button>`;
        })
        .join('');
}

/** The open tab's tiles, by name. */
function renderPanel() {
    const hidden = new Set(getSettings().hiddenTodayEntries);
    panel().innerHTML = entries
        .filter((entry) => entry.kind === activeKind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name, image }) => {
            const art = image
                ? `<img class="display-tile__art" src="${escapeAttr(image)}" alt="" loading="lazy" decoding="async" />`
                : '<span class="display-tile__art display-tile__art--none" aria-hidden="true"></span>';
            return `
            <label class="display-tile">
                ${art}
                <span class="display-tile__row">
                    <span class="display-tile__name">${escapeHtml(name)}</span>
                    <input type="checkbox" class="switch" role="switch" data-entry-id="${escapeAttr(id)}"${hidden.has(id) ? '' : ' checked'} />
                </span>
            </label>`;
        })
        .join('');
}

/** Draws it all again (names are data names: the language changes them). */
function renderDisplay() {
    entries = todayEntries(data).map(({ id, kind }) => ({
        id,
        kind,
        name: scheduleName(data, id),
        image: eventImageUrl(scheduleImage(data, id)),
    }));
    if (!entries.some((entry) => entry.kind === activeKind)) {
        activeKind = Object.keys(SCHEDULE_KIND_LABELS).find((kind) => entries.some((entry) => entry.kind === kind));
    }
    renderTabs();
    renderPanel();
}

function initDisplay(packData) {
    data = packData;
    renderDisplay();
    tabs().addEventListener('click', (event) => {
        const tab = event.target.closest('[data-kind]');
        if (tab) {
            activeKind = tab.dataset.kind;
            renderTabs();
            renderPanel();
        }
    });
    // Only the tabs are drawn again (their counts), so the switch keeps the focus.
    panel().addEventListener('change', (event) => {
        setTodayEntryHidden(event.target.dataset.entryId, !event.target.checked);
        renderTabs();
    });
}

export { initDisplay, renderDisplay };
