import { t, getLocale, setLocale, LOCALES } from './i18n.js';

// Date the pack data was last updated (`metadata.last_updated`), shown in the footer.
let dataDate = null;

/** Shows when the pack data was last updated in the page footer (re-rendered on "localechange"). */
function showDataDate(date) {
    dataDate = date || null;
    renderDataDate();
}

function renderDataDate() {
    const footer = document.querySelector('.app-footer');
    if (!footer || !dataDate) {
        return;
    }
    let span = footer.querySelector('.app-footer__updated');
    if (!span) {
        span = document.createElement('span');
        span.className = 'app-footer__updated';
        footer.appendChild(span);
    }
    const parsed = new Date(`${dataDate}T00:00:00`);
    const date = Number.isNaN(parsed.getTime())
        ? dataDate
        : parsed.toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
    span.textContent = t('footer.lastUpdated', { date });
}

window.addEventListener('localechange', renderDataDate);

// The top menus (label `nav.groups.<key>`) and their pages (`page` = the id passed to `renderNav`).
// New pages go into the menu whose question they answer.
const NAV_GROUPS = [
    {
        key: 'shop',
        items: [
            { page: 'rankings', href: 'rankings.html', label: 'nav.rankings' },
            { page: 'spend-rewards', href: 'spend-rewards.html', label: 'nav.spendRewards' },
            { page: 'choices', href: 'choices.html', label: 'nav.choices' },
        ],
    },
    {
        key: 'events',
        items: [
            { page: 'calendar', href: 'calendar.html', label: 'nav.calendar' },
            { page: 'events', href: 'events.html', label: 'nav.eventPlan' },
        ],
    },
    {
        key: 'items',
        items: [
            { page: 'items', href: 'items.html', label: 'nav.items' },
            { page: 'sources', href: 'sources.html', label: 'nav.sources' },
            { page: 'compare', href: 'compare.html', label: 'nav.compare' },
        ],
    },
    {
        key: 'heroes',
        items: [{ page: 'gear', href: 'gear.html', label: 'nav.gear' }],
    },
];

// Remembered across `renderNav()` calls so the "localechange" listener below can re-render
// with the same active page without having to re-derive it from the (about to be replaced) DOM.
let currentActivePage = 'welcome';

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
 * Renders the shared top navigation bar (menus with their pages, plus the language switcher)
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
    const base = import.meta.env.BASE_URL;
    const locale = getLocale();
    const langOptions = Object.entries(LOCALES)
        .map(([code, { label }]) => `<option value="${code}" ${code === locale ? 'selected' : ''}>${label}</option>`)
        .join('');
    const link = (href, label, active) =>
        `<a href="${base}${href}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${t(label)}</a>`;
    const groups = NAV_GROUPS.map((group) => {
        const active = group.items.some((item) => item.page === activePage);
        const items = group.items.map((item) => link(item.href, item.label, item.page === activePage)).join('');
        return `
            <div class="app-nav__group ${active ? 'active' : ''}">
                <button type="button" class="app-nav__group-button" aria-expanded="false" aria-haspopup="true">
                    ${t(`nav.groups.${group.key}`)}<span class="app-nav__caret" aria-hidden="true">▾</span>
                </button>
                <div class="app-nav__menu">${items}</div>
            </div>`;
    }).join('');
    header.innerHTML = `
        <h1><a href="${base}index.html" class="app-title">${t('app.title')}</a></h1>
        <button type="button" class="app-nav__toggle" aria-expanded="${header.classList.contains('nav-open')}" aria-controls="app-nav" aria-label="${t('nav.menu')}">☰</button>
        <nav class="app-nav" id="app-nav">
            ${link('index.html', 'nav.home', activePage === 'welcome')}
            ${groups}
        </nav>
        <label class="lang-switch">
            <span class="sr-only">${t('nav.language')}</span>
            <select id="lang-select">${langOptions}</select>
        </label>
    `;

    header.querySelector('#lang-select').addEventListener('change', (event) => {
        setLocale(event.target.value);
    });
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
