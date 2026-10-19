/**
 * Item picker (Item Sources, Compare, Best Choice Pick): a select-like button showing the current
 * item, opening a panel with its own search box over the full list (icons, grouped by category).
 *
 * The selection and the search are separate (as in GitHub's / Slack's pickers): reopening always
 * starts with an empty search and the whole list, the current item ticked and scrolled into view;
 * picking closes the panel, Esc / clicking outside closes it without changing anything. On phones
 * (narrow screens) the panel is a full-screen sheet with a back button and large rows.
 */
import { setItemImageSrc, rarityClass } from './images.js';
import { localizedName, enumLabel, t } from './i18n.js';

let pickerCount = 0;

/** Lower case, accents and punctuation removed: "Lv.5 Raven Gear" -> "lv5ravengear". */
function compact(text) {
    return String(text)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/** Words of a name, compacted ("Lv.5 Raven Gear" -> ["lv5", "raven", "gear"]). */
function words(text) {
    return String(text).split(/\s+/).map(compact).filter(Boolean);
}

/**
 * @param {HTMLButtonElement} trigger - the (empty) button that shows the selection; the panel is
 *   added next to it, inside its parent (which becomes the positioning box).
 * @param {(itemId: string) => void} [onChange] - called when the user picks (or clears) an item.
 * @param {string} [placeholderKey] - i18n key of the text shown while nothing is selected.
 * @param {boolean} [clearable=false] - offer a "Clear selection" row (where no item is a valid state).
 * @param {boolean} [icons=true] - show item images (off for lists that aren't items, e.g. events).
 * @param {string} [searchPlaceholderKey] - i18n key of the search box's placeholder.
 */
/** The green "running now" dot (as on the setup bar's chips), with its text for hover and screen readers. */
function nowDot() {
    const dot = document.createElement('span');
    dot.className = 'toggle-chip__now';
    dot.title = t('valuation.nowRunning');
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = t('valuation.nowRunning');
    dot.appendChild(label);
    return dot;
}

function createItemPicker({
    trigger,
    onChange,
    placeholderKey = 'picker.placeholder',
    clearable = false,
    icons = true,
    searchPlaceholderKey = 'picker.search',
}) {
    const id = `item-picker-${++pickerCount}`;
    let items = []; // [{ id, name, category, categoryName, key, words }]
    let selectedId = '';
    let visible = []; // option elements currently rendered, in order
    let activeIndex = -1;

    const container = trigger.parentElement;
    container.classList.add('item-picker');

    // ---- Trigger: icon + name (or placeholder) + chevron ----
    trigger.type = 'button';
    trigger.classList.add('item-picker__trigger');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const triggerIcon = document.createElement('img');
    triggerIcon.className = 'item-picker__trigger-icon';
    triggerIcon.alt = '';
    // Shown only once the image actually loads (many items have none yet).
    triggerIcon.hidden = true;
    triggerIcon.addEventListener('load', () => {
        triggerIcon.hidden = false;
    });
    triggerIcon.addEventListener('error', () => {
        triggerIcon.hidden = true;
    });
    const triggerText = document.createElement('span');
    triggerText.className = 'item-picker__value';
    const triggerNow = nowDot();
    const chevron = document.createElement('span');
    chevron.className = 'item-picker__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    trigger.replaceChildren(triggerIcon, triggerText, triggerNow, chevron);

    // ---- Panel: (back button +) search box, list ----
    const panel = document.createElement('div');
    panel.className = 'item-picker__panel';
    panel.hidden = true;
    const head = document.createElement('div');
    head.className = 'item-picker__head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'item-picker__back';
    back.textContent = '←';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'item-picker__search';
    search.autocomplete = 'off';
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-controls', `${id}-list`);
    head.append(back, search);
    const list = document.createElement('div');
    list.className = 'item-picker__list';
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    panel.append(head, list);
    container.appendChild(panel);

    function selected() {
        return items.find((item) => item.id === selectedId) || null;
    }

    function renderTrigger() {
        const item = selected();
        triggerText.textContent = item ? item.name : t(placeholderKey);
        triggerText.classList.toggle('is-placeholder', !item);
        triggerNow.hidden = !item?.now;
        triggerIcon.hidden = true;
        if (item && icons) {
            // Shown by the 'load' listener once one of its locations has it (stays hidden otherwise).
            setItemImageSrc(triggerIcon, item.id, () => {
                triggerIcon.hidden = true;
            });
        } else {
            triggerIcon.onerror = null;
            triggerIcon.removeAttribute('src');
        }
        back.setAttribute('aria-label', t('picker.close'));
        search.placeholder = t(searchPlaceholderKey);
    }

    /** Search: every word of the query must occur in the name or category (any order). */
    function matches(query) {
        const tokens = words(query);
        if (tokens.length === 0) {
            return null;
        }
        const whole = compact(query);
        return items
            .filter((item) => tokens.every((token) => item.key.includes(token) || item.categoryKey.includes(token)))
            .map((item) => {
                let rank = 2;
                if (item.key.startsWith(whole)) {
                    rank = 0;
                } else if (item.words.some((word) => word.startsWith(tokens[0]))) {
                    rank = 1;
                }
                return { item, rank };
            })
            .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name))
            .map(({ item }) => item);
    }

    /** The name with the query's words in bold (plain substring matches of the typed text). */
    function nameWithHighlights(name, query) {
        const fragment = document.createDocumentFragment();
        const lower = name.toLowerCase();
        const ranges = [];
        for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
            const at = lower.indexOf(token);
            if (at >= 0) {
                ranges.push([at, at + token.length]);
            }
        }
        ranges.sort((a, b) => a[0] - b[0]);
        let position = 0;
        for (const [start, end] of ranges) {
            if (start < position) {
                continue;
            }
            fragment.append(name.slice(position, start));
            const mark = document.createElement('mark');
            mark.textContent = name.slice(start, end);
            fragment.append(mark);
            position = end;
        }
        fragment.append(name.slice(position));
        return fragment;
    }

    function optionElement(item, query, showCategory) {
        const option = document.createElement('div');
        option.className = 'item-picker__option';
        option.id = `${id}-opt-${visible.length}`;
        option.setAttribute('role', 'option');
        option.dataset.itemId = item.id;
        const isSelected = item.id === selectedId;
        option.setAttribute('aria-selected', String(isSelected));
        option.classList.toggle('is-selected', isSelected);
        if (icons) {
            const iconSlot = document.createElement('span');
            iconSlot.className = 'item-picker__icon';
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.className = `item-icon item-icon--sm ${rarityClass(item.id)}`.trim();
            // Missing images stay blank so every name lines up under the icon column.
            setItemImageSrc(img, item.id, () => img.remove());
            iconSlot.appendChild(img);
            option.appendChild(iconSlot);
        }
        const label = document.createElement('span');
        label.className = 'item-picker__name';
        label.append(query ? nameWithHighlights(item.name, query) : item.name);
        if (item.now) {
            label.append(nowDot());
        }
        option.appendChild(label);
        if (showCategory) {
            const category = document.createElement('span');
            category.className = 'item-picker__category';
            category.textContent = item.categoryName;
            option.appendChild(category);
        }
        const check = document.createElement('span');
        check.className = 'item-picker__check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = isSelected ? '✓' : '';
        option.appendChild(check);
        option.addEventListener('click', () => pick(item.id));
        option.addEventListener('mousemove', () => setActive(visible.indexOf(option), false));
        visible.push(option);
        return option;
    }

    function renderList() {
        const query = search.value.trim();
        const found = matches(query);
        visible = [];
        list.replaceChildren();
        if (clearable && selectedId && !query) {
            const clear = document.createElement('div');
            clear.className = 'item-picker__option item-picker__clear';
            clear.id = `${id}-opt-${visible.length}`;
            clear.setAttribute('role', 'option');
            clear.dataset.itemId = '';
            clear.textContent = t('picker.clear');
            clear.addEventListener('click', () => pick(''));
            visible.push(clear);
            list.appendChild(clear);
        }
        if (found === null) {
            // No query: everything, grouped by category (headings stick while scrolling).
            let category = null;
            for (const item of items) {
                if (item.category !== category) {
                    category = item.category;
                    const heading = document.createElement('div');
                    heading.className = 'item-picker__group';
                    heading.setAttribute('role', 'presentation');
                    heading.textContent = item.categoryName;
                    list.appendChild(heading);
                }
                list.appendChild(optionElement(item, '', false));
            }
        } else if (found.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'item-picker__empty';
            empty.textContent = t('picker.noResults');
            list.appendChild(empty);
        } else {
            // Typing: one list by relevance, the category next to each name.
            for (const item of found) {
                list.appendChild(optionElement(item, query, true));
            }
        }
    }

    function setActive(index, scroll = true) {
        visible.forEach((option) => option.classList.remove('is-active'));
        if (visible.length === 0) {
            activeIndex = -1;
            search.removeAttribute('aria-activedescendant');
            return;
        }
        activeIndex = Math.max(0, Math.min(index, visible.length - 1));
        const active = visible[activeIndex];
        active.classList.add('is-active');
        search.setAttribute('aria-activedescendant', active.id);
        if (scroll) {
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    function isOpen() {
        return !panel.hidden;
    }

    function open() {
        if (isOpen() || items.length === 0) {
            return;
        }
        search.value = '';
        renderList();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        document.body.classList.add('item-picker-open');
        const current = visible.findIndex((option) => option.dataset.itemId === selectedId && selectedId);
        setActive(current >= 0 ? current : 0, false);
        if (current >= 0) {
            visible[current].scrollIntoView({ block: 'center' });
        } else {
            list.scrollTop = 0;
        }
        search.focus();
    }

    function close({ focusTrigger = false } = {}) {
        if (!isOpen()) {
            return;
        }
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('item-picker-open');
        activeIndex = -1;
        if (focusTrigger) {
            trigger.focus();
        }
    }

    function pick(itemId) {
        const changed = itemId !== selectedId;
        selectedId = itemId;
        renderTrigger();
        close({ focusTrigger: true });
        if (changed) {
            onChange?.(selectedId);
        }
    }

    trigger.addEventListener('click', () => (isOpen() ? close() : open()));
    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
        }
    });
    back.addEventListener('click', () => close({ focusTrigger: true }));
    search.addEventListener('input', () => {
        renderList();
        setActive(0);
        list.scrollTop = 0;
    });
    search.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive(activeIndex + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(activeIndex - 1);
        } else if (event.key === 'Home' && !search.value) {
            event.preventDefault();
            setActive(0);
        } else if (event.key === 'End' && !search.value) {
            event.preventDefault();
            setActive(visible.length - 1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const option = visible[activeIndex];
            if (option) {
                pick(option.dataset.itemId);
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            close({ focusTrigger: true });
        } else if (event.key === 'Tab') {
            close();
        }
    });
    document.addEventListener('pointerdown', (event) => {
        if (isOpen() && !container.contains(event.target)) {
            close();
        }
    });

    renderTrigger();

    return {
        /** `{ id: { name, category, now } }` (name: a data `name` object or plain text; `now`: running now, a green dot). */
        setItems(source) {
            items = Object.entries(source).map(([itemId, item]) => {
                const name = localizedName(item.name) || itemId;
                const category = item.category || 'other';
                const categoryName = enumLabel('category', category);
                return {
                    id: itemId,
                    name,
                    // Running now (e.g. per the calendar): a green dot after the name.
                    now: Boolean(item.now),
                    category,
                    categoryName,
                    key: compact(name),
                    categoryKey: compact(categoryName),
                    words: words(name),
                };
            });
            items.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.name.localeCompare(b.name));
            if (selectedId && !items.some((item) => item.id === selectedId)) {
                selectedId = '';
            }
            renderTrigger();
            if (isOpen()) {
                renderList();
                setActive(0, false);
            }
        },
        getValue() {
            return selectedId;
        },
        /** Sets the selection without calling `onChange` (like assigning a native select's value). */
        setValue(itemId) {
            selectedId = items.some((item) => item.id === itemId) ? itemId : '';
            renderTrigger();
        },
        reset() {
            selectedId = '';
            renderTrigger();
        },
        hasItem(itemId) {
            return items.some((item) => item.id === itemId);
        },
    };
}

export { createItemPicker };
