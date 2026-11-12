/**
 * Sync (the header's Sync button): the same settings and progress on every device (ui/sync.js). "Connect another
 * device" turns sync on if needed and shows a six-digit code with a QR code of the link that holds it, valid for 10
 * minutes and one use: the other device types the code (phone to desktop) or scans the QR code (desktop to phone).
 * Connecting replaces the device's data with the synced one, so it always asks first. The key itself is only a backup
 * (copy it, or open its link on a device).
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/sync.css';
import { formatPairingCode, formatSyncKey, parsePairingCode, parseSyncKey } from '../core/sync.js';
import { formatMoment } from '../ui/datetime.js';
import { t } from '../ui/i18n.js';
import {
    connectWithCode,
    connectWithKey,
    createPairing,
    deleteSync,
    disableSync,
    enableSync,
    pairingPending,
    rotateKey,
    syncStatus,
    uploadAgain,
} from '../ui/sync.js';

const POLL_MS = 3000;
const TICK_MS = 1000;
// The code is shown as expired this much earlier than the server drops it, so a request in flight can't read as "used".
const PAIRING_SLACK_MS = 5000;
// The calls that end in a status line instead of a message.
const PROBLEMS = ['network', 'rateLimited', 'notFound', 'error'];

// The question waiting for a yes: `{ kind: 'code' | 'key' | 'rotate' | 'delete', value }`, or null.
let pending = null;
// The code shown for another device: `{ code, deadline (ms), claimed }`, or null.
let pairing = null;
let pollTimer = null;
let tickTimer = null;
// What the last action came to: `{ ok }` (a code of `sync.done`) or `{ error }` (of `sync.error`).
let outcome = null;
let busy = false;

const byId = (id) => document.getElementById(id);
// The settings page without the hash or query of a link (the address of the links we hand out).
const pageUrl = () => `${window.location.origin}${window.location.pathname}`;

function stopTimers() {
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    pollTimer = null;
    tickTimer = null;
}

/** "9:41" left of the code's time. */
function timeLeft() {
    const seconds = Math.max(0, Math.ceil((pairing.deadline - Date.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The badge and sentence that say whether anything is stored on the sync server. */
function renderState(status) {
    const badge = byId('sync-badge');
    badge.className = `sync-badge sync-badge--${status.on ? 'on' : 'off'}`;
    badge.textContent = t(status.on ? 'sync.stateOn' : 'sync.stateOff');
    byId('sync-state-text').textContent = t(status.on ? 'sync.stateOnText' : 'sync.stateOffText');
}

function renderStatus(status) {
    const element = byId('sync-status');
    element.hidden = !status.on;
    const problem = PROBLEMS.includes(status.code) ? status.code : null;
    element.className = problem ? 'text-bad' : 'text-dim';
    if (problem) {
        element.textContent = t(`sync.status.${problem}`);
    } else {
        element.textContent =
            status.synced === null
                ? t('sync.status.waiting')
                : t('sync.status.synced', { time: formatMoment(status.synced) });
    }
}

function renderConfirm() {
    byId('sync-confirm').hidden = pending === null;
    if (pending) {
        const value = pending.kind === 'code' ? formatPairingCode(pending.value) : '';
        byId('sync-confirm-text').textContent = t(`sync.confirm.${pending.kind}`, { code: value });
        const yes = pending.kind === 'rotate' || pending.kind === 'delete' ? pending.kind : 'connect';
        byId('sync-confirm-yes').textContent = t(`sync.yes.${yes}`);
    }
}

function renderResult() {
    const element = byId('sync-result');
    element.hidden = outcome === null;
    element.className = outcome?.ok ? 'text-good' : 'text-bad';
    element.textContent = outcome ? t(outcome.ok ? `sync.done.${outcome.ok}` : `sync.error.${outcome.error}`) : '';
}

/** The code, its time left and the QR code (shown once a code is made). */
function renderPairing() {
    byId('sync-pair').hidden = pairing === null;
    if (!pairing) {
        return;
    }
    const expired = !pairing.claimed && Date.now() >= pairing.deadline;
    const note = byId('sync-pair-note');
    byId('sync-pair').classList.toggle('sync-box--used', pairing.claimed || expired);
    byId('sync-pair-code').textContent = formatPairingCode(pairing.code);
    byId('sync-pair-renew').hidden = !(pairing.claimed || expired);
    note.className = pairing.claimed ? 'text-good' : expired ? 'text-warn' : 'text-dim';
    if (pairing.claimed) {
        note.textContent = t('sync.pairClaimed');
    } else {
        note.textContent = expired ? t('sync.pairExpired') : t('sync.pairLeft', { time: timeLeft() });
    }
}

function render() {
    const status = syncStatus();
    renderState(status);
    renderStatus(status);
    renderConfirm();
    renderResult();
    renderPairing();
    byId('sync-off-box').hidden = status.on;
    byId('sync-on-box').hidden = !status.on;
    byId('sync-more').hidden = !status.on;
    byId('sync-upload').hidden = !(status.on && status.code === 'notFound');
    byId('sync-key').value = status.key ? formatSyncKey(status.key) : '';
    document.querySelectorAll('#sync button').forEach((button) => {
        button.disabled = busy;
    });
}

/** Asks for the yes of a step that replaces data or ends the sync: nothing happens before. */
function ask(question) {
    outcome = null;
    pending = question;
    render();
    byId('sync-confirm').scrollIntoView({ block: 'nearest' });
}

/** The message for a failed `code` of a step of `kind`. */
function errorOf(kind, code) {
    if (code === 'notFound' && (kind === 'code' || kind === 'key')) {
        return kind === 'code' ? 'badCode' : 'badKey';
    }
    return code;
}

/** Does the confirmed step. Connecting reloads the page, which then shows the synced data. */
async function confirm() {
    const { kind, value } = pending;
    busy = true;
    render();
    const steps = {
        code: () => connectWithCode(value),
        key: () => connectWithKey(value),
        rotate: rotateKey,
        delete: deleteSync,
    };
    const code = await steps[kind]();
    busy = false;
    pending = null;
    if (code !== 'ok') {
        outcome = { error: errorOf(kind, code) };
    } else if (kind === 'code' || kind === 'key') {
        window.location.reload();
        return;
    } else {
        outcome = { ok: kind === 'rotate' ? 'rotated' : 'deleted' };
        closePairing();
    }
    render();
}

function closePairing() {
    stopTimers();
    pairing = null;
}

/** The other device may have used the code. */
async function poll() {
    const shown = pairing;
    const { code, pending: waiting } = await pairingPending();
    if (shown === pairing && code === 'ok' && !waiting && Date.now() < shown.deadline) {
        shown.claimed = true;
        stopTimers();
        render();
    }
}

function tick() {
    renderPairing();
    if (Date.now() >= pairing.deadline) {
        stopTimers();
    }
}

/** Turns sync on: this device's settings and progress are uploaded, which is when they first reach the server. */
async function enable() {
    outcome = null;
    busy = true;
    render();
    const code = await enableSync();
    busy = false;
    outcome = code === 'ok' ? { ok: 'enabled' } : { error: code };
    render();
}

/** A code for the device to add (sync is on). */
async function openPairing() {
    outcome = null;
    busy = true;
    render();
    const { code, pairing: made } = await createPairing();
    busy = false;
    if (code !== 'ok') {
        outcome = { error: code };
        render();
        return;
    }
    closePairing();
    pairing = { code: made.code, deadline: Date.now() + made.expiresIn * 1000 - PAIRING_SLACK_MS, claimed: false };
    // The link of the QR code holds the code, not the key: a picture of it is useless once the code is used.
    try {
        const { renderSVG } = await import('uqr');
        byId('sync-qr').innerHTML = renderSVG(`${pageUrl()}#pair=${made.code}`, { border: 2 });
    } catch {
        // The QR code's script wasn't loaded (offline): the code beside it still works.
        byId('sync-qr').textContent = '';
    }
    pollTimer = setInterval(poll, POLL_MS);
    tickTimer = setInterval(tick, TICK_MS);
    render();
}

/** The typed code (or key). */
function submitCode(event) {
    event.preventDefault();
    const text = byId('sync-code').value;
    const code = parsePairingCode(text);
    const key = code ? null : parseSyncKey(text);
    if (code || key) {
        byId('sync-code').value = '';
        ask(code ? { kind: 'code', value: code } : { kind: 'key', value: key });
    } else {
        outcome = { error: 'badInput' };
        render();
    }
}

/** Copies `text`; where the browser doesn't allow it, the key field is selected for the user to copy. */
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        outcome = { ok: 'copied' };
    } catch {
        byId('sync-key').select();
        outcome = { error: 'copyFailed' };
    }
    render();
}

async function uploadAgainNow() {
    outcome = null;
    busy = true;
    render();
    const code = await uploadAgain();
    busy = false;
    outcome = code === 'ok' ? { ok: 'uploaded' } : { error: code };
    render();
}

/** A link of a pairing code or a key (`#pair=` / `#sync=`) was opened: its question, and the address cleaned. */
function takeLink() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has('pair') && !params.has('sync')) {
        return null;
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    const code = parsePairingCode(params.get('pair') ?? '');
    const key = parseSyncKey(params.get('sync') ?? '');
    if (code) {
        return { kind: 'code', value: code };
    }
    return key ? { kind: 'key', value: key } : null;
}

/** Wires the page; a link of a pairing code or key opens with its question. */
function init() {
    byId('sync-enable').addEventListener('click', enable);
    byId('sync-pair-open').addEventListener('click', openPairing);
    byId('sync-pair-renew').addEventListener('click', openPairing);
    byId('sync-upload').addEventListener('click', uploadAgainNow);
    byId('sync-code-form').addEventListener('submit', submitCode);
    byId('sync-confirm-yes').addEventListener('click', confirm);
    byId('sync-confirm-no').addEventListener('click', () => {
        pending = null;
        render();
    });
    byId('sync-copy-key').addEventListener('click', () => copy(formatSyncKey(syncStatus().key)));
    byId('sync-copy-link').addEventListener('click', () => copy(`${pageUrl()}#sync=${syncStatus().key}`));
    byId('sync-rotate').addEventListener('click', () => ask({ kind: 'rotate' }));
    byId('sync-delete').addEventListener('click', () => ask({ kind: 'delete' }));
    byId('sync-off').addEventListener('click', () => {
        disableSync();
        outcome = null;
        closePairing();
        render();
    });
    pending = takeLink();
    render();
    if (pending) {
        byId('sync-confirm').scrollIntoView({ block: 'nearest' });
    }
}

startPage('sync', { withData: false, init, onLocaleChange: render });
