/**
 * Settings > Admin: records when events, passes and tracks run, from the site. With a GitHub token saved in this
 * browser (ui/github.js) it offers the forecast runs on today that aren't recorded yet (one button each) and any
 * event, pass or track from a first day and a number of days (pre-filled with its usual one). A request is only sent
 * after a confirmation; it starts the record-run workflow, which commits the run and deploys the site.
 */
import { dayNumber, dayText, gameDay, recordableIds, unrecordedToday, usualRunDays } from '../../core/schedule.js';
import { formatRunDays } from '../../ui/datetime.js';
import { scheduleName } from '../../ui/event-banner.js';
import { RUNS_URL, checkToken, clearToken, dispatchRecordRun, readToken, saveToken } from '../../ui/github.js';
import { escapeAttr, escapeHtml } from '../../ui/html.js';
import { getLocale, t, tHtml } from '../../ui/i18n.js';

// How many characters at the end of the token are shown to recognise it.
const TOKEN_TAIL = 4;

let data = null;
// The request waiting for the confirmation, `{ ids, start, days }` (start as YYYY-MM-DD), or null.
let pending = null;
// The runs sent from this page (`id|start`), so a forecast row can't be sent twice.
const sent = new Set();
// What the last request came to: `{ ok: true }` or `{ error }` (a code of `settings.admin.error`), or null.
let outcome = null;
// The reason the token wasn't saved (a code of `settings.admin.error`), or null.
let tokenError = null;
let busy = false;

const byId = (id) => document.getElementById(id);
const runKey = (id, start) => `${id}|${start}`;
const todayDay = () => gameDay(new Date()).day;

/** A link opening in a new tab, its text from the translation `key`. */
const linkHtml = (url, key) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${tHtml(key)}</a>`;

/** The ids sorted by name. */
function byName(ids) {
    return [...ids]
        .map((id) => ({ id, name: scheduleName(data, id) }))
        .sort((a, b) => a.name.localeCompare(b.name, getLocale()));
}

function renderToken() {
    const token = readToken();
    byId('admin-login').hidden = token !== null;
    byId('admin-session').hidden = token === null;
    byId('admin-token-note').hidden = tokenError === null;
    byId('admin-token-note').textContent = tokenError === null ? '' : t(`settings.admin.error.${tokenError}`);
    byId('admin-token-save').disabled = busy;
    byId('admin-token-saved').textContent =
        token === null ? '' : t('settings.admin.tokenSaved', { tail: token.slice(-TOKEN_TAIL) });
    byId('admin-logout').textContent = t('settings.admin.logout');
}

/** The forecast runs on today that aren't recorded, each with its Record button (or "Sent"). */
function renderToday() {
    const entries = unrecordedToday(data, todayDay())
        .map((entry) => ({ ...entry, name: scheduleName(data, entry.id) }))
        .sort((a, b) => a.name.localeCompare(b.name, getLocale()));
    byId('admin-today').innerHTML =
        entries.length === 0
            ? `<li class="text-dim">${tHtml('settings.admin.todayEmpty')}</li>`
            : entries
                  .map(({ id, name, run, proven }) => {
                      const start = dayText(run.start);
                      const days = run.end - run.start + 1;
                      const action = sent.has(runKey(id, start))
                          ? `<span class="text-good">${tHtml('settings.admin.rowSent')}</span>`
                          : `<button type="button" class="btn-small" data-id="${escapeAttr(id)}" data-start="${start}" data-days="${days}">${tHtml('settings.admin.record')}</button>`;
                      return `<li class="admin-row">
                          <span class="admin-row__name">${escapeHtml(name)}</span>
                          <span class="admin-row__range text-dim">${escapeHtml(formatRunDays(run))}</span>
                          <span class="text-dim">${tHtml(proven ? 'settings.admin.proven' : 'settings.admin.guess')}</span>
                          ${action}
                      </li>`;
                  })
                  .join('');
}

/** The choice of everything that can be recorded, grouped; the selection stays. */
function renderOptions() {
    const select = byId('admin-id');
    const selected = select.value;
    const kinds = recordableIds(data);
    const ingame = (id) => data.events[id].category === 'ingame_event';
    const groups = [
        ['groupEvents', [...kinds.events].filter((id) => !ingame(id))],
        ['groupIngame', [...kinds.events].filter(ingame)],
        ['groupPasses', [...kinds.seasonal_passes]],
        ['groupTracks', [...kinds.spend_reward_tracks]],
    ];
    select.innerHTML = groups
        .map(
            ([key, ids]) =>
                `<optgroup label="${escapeAttr(t(`calendar.schedule.${key}`))}">${byName(ids)
                    .map(({ id, name }) => `<option value="${escapeAttr(id)}">${escapeHtml(name)}</option>`)
                    .join('')}</optgroup>`,
        )
        .join('');
    if (selected) {
        select.value = selected;
    }
}

/** The days field shows how long the selected id usually runs (empty without a recorded run). */
function fillDays() {
    byId('admin-days').value = usualRunDays(data, byId('admin-id').value) ?? '';
}

function renderConfirm() {
    byId('admin-confirm').hidden = pending === null;
    if (pending) {
        const { ids, start, days } = pending;
        const run = { start: dayNumber(start), end: dayNumber(start) + days - 1 };
        byId('admin-confirm-text').textContent = t('settings.admin.confirm', {
            name: ids.map((id) => scheduleName(data, id)).join(', '),
            range: formatRunDays(run),
        });
    }
    byId('admin-confirm-yes').textContent = t(busy ? 'settings.admin.sending' : 'settings.admin.confirmYes');
    byId('admin-confirm-yes').disabled = busy;
    byId('admin-confirm-no').textContent = t('settings.admin.confirmNo');
    byId('admin-confirm-no').disabled = busy;
}

function renderOutcome() {
    const element = byId('admin-result');
    element.hidden = outcome === null;
    element.className = outcome?.ok ? 'text-good' : 'text-bad';
    if (outcome?.ok) {
        element.innerHTML = tHtml('settings.admin.sent', { link: linkHtml(RUNS_URL, 'settings.admin.sentLink') });
    } else {
        element.textContent = outcome ? t(`settings.admin.error.${outcome.error}`) : '';
    }
}

function render() {
    renderToken();
    renderConfirm();
    renderOutcome();
    if (readToken() !== null) {
        renderToday();
        renderOptions();
    }
}

/** Checks the entered token against the workflow, and keeps it only when GitHub accepts it. */
async function submitToken(event) {
    event.preventDefault();
    const input = byId('admin-token');
    const token = input.value.trim();
    if (!token) {
        return;
    }
    tokenError = null;
    busy = true;
    renderToken();
    const result = await checkToken(token);
    busy = false;
    if (result === 'ok') {
        saveToken(token);
        input.value = '';
    } else {
        tokenError = result;
    }
    render();
    if (result === 'ok') {
        fillDays();
    }
}

function logout() {
    clearToken();
    pending = null;
    outcome = null;
    render();
}

/** Asks for the confirmation of a request: nothing is sent before. */
function ask(request) {
    outcome = null;
    pending = request;
    renderOutcome();
    renderConfirm();
    byId('admin-confirm').scrollIntoView({ block: 'nearest' });
}

/** Sends the confirmed request. */
async function send() {
    const request = pending;
    busy = true;
    renderConfirm();
    const result = await dispatchRecordRun(readToken(), request);
    busy = false;
    pending = null;
    outcome = result === 'ok' ? { ok: true } : { error: result };
    if (result === 'ok') {
        request.ids.forEach((id) => sent.add(runKey(id, request.start)));
    }
    render();
}

/** The manual form as a request, or null (and a message) when something is missing. */
function manualRequest() {
    const id = byId('admin-id').value;
    const start = byId('admin-start').value;
    const days = Number(byId('admin-days').value);
    if (!id || !start || !Number.isInteger(days) || days < 1) {
        outcome = { error: 'form' };
        renderOutcome();
        return null;
    }
    return { ids: [id], start, days };
}

/** Wires the Admin section: `packData` is the normalized pack data. */
function initAdmin(packData) {
    data = packData;
    byId('admin-start').value = dayText(todayDay());
    byId('admin-token-form').addEventListener('submit', submitToken);
    byId('admin-logout').addEventListener('click', logout);
    byId('admin-today').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-id]');
        if (button) {
            ask({ ids: [button.dataset.id], start: button.dataset.start, days: Number(button.dataset.days) });
        }
    });
    byId('admin-id').addEventListener('change', fillDays);
    byId('admin-record').addEventListener('click', () => {
        const request = manualRequest();
        if (request) {
            ask(request);
        }
    });
    byId('admin-confirm-yes').addEventListener('click', send);
    byId('admin-confirm-no').addEventListener('click', () => {
        pending = null;
        renderConfirm();
    });
    render();
    if (readToken() !== null) {
        fillDays();
    }
}

export { initAdmin, render as renderAdmin };
