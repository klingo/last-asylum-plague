/**
 * The page's fixed lists, icons and asset paths.
 */
import { BASE_URL } from '../../ui/base-url.js';

const ASSETS = `${BASE_URL}assets/`;
const STORAGE_KEY = 'lasps_gear_progress';
const PATHS = ['craft', 'level', 'stars'];
// In this order on the faction switch.
const FACTIONS = ['warrior', 'ranger', 'warlock'];
// The page's icons: the same in the guide and in "How it works". Factions and classes have the game's images
// (assets/gear/factions, assets/gear/classes).
const LANE_ICONS = { craft: '🔨', level: '⬆', stars: '★' };
const ACTION_ICONS = { done: '✓', undo: '↶', craftAll: '⏭', startOver: '↺', hold: '⏸', blocked: '⛔' };

export { ACTION_ICONS, ASSETS, FACTIONS, LANE_ICONS, PATHS, STORAGE_KEY };
