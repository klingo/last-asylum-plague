/**
 * Small builders for the page's grid cells.
 */
import { itemIconSlot } from '../../ui/html.js';
import { gridCell, gridNum, gridHeader } from '../../ui/grid.js';
import { tHtml } from '../../ui/i18n.js';

const iconHtml = itemIconSlot;
const cell = (html, className = '') => gridCell(html, { className });
const numCell = gridNum;
// `wide`: column hidden on phones (Limit, Worth, Cost in Banknotes of the packs and shop tables).
const WIDE = { wide: true };
const headerCell = (key, num = false, wide = false) => gridHeader(tHtml(key), { num, wide });

export { WIDE, cell, headerCell, iconHtml, numCell };
