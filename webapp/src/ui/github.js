/**
 * Records runs from the deployed site (Settings > Admin). The site is static, so it can't write the data itself: it
 * starts the record-run workflow of the repository (.github/workflows/record-run.yml: `workflow_dispatch`), which runs
 * `npm run record-run`, commits and deploys. That call needs a fine-grained personal access token of the repository
 * with the permission Actions: read and write (nothing else); it is kept in this browser's localStorage only.
 */
import { STORAGE_KEYS, readText, removeText, writeText } from './storage.js';

const REPO = 'klingo/last-asylum-plague';
const WORKFLOW = 'record-run.yml';
const API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;
// The workflow's runs on GitHub, to follow what a request did.
const RUNS_URL = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

/** The saved token, or null. */
function readToken() {
    return readText(STORAGE_KEYS.githubToken) || null;
}

function saveToken(token) {
    writeText(STORAGE_KEYS.githubToken, token);
}

function clearToken() {
    removeText(STORAGE_KEYS.githubToken);
}

/**
 * One request to the GitHub API, told as a code: 'ok', 'invalid' (the token is wrong or expired), 'noAccess' (it may
 * not do this, or can't see the repository), 'network' (not reached) or 'error' (GitHub refused for another reason).
 */
async function request(token, url, init = {}) {
    try {
        const response = await fetch(url, {
            ...init,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
        if (response.ok) {
            return 'ok';
        }
        if (response.status === 401) {
            return 'invalid';
        }
        return response.status === 403 || response.status === 404 ? 'noAccess' : 'error';
    } catch {
        return 'network';
    }
}

/** Whether `token` can see the record-run workflow: the code of `request`. */
function checkToken(token) {
    return request(token, API);
}

/**
 * Starts the record-run workflow for `ids` from `start` (YYYY-MM-DD) for `days` days: the code of `request`. The
 * workflow validates the inputs again and refuses a run that overlaps a recorded one.
 */
function dispatchRecordRun(token, { ids, start, days }) {
    return request(token, `${API}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: 'master', inputs: { ids: ids.join(' '), start, days: String(days) } }),
    });
}

export { RUNS_URL, readToken, saveToken, clearToken, checkToken, dispatchRecordRun };
