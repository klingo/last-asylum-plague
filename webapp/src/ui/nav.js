/**
 * The page header and footer, drawn by `renderNav(pageId)` (see page.js): Today, Calendar and the menus of the other
 * pages (`NAV_GROUPS`, below), the Sync button (once the build has a sync server) and the settings cogwheel; on phones a ☰ button shows the menus
 * stacked. The footer gets two stamps: when the data was last updated and when the site last changed. Both are
 * translated again on a language switch.
 */
import { t, getLocale, tHtml } from './i18n.js';
import { escapeAttr } from './html.js';
import { BASE_URL } from './base-url.js';
import { syncAvailable, syncLevel } from './sync.js';

// Date the pack data was last updated (`metadata.last_updated`), shown in the footer.
let dataDate = null;

/** Shows when the pack data was last updated, and when the site last changed, in the page footer (re-rendered on "localechange"). */
function showDataDate(date) {
    dataDate = date || null;
    renderStamps();
}

function formatStamp(iso) {
    // A date alone is read as local time, a full timestamp as the instant it names.
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
    return Number.isNaN(parsed.getTime())
        ? iso
        : parsed.toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderStamps() {
    const footer = document.querySelector('.app-footer');
    if (!footer) {
        return;
    }
    const stamps = [
        ['app-footer__updated', 'footer.lastUpdated', dataDate],
        // __LAST_CHANGE__ is set at build time (webapp/vite.config.js): the commit date of the deployed version.
        ['app-footer__change', 'footer.lastChange', __LAST_CHANGE__],
    ];
    for (const [className, key, value] of stamps) {
        if (!value) {
            continue;
        }
        let span = footer.querySelector(`.${className}`);
        if (!span) {
            span = document.createElement('span');
            span.className = className;
            footer.appendChild(span);
        }
        span.textContent = t(key, { date: formatStamp(value) });
    }
}

window.addEventListener('localechange', renderStamps);

// The top bar after Today: a page on its own (`{ page, href, label, description }`, a plain link) or a menu (label
// `nav.groups.<key>`) with its pages (`page` = the id passed to `renderNav`, `description` = the text shown on hover
// and read out by screen readers).
// New pages go into the menu whose question they answer; a menu of one page is a plain link instead.
const NAV_GROUPS = [
    {
        page: 'calendar',
        href: 'calendar.html',
        label: 'nav.calendar',
        description: 'nav.descriptions.calendar',
    },
    {
        key: 'shop',
        items: [
            {
                page: 'rankings',
                href: 'rankings.html',
                label: 'nav.rankings',
                description: 'nav.descriptions.rankings',
            },
            { page: 'events', href: 'events.html', label: 'nav.eventPlan', description: 'nav.descriptions.events' },
            {
                page: 'seasonal-passes',
                href: 'seasonal-passes.html',
                label: 'nav.seasonalPasses',
                description: 'nav.descriptions.seasonalPasses',
            },
            {
                page: 'spend-rewards',
                href: 'spend-rewards.html',
                label: 'nav.spendRewards',
                description: 'nav.descriptions.spendRewards',
            },
        ],
    },
    {
        key: 'items',
        items: [
            { page: 'sources', href: 'sources.html', label: 'nav.sources', description: 'nav.descriptions.sources' },
            { page: 'choices', href: 'choices.html', label: 'nav.choices', description: 'nav.descriptions.choices' },
            { page: 'compare', href: 'compare.html', label: 'nav.compare', description: 'nav.descriptions.compare' },
            { page: 'items', href: 'items.html', label: 'nav.items', description: 'nav.descriptions.items' },
        ],
    },
    {
        key: 'heroes',
        items: [
            { page: 'heroes', href: 'heroes.html', label: 'nav.heroes', description: 'nav.descriptions.heroes' },
            { page: 'gear', href: 'gear.html', label: 'nav.gear', description: 'nav.descriptions.gear' },
            { page: 'skills', href: 'skills.html', label: 'nav.skills', description: 'nav.descriptions.skills' },
        ],
    },
    {
        key: 'lord',
        items: [
            {
                page: 'lord-specialty',
                href: 'lord-specialty.html',
                label: 'nav.lordSpecialty',
                description: 'nav.descriptions.lordSpecialty',
            },
        ],
    },
];

/** The Sync button's dot and tooltip: how the sync is doing (green, amber, red; grey when it is off). */
function updateSyncIndicator() {
    const link = document.querySelector('.app-sync-link');
    if (!link) {
        return;
    }
    const level = syncLevel();
    const state = t(`nav.syncState.${level}`);
    link.querySelector('.app-sync-dot').className = `app-sync-dot app-sync-dot--${level}`;
    link.title = state;
    link.setAttribute('aria-label', `${t('nav.sync')}: ${state}`);
}

window.addEventListener('syncchange', updateSyncIndicator);

// Remembered across `renderNav()` calls so the "localechange" listener below can re-render
// with the same active page without having to re-derive it from the (about to be replaced) DOM.
let currentActivePage = 'today';

/** Closes every open menu except `keep` (a `.app-nav__group`, or none). */
function closeMenus(keep = null) {
    document.querySelectorAll('.app-nav__group.open').forEach((group) => {
        if (group !== keep) {
            group.classList.remove('open');
            group.querySelector('.app-nav__group-button').setAttribute('aria-expanded', 'false');
        }
    });
}

/**
 * Renders the shared top navigation bar (menus with their pages, plus the Sync button and the settings cogwheel)
 * and marks the current page and its menu as active. Re-run automatically on every
 * "localechange" event so the nav's own text stays in sync, without each page having to
 * remember to do it.
 */
function renderNav(activePage) {
    currentActivePage = activePage;
    const header = document.querySelector('.app-header');
    if (!header) {
        return;
    }
    const base = BASE_URL;
    const link = (href, label, active, description) =>
        `<a href="${base}${href}" class="${active ? 'active' : ''}" title="${escapeAttr(t(description))}" ${active ? 'aria-current="page"' : ''}>${tHtml(label)}</a>`;
    const groups = NAV_GROUPS.map((group) => {
        if (!group.items) {
            return link(group.href, group.label, group.page === activePage, group.description);
        }
        const active = group.items.some((item) => item.page === activePage);
        const items = group.items
            .map((item) => link(item.href, item.label, item.page === activePage, item.description))
            .join('');
        return `
            <div class="app-nav__group ${active ? 'active' : ''}">
                <button type="button" class="app-nav__group-button" aria-expanded="false" aria-haspopup="true">
                    ${tHtml(`nav.groups.${group.key}`)}<span class="app-nav__caret" aria-hidden="true">▾</span>
                </button>
                <div class="app-nav__menu">${items}</div>
            </div>`;
    }).join('');
    header.innerHTML = `
        <h1><a href="${base}index.html" class="app-title">${tHtml('app.title')}</a></h1>
        <button type="button" class="app-nav__toggle" aria-expanded="${header.classList.contains('nav-open')}" aria-controls="app-nav" aria-label="${tHtml('nav.menu')}">☰</button>
        <nav class="app-nav" id="app-nav">
            ${link('index.html', 'nav.home', activePage === 'today', 'today.description')}
            ${groups}
        </nav>
        <div class="app-header__tools">
            ${syncAvailable() ? `<a href="${base}sync.html" class="app-sync-link${activePage === 'sync' ? ' active' : ''}" ${activePage === 'sync' ? 'aria-current="page"' : ''}><span class="app-sync-dot" aria-hidden="true"></span>${tHtml('nav.sync')}</a>` : ''}
            <a href="${base}settings.html" class="app-settings-link${activePage === 'settings' ? ' active' : ''}" title="${tHtml('nav.settings')}" aria-label="${tHtml('nav.settings')}" ${activePage === 'settings' ? 'aria-current="page"' : ''}>⚙</a>
        </div>
    `;

    updateSyncIndicator();
    const toggle = header.querySelector('.app-nav__toggle');
    toggle.addEventListener('click', () => {
        const open = header.classList.toggle('nav-open');
        toggle.setAttribute('aria-expanded', String(open));
    });
    header.querySelectorAll('.app-nav__group').forEach((group) => {
        const button = group.querySelector('.app-nav__group-button');
        button.addEventListener('click', () => {
            closeMenus(group);
            const open = group.classList.toggle('open');
            button.setAttribute('aria-expanded', String(open));
        });
        // A menu opened by click closes once the mouse leaves it (hover opens it anyway).
        group.addEventListener('mouseleave', () => closeMenus());
    });
}

document.addEventListener('click', (event) => {
    if (!event.target.closest('.app-nav__group')) {
        closeMenus();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }
    const open = document.querySelector('.app-nav__group.open');
    if (open) {
        closeMenus();
        open.querySelector('.app-nav__group-button').focus();
    }
});

window.addEventListener('localechange', () => {
    renderNav(currentActivePage);
});

export { renderNav, showDataDate };
