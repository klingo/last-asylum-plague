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

import { createItemImage } from './images.js';
import { findTile } from '../core/art-tile.js';

const TILE_ANALYSIS_WIDTH = 128; // px a picture is scaled down to for finding its tile

let tooltipEl = null;
const tiles = new Map(); // picture URL -> its tile (null: none), found once

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

    // What pops out above the card (a picture's top, see fitTile) needs room too, and below the trigger the card
    // starts that much lower so the pop-out doesn't cover the trigger.
    const image = el.querySelector('.app-tooltip__image');
    const popOut = image ? Math.max(0, tooltipRect.top - image.getBoundingClientRect().top) : 0;

    // Default above the trigger, flipping below it if there isn't room.
    let top = triggerRect.top - tooltipRect.height - spacing;
    if (top - popOut < 0) {
        top = triggerRect.bottom + spacing + popOut;
    }

    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tooltipRect.width - 4));

    el.style.top = `${top + window.scrollY}px`;
    el.style.left = `${left + window.scrollX}px`;
}

/**
 * The tooltip's lines as rows (`data-tooltip-rows`: JSON `[{ text, item? }]`), each with the item's icon in front if it
 * has one. The popup is as wide as its longest row, so a line doesn't break. `data-tooltip` stays the plain text (the
 * accessible name).
 */
function fillRows(el, rows) {
    el.textContent = '';
    for (const { text, item } of rows) {
        const row = document.createElement('div');
        row.className = 'app-tooltip__row';
        if (item) {
            row.append(createItemImage(item, '', 'item-icon item-icon--sm'));
        }
        const line = document.createElement('span');
        line.textContent = text;
        row.append(line);
        el.append(row);
    }
}

/** The tile of a loaded picture (core/art-tile.js), from its alpha channel; null without one (or if it can't be read). */
function tileOf(image) {
    if (!tiles.has(image.src)) {
        const width = Math.min(TILE_ANALYSIS_WIDTH, image.naturalWidth);
        const height = Math.max(1, Math.round((image.naturalHeight * width) / image.naturalWidth));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        let tile = null;
        try {
            const pixels = context.getImageData(0, 0, width, height).data;
            tile = findTile(
                Uint8Array.from({ length: width * height }, (_, i) => pixels[i * 4 + 3]),
                width,
                height,
            );
        } catch {
            // not readable: shown whole
        }
        tiles.set(image.src, tile);
    }
    return tiles.get(image.src);
}

/**
 * Sizes and places a loaded picture so that its tile (the rounded rectangle of the game's art) fills the card from side
 * to side and starts at the card's top, as an event's art always did; what the picture has outside its tile (a chest
 * rising over the tile's top) pops out of the card. The text starts below the whole picture. The CSS (`app-tooltip__image--tile`) turns these shares of the
 * picture into sizes. A picture without a tile is shown whole.
 */
function fitTile(image) {
    const tile = tileOf(image);
    if (!tile) {
        return;
    }
    const wider = 1 / (tile.right - tile.left); // the picture is this much wider than the card
    const aspect = image.naturalHeight / image.naturalWidth;
    image.classList.add('app-tooltip__image--tile');
    image.style.setProperty('--art-wider', wider);
    image.style.setProperty('--art-left', tile.left * wider);
    image.style.setProperty('--art-top', tile.top * aspect * wider);
}

function showTooltip(trigger) {
    const el = ensureTooltipEl();
    const rows = trigger.dataset.tooltipRows ? JSON.parse(trigger.dataset.tooltipRows) : null;
    el.classList.toggle('app-tooltip--rows', Boolean(rows));
    if (rows) {
        fillRows(el, rows);
    } else {
        el.textContent = trigger.dataset.tooltip || '';
    }
    // Optional picture above the text (`data-tooltip-image`: an event's art, a weekday offer's own picture on the
    // Calendar), greyed with `data-tooltip-image-muted` (an ended run).
    el.classList.toggle('app-tooltip--image', Boolean(trigger.dataset.tooltipImage));
    if (trigger.dataset.tooltipImage) {
        const image = document.createElement('img');
        image.className = `app-tooltip__image${'tooltipImageMuted' in trigger.dataset ? ' app-tooltip__image--muted' : ''}`;
        image.alt = '';
        image.src = trigger.dataset.tooltipImage;
        // Fitted and placed again once the picture is there (it may not be loaded yet), if it is still the one shown.
        image.addEventListener('load', () => {
            if (image.isConnected) {
                fitTile(image);
                if (!el.hidden) {
                    positionTooltip(trigger);
                }
            }
        });
        // A picture that doesn't exist (a weekday offer without its own yet) is left out: the text alone. (The popup is
        // shared: only while this picture is still the one in it.)
        image.addEventListener('error', () => {
            if (image.isConnected) {
                image.remove();
                el.classList.remove('app-tooltip--image');
                if (!el.hidden) {
                    positionTooltip(trigger);
                }
            }
        });
        el.prepend(image);
    }
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
