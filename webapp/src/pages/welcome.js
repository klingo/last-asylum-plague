import { startPage } from '../ui/page.js';
import { getSettings, updateSettings } from '../ui/settings.js';
import { hydrateItemIcons } from '../ui/html.js';

// Home: the nav, static texts and the settings that shape every value (the pack data only for item icons).
const countVipPoints = document.getElementById('count-vip-points');

/** The switch's state, and the line describing it highlighted (the other one dimmed). */
function showVipState() {
    const state = countVipPoints.checked ? 'on' : 'off';
    for (const line of document.querySelectorAll('.setting-row__state')) {
        line.classList.toggle('setting-row__state--active', line.dataset.state === state);
    }
}

startPage('welcome', {
    init() {
        hydrateItemIcons(document.querySelector('.welcome-settings'));
        countVipPoints.checked = getSettings().vipPointsInWorth === true;
        showVipState();
        countVipPoints.addEventListener('change', () => {
            updateSettings({ vipPointsInWorth: countVipPoints.checked });
            showVipState();
        });
    },
});
