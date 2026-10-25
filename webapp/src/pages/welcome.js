import { startPage } from '../ui/page.js';
import { getSettings, updateSettings } from '../ui/settings.js';
import { hydrateItemIcons } from '../ui/html.js';

// Home: the nav, static texts and the settings that shape every value (the pack data for item icons).

/** One setting's switch: shows the stored value with the line describing it highlighted (the other one dimmed). */
function wireSetting(id, key) {
    const input = document.getElementById(id);
    const showState = () => {
        const state = input.checked ? 'on' : 'off';
        for (const line of input.closest('.setting-row').querySelectorAll('.setting-row__state')) {
            line.classList.toggle('setting-row__state--active', line.dataset.state === state);
        }
    };
    input.checked = getSettings()[key] === true;
    showState();
    input.addEventListener('change', () => {
        updateSettings({ [key]: input.checked });
        showState();
    });
}

startPage('welcome', {
    init() {
        hydrateItemIcons(document.querySelector('.welcome-settings'));
        wireSetting('count-vip-points', 'vipPointsInWorth');
    },
});
