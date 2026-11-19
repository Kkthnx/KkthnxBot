/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Creates and reads GitHub issues for approved bug reports. Writing needs a
// GITHUB_TOKEN with issue write access on the KkthnxUI repo. Nothing here runs
// without a staff member pressing Approve first.

const { headers, API, REQUEST_TIMEOUT_MS } = require('./githubReleases');

function hasToken(env = process.env) {
    return Boolean((env.GITHUB_TOKEN || '').trim());
}

async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { ...headers(), 'Content-Type': 'application/json' } : headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        const err = new Error(`GitHub API ${res.status} for ${method} ${path}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

/** @returns {Promise<{ number: number, url: string }>} */
async function createIssue(repo, { title, body, labels = [] }) {
    const issue = await request(`/repos/${repo}/issues`, { method: 'POST', body: { title, body, labels } });
    return { number: issue.number, url: issue.html_url };
}

/** @returns {Promise<{ state: string, stateReason: string | null }>} */
async function getIssueState(repo, number) {
    const issue = await request(`/repos/${repo}/issues/${Number(number)}`);
    return { state: issue.state, stateReason: issue.state_reason || null };
}

module.exports = { hasToken, createIssue, getIssueState };
