/**
 * The page's fixed lists, icons and asset paths.
 */
import { BASE_URL } from '../../ui/base-url.js';

const ASSETS = `${BASE_URL}assets/`;
const PATHS = ['craft', 'level', 'stars'];
// The page's icons: the same in the guide and in "How it works".
const LANE_ICONS = { craft: '🔨', level: '⬆', stars: '★' };
const ACTION_ICONS = { done: '✓', undo: '↶', craftAll: '⏭', startOver: '↺', hold: '⏸', blocked: '⛔' };

export { ACTION_ICONS, ASSETS, LANE_ICONS, PATHS };
