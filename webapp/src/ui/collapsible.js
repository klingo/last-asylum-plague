/**
 * Collapsible cards: a `<details data-section="<id>">` under a card, its `<summary class="card-toggle">` holding the
 * heading. Whether it is collapsed is kept per device (`collapsedSections` in localStorage, section id -> true, not
 * synced: a phone and a desktop want different things), so a reload, or a chart drawn again, keeps it.
 */
import { STORAGE_KEYS, readJson, writeJson } from './storage.js';

/** Applies the saved state to every collapsible under `root` not wired yet and saves its changes from then on. */
function wireCollapsible(root) {
    const collapsed = readJson(STORAGE_KEYS.collapsedSections);
    for (const details of root.querySelectorAll('details[data-section]')) {
        if (details.dataset.wired) {
            continue;
        }
        details.dataset.wired = '1';
        const id = details.dataset.section;
        details.open = !collapsed[id];
        details.addEventListener('toggle', () => {
            const saved = readJson(STORAGE_KEYS.collapsedSections);
            if (details.open) {
                delete saved[id];
            } else {
                saved[id] = true;
            }
            writeJson(STORAGE_KEYS.collapsedSections, saved);
        });
    }
}

export { wireCollapsible };
