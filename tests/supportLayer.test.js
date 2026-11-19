/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Version answers must come from GitHub with a cache that survives an outage,
// and command names must stay unique.

const fs = require('fs');
const path = require('path');
const { supportSettings } = require('../src/utils/features');
const {
    getLatestRelease, getRecentReleases, summarizeRelease, trimNotes, _clearCache, CACHE_TTL_MS,
} = require('../src/utils/githubReleases');
const { buildReleaseEmbed, buildChangelogEmbed, buildFallbackEmbed } = require('../src/utils/supportReplies');

const RAW = {
    tag_name: '11.1.1',
    name: '11.1.1',
    html_url: 'https://github.com/Kkthnx-Wow/KkthnxUI/releases/tag/11.1.1',
    body: '- Fixed a thing\n- Added a thing',
    published_at: '2026-10-18T02:36:51Z',
    prerelease: false,
    draft: false,
    assets: [
        { name: 'release.json', browser_download_url: 'https://x/release.json' },
        { name: 'KkthnxUI-11.1.1.zip', browser_download_url: 'https://x/KkthnxUI-11.1.1.zip' },
    ],
};
const ok = body => ({ ok: true, status: 200, json: async () => body });

describe('commands and settings', () => {
    test('settings fall back to the KkthnxUI defaults', () => {
        expect(supportSettings({}).repo).toBe('Kkthnx-Wow/KkthnxUI');
        expect(supportSettings({ SUPPORT_GITHUB_REPO: ' a/b ' }).repo).toBe('a/b');
    });

    test('command names are unique and /version is the release command', () => {
        const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
        const cmds = walk(path.join(__dirname, '../src/commands')).map(f => require(f)).filter(c => c.data && c.execute);
        const names = cmds.map(c => c.data.name);
        expect(new Set(names).size).toBe(names.length);
        const version = cmds.find(c => c.data.name === 'version');
        expect(version.data.description).toMatch(/KkthnxUI release/);
    });
});

describe('release parsing', () => {
    test('summarizeRelease picks the zip asset, not release.json', () => {
        const r = summarizeRelease(RAW);
        expect(r.tag).toBe('11.1.1');
        expect(r.zipUrl).toBe('https://x/KkthnxUI-11.1.1.zip');
        expect(r.publishedAt.toISOString()).toBe('2026-10-18T02:36:51.000Z');
    });

    test('summarizeRelease rejects junk', () => {
        expect(summarizeRelease(null)).toBeNull();
        expect(summarizeRelease({ message: 'Not Found' })).toBeNull();
    });

    test('trimNotes keeps short text and cuts long text at a line break', () => {
        expect(trimNotes('a\r\nb', 100)).toBe('a\nb');
        const long = Array.from({ length: 50 }, (_, i) => `- line number ${i}`).join('\n');
        const cut = trimNotes(long, 200);
        expect(cut.length).toBeLessThanOrEqual(200);
        expect(cut.endsWith('\n…')).toBe(true);
        expect(cut.split('\n').slice(0, -1).every(l => /^- line number \d+$/.test(l))).toBe(true);
    });
});

describe('release fetching', () => {
    let originalFetch;
    beforeEach(() => {
        originalFetch = global.fetch;
        _clearCache();
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    });
    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
        delete process.env.GITHUB_TOKEN;
    });

    test('latest release is cached between calls', async () => {
        global.fetch = jest.fn(async () => ok(RAW));
        await getLatestRelease('o/r');
        await getLatestRelease('o/r');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(String(global.fetch.mock.calls[0][0])).toBe('https://api.github.com/repos/o/r/releases/latest');
    });

    test('sends the token only when one is set', async () => {
        global.fetch = jest.fn(async () => ok(RAW));
        await getLatestRelease('o/r');
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
        _clearCache();
        process.env.GITHUB_TOKEN = 'abc';
        await getLatestRelease('o/r');
        expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer abc');
    });

    test('serves the stale result when GitHub fails after expiry', async () => {
        global.fetch = jest.fn(async () => ok(RAW));
        await getLatestRelease('o/r');
        jest.advanceTimersByTime(CACHE_TTL_MS + 1);
        global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
        const r = await getLatestRelease('o/r');
        expect(r.tag).toBe('11.1.1');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('throws when GitHub fails with nothing cached', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
        await expect(getLatestRelease('o/r')).rejects.toThrow('404');
    });

    test('recent releases drop drafts and clamp the count', async () => {
        global.fetch = jest.fn(async () => ok([RAW, { ...RAW, tag_name: 'draft', draft: true }]));
        const list = await getRecentReleases('o/r', 50);
        expect(list.map(r => r.tag)).toEqual(['11.1.1']);
        expect(String(global.fetch.mock.calls[0][0])).toContain('per_page=10');
    });
});

describe('support embeds', () => {
    const settings = { repo: 'o/r', curseforgeUrl: 'https://cf', productName: 'KkthnxUI' };

    test('release embed names the version and links all sources', () => {
        const json = buildReleaseEmbed(summarizeRelease(RAW), settings).toJSON();
        expect(json.title).toBe('KkthnxUI 11.1.1');
        expect(json.description).toContain('https://cf');
        expect(json.description).toContain('https://github.com/o/r/releases');
        expect(json.description).toContain('KkthnxUI-11.1.1.zip');
        expect(json.footer.text).toBe('KkthnxUI');
    });

    test('fallback embed still carries the links', () => {
        expect(buildFallbackEmbed(settings).toJSON().description).toContain('https://cf');
    });

    test('changelog fits embed limits with long notes', () => {
        const big = { ...summarizeRelease(RAW), body: 'x\n'.repeat(5000) };
        const one = buildChangelogEmbed([big], settings).toJSON();
        expect(one.description.length).toBeLessThanOrEqual(4096);
        const three = buildChangelogEmbed([big, big, big], settings).toJSON();
        const total = three.fields.reduce((n, f) => n + f.name.length + f.value.length, three.title.length);
        expect(total).toBeLessThanOrEqual(6000);
        three.fields.forEach(f => expect(f.value.length).toBeLessThanOrEqual(1024));
    });
});
