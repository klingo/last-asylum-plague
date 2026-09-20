/**
 * Searchable, icon-prefixed replacement for a plain <select> of items, grouped by category.
 * A native <select>'s <option> can't host an <img>, so this renders its own listbox panel
 * instead, positioned under a text <input> that doubles as the filter field.
 */
import { getItemImageUrl } from './images';
import { localizedName, categoryLabel, t } from './i18n';

/**
 * @param {HTMLInputElement} input - the visible text field, acts as both display and filter.
 * @param {HTMLElement} panel - the dropdown panel element to render options into.
 * @param {HTMLButtonElement} [clearButton] - small "x" button that clears the field, shown
 *   only while there's something to clear.
 * @param {(itemId: string) => void} [onChange] - called whenever the selected item changes
 *   (including being cleared), after the input's displayed text has been updated.
 */
function createItemPicker({ input, panel, clearButton, onChange }) {
    let groups = []; // [{ category, items: [{ id, name }] }]
    let selectedId = '';
    let activeIndex = -1; // index into the currently rendered (visible) options

    if (clearButton) {
        clearButton.setAttribute('aria-label', t('analyze.itemSearchClear'));
    }

    // The wrapper `.item-combobox` (input + clear button + panel all live inside it) also
    // hosts the selected item's icon, absolutely positioned over the input's left padding.
    const container = input.parentElement;

    // Shows the selected item's icon inside the input, to the left of its text — but only once
    // the image actually loads (most items have no real image yet, see lib/images.js), so no
    // icon slot/padding is reserved for items that don't have one.
    const selectedIcon = document.createElement('img');
    selectedIcon.className = 'item-combobox__selected-icon';
    selectedIcon.alt = '';
    // Not `loading="lazy"`: it starts out `hidden` (display: none) until we know whether the
    // image exists, and a lazy-loaded image never loads at all while it has no layout box (the
    // browser only starts fetching once it's near the viewport, which a hidden element never is).
    selectedIcon.hidden = true;
    selectedIcon.addEventListener('load', () => {
        selectedIcon.hidden = false;
        container.classList.add('item-combobox--has-icon');
    });
    selectedIcon.addEventListener('error', () => {
        selectedIcon.hidden = true;
        container.classList.remove('item-combobox--has-icon');
    });
    container.insertBefore(selectedIcon, input);

    function updateSelectedIcon() {
        selectedIcon.hidden = true;
        container.classList.remove('item-combobox--has-icon');
        if (selectedId) {
            selectedIcon.src = getItemImageUrl(selectedId);
        } else {
            selectedIcon.removeAttribute('src');
        }
    }

    function allItemsById() {
        const map = new Map();
        for (const group of groups) {
            for (const item of group.items) {
                map.set(item.id, item);
            }
        }
        return map;
    }

    function selectedName() {
        return allItemsById().get(selectedId)?.name || '';
    }

    function syncClearButton() {
        if (clearButton) {
            clearButton.hidden = input.value.length === 0;
        }
    }

    function setInputValue(value) {
        input.value = value;
        syncClearButton();
    }

    function createIconSlot(itemId) {
        const slot = document.createElement('span');
        slot.className = 'item-combobox__icon';
        const img = document.createElement('img');
        img.src = getItemImageUrl(itemId);
        img.alt = '';
        img.loading = 'lazy';
        img.className = 'item-icon item-icon--sm';
        // No placeholder here (unlike lib/images.js's createItemImage): missing icons stay
        // blank so every row's name still lines up under the fixed-width icon slot.
        img.onerror = () => {
            img.remove();
        };
        slot.appendChild(img);
        return slot;
    }

    function visibleOptionEls() {
        return Array.from(panel.querySelectorAll('.item-combobox__option'));
    }

    function setActiveIndex(index) {
        const options = visibleOptionEls();
        options.forEach((el) => el.classList.remove('is-active'));
        if (options.length === 0) {
            activeIndex = -1;
            return;
        }
        activeIndex = ((index % options.length) + options.length) % options.length;
        const active = options[activeIndex];
        active.classList.add('is-active');
        active.scrollIntoView({ block: 'nearest' });
    }

    function renderPanel() {
        const query = input.value.trim().toLowerCase();
        panel.innerHTML = '';

        for (const group of groups) {
            const matches = query ? group.items.filter((item) => item.name.toLowerCase().includes(query)) : group.items;
            if (matches.length === 0) {
                continue;
            }

            const heading = document.createElement('div');
            heading.className = 'item-combobox__group-label';
            heading.textContent = categoryLabel(group.category);
            panel.appendChild(heading);

            for (const item of matches) {
                const option = document.createElement('div');
                option.className = 'item-combobox__option';
                option.setAttribute('role', 'option');
                option.dataset.itemId = item.id;
                if (item.id === selectedId) {
                    option.classList.add('is-selected');
                    option.setAttribute('aria-selected', 'true');
                }
                option.appendChild(createIconSlot(item.id));
                const label = document.createElement('span');
                label.textContent = item.name;
                option.appendChild(label);
                option.addEventListener('mousedown', (event) => {
                    // mousedown (not click) so this fires before the input's blur handler.
                    event.preventDefault();
                    selectItem(item.id);
                    close();
                });
                panel.appendChild(option);
            }
        }

        activeIndex = -1;
    }

    function open() {
        if (groups.length === 0) {
            return;
        }
        renderPanel();
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function close() {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        activeIndex = -1;
    }

    function isOpen() {
        return !panel.hidden;
    }

    // Sets the selection without notifying `onChange`, mirroring how assigning
    // `select.value = x` on a native <select> doesn't itself fire a "change" event.
    function applySelection(itemId) {
        selectedId = allItemsById().has(itemId) ? itemId : '';
        setInputValue(selectedName());
        updateSelectedIcon();
    }

    function selectItem(itemId) {
        applySelection(itemId);
        onChange?.(selectedId);
    }

    input.addEventListener('focus', () => {
        input.select();
        open();
    });

    input.addEventListener('click', () => {
        // Covers re-clicking an already-focused input after the panel was closed (e.g. by
        // picking an option or pressing Escape), when "focus" alone won't fire again.
        open();
    });

    input.addEventListener('input', () => {
        syncClearButton();
        open();
    });

    input.addEventListener('blur', () => {
        // Deferred so a mousedown-triggered selection (above) can run first.
        setTimeout(() => {
            close();
            // Typing without picking a match reverts the field to the current selection
            // (or blank) rather than leaving a stray, unmatched query behind.
            setInputValue(selectedName());
        }, 0);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!isOpen()) {
                open();
            }
            setActiveIndex(activeIndex + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen()) {
                open();
            }
            setActiveIndex(activeIndex - 1);
        } else if (event.key === 'Enter') {
            if (isOpen() && activeIndex >= 0) {
                event.preventDefault();
                const options = visibleOptionEls();
                const itemId = options[activeIndex]?.dataset.itemId;
                if (itemId) {
                    selectItem(itemId);
                }
            }
            close();
        } else if (event.key === 'Escape') {
            close();
            setInputValue(selectedName());
        }
    });

    if (clearButton) {
        clearButton.addEventListener('mousedown', (event) => {
            // mousedown (not click), preventDefault so the input never loses focus/blurs.
            event.preventDefault();
            selectItem('');
            input.focus();
            // open() re-renders the panel too, so the now-unfiltered list shows even if the
            // panel was already open (a bare input.focus() above is a no-op in that case).
            open();
        });
    }

    // `container` (declared above, alongside the selected-icon element) is used for the
    // outside-click check below rather than checking each child individually: the clear button
    // can go `hidden` mid-click (its own handler empties the field synchronously on mousedown),
    // which shifts the later "click" event's target to the wrapper itself as the button
    // disappears from hit-testing — `container.contains(event.target)` still holds true in
    // that case (a node contains itself), so the panel doesn't get closed as "outside".
    document.addEventListener('click', (event) => {
        if (!isOpen()) {
            return;
        }
        if (!container.contains(event.target)) {
            close();
        }
    });

    return {
        setItems(items) {
            const grouped = {};
            for (const [itemId, item] of Object.entries(items)) {
                const category = item.category || 'other';
                if (!grouped[category]) {
                    grouped[category] = [];
                }
                grouped[category].push({ id: itemId, name: localizedName(item.name) });
            }
            const sortedCategories = Object.keys(grouped).sort((a, b) =>
                categoryLabel(a).localeCompare(categoryLabel(b)),
            );
            for (const category of sortedCategories) {
                grouped[category].sort((a, b) => a.name.localeCompare(b.name));
            }
            groups = sortedCategories.map((category) => ({ category, items: grouped[category] }));

            // Re-affirm the current selection's displayed text (labels may have changed, e.g.
            // after a locale switch) and drop it entirely if it no longer exists.
            if (selectedId && !allItemsById().has(selectedId)) {
                selectedId = '';
            }
            setInputValue(selectedName());
            updateSelectedIcon();
            if (isOpen()) {
                renderPanel();
            }
        },
        getValue() {
            return selectedId;
        },
        setValue(itemId) {
            applySelection(itemId);
        },
        reset() {
            applySelection('');
        },
        hasItem(itemId) {
            return allItemsById().has(itemId);
        },
    };
}

export { createItemPicker };
