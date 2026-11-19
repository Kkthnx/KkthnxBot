/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Reads release data from the GitHub REST API so version answers always come
// from the published release, never from text someone typed by hand.
// Unauthenticated calls share a 60 per hour limit per IP, so results are
// cached and a GITHUB_TOKEN is used when one is set.

const logger = require('./logger');

const API = 'https://api.github.com';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 16;

// key -> { at, value }. Bounded, since keys include the repo and page size.
const cache = new Map();

function headers() {
    const h = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'KkthnxBot',
    };
    const token = (process.env.GITHUB_TOKEN || '').trim();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

/** Reduce a raw release object to the fields the bot shows. */
function summarizeRelease(raw) {
    if (!raw || typeof raw !== 'object' || !raw.tag_name) return null;
    const assets = Array.isArray(raw.assets) ? raw.assets : [];
    const zip = assets.find(a => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip'));
    return {
        tag: String(raw.tag_name),
        name: raw.name ? String(raw.name) : String(raw.tag_name),
        url: raw.html_url || null,
        body: typeof raw.body === 'string' ? raw.body : '',
        publishedAt: raw.published_at ? new Date(raw.published_at) : null,
        prerelease: Boolean(raw.prerelease),
        zipUrl: zip ? zip.browser_download_url || null : null,
    };
}

/**
 * Shorten release notes to fit an embed. Cuts at a line break when one is
 * close to the limit so a bullet is never split mid-word.
 */
function trimNotes(body, max) {
    const text = String(body || '').replace(/\r\n/g, '\n').trim();
    if (text.length <= max) return text;
    const suffix = '\n…';
    const room = Math.max(0, max - suffix.length);
    const cut = text.slice(0, room);
    const lastBreak = cut.lastIndexOf('\n');
    const end = lastBreak > room * 0.6 ? lastBreak : room;
    return cut.slice(0, end).trimEnd() + suffix;
}

async function fetchJson(path) {
    const res = await fetch(`${API}${path}`, {
        headers: headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        const err = new Error(`GitHub API ${res.status} for ${path}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    try {
        const value = await load();
        cache.delete(key);
        cache.set(key, { at: Date.now(), value });
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        return value;
    } catch (err) {
        // A stale answer beats no answer when GitHub is down or rate limited.
        if (hit) {
            logger.warn(`[GITHUB] ${err.message}, serving cached result.`);
            return hit.value;
        }
        throw err;
    }
}

/** Latest full release. GitHub's "latest" skips drafts and prereleases. */
function getLatestRelease(repo) {
    return cached(`latest:${repo}`, async () => summarizeRelease(await fetchJson(`/repos/${repo}/releases/latest`)));
}

/** Most recent published releases, newest first, prereleases included. */
function getRecentReleases(repo, count = 3) {
    const n = Math.max(1, Math.min(10, count));
    return cached(`recent:${repo}:${n}`, async () => {
        const list = await fetchJson(`/repos/${repo}/releases?per_page=${n}`);
        return (Array.isArray(list) ? list : []).filter(r => r && !r.draft).map(summarizeRelease).filter(Boolean);
    });
}

function _clearCache() {
    cache.clear();
}

module.exports = { getLatestRelease, getRecentReleases, summarizeRelease, trimNotes, _clearCache, CACHE_TTL_MS, headers, API, REQUEST_TIMEOUT_MS };
