/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// The release feed must post each release once, in order, never dump history
// on first run, and never lose a release to a missing permission.

jest.mock('../src/database/BotStateSchema', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(async () => ({})),
}));
jest.mock('../src/utils/githubReleases', () => ({
    ...jest.requireActual('../src/utils/githubReleases'),
    getRecentReleases: jest.fn(),
}));
jest.mock('../src/utils/scheduler', () => ({ startPolling: jest.fn(() => 'handle') }));

const BotState = require('../src/database/BotStateSchema');
const { getRecentReleases } = require('../src/utils/githubReleases');
const { startPolling } = require('../src/utils/scheduler');
const { pickNewReleases, buildReleasePost, runReleaseFeed, startReleaseFeed } = require('../src/utils/releaseFeed');

const rel = (tag, prerelease = false) => ({ tag, name: tag, url: null, body: `notes ${tag}`, publishedAt: null, prerelease, zipUrl: null });
const ENV = { CHANGELOG_CHANNEL_ID: 'chan', RELEASE_PING_ROLE_ID: 'rel', BETA_PING_ROLE_ID: 'beta' };
const lean = value => ({ lean: async () => value });

function fakeClient({ canSend = true } = {}) {
    const channel = {
        id: 'chan',
        name: 'changelog',
        guild: { id: 'g1', members: { me: {} } },
        permissionsFor: () => ({ has: () => canSend }),
        send: jest.fn(async () => ({})),
    };
    return { client: { channels: { cache: new Map([['chan', channel]]) } }, channel };
}

beforeEach(() => jest.clearAllMocks());

describe('pickNewReleases', () => {
    const list = [rel('3'), rel('2'), rel('1')];

    test('first run with no saved tag posts nothing', () => {
        expect(pickNewReleases(list, null)).toEqual([]);
    });
    test('nothing new when the saved tag is the newest', () => {
        expect(pickNewReleases(list, '3')).toEqual([]);
    });
    test('returns every newer release, oldest first', () => {
        expect(pickNewReleases(list, '1').map(r => r.tag)).toEqual(['2', '3']);
    });
    test('saved tag outside the window posts only the newest', () => {
        expect(pickNewReleases(list, '0.9').map(r => r.tag)).toEqual(['3']);
    });
    test('does not mutate the input', () => {
        pickNewReleases(list, '1');
        expect(list.map(r => r.tag)).toEqual(['3', '2', '1']);
    });
});

describe('buildReleasePost', () => {
    const feed = { releaseRoleId: 'rel', betaRoleId: 'beta' };
    const settings = { repo: 'o/r', curseforgeUrl: 'https://cf', productName: 'KkthnxUI' };

    test('full release pings only the release role', () => {
        const p = buildReleasePost(rel('2'), feed, settings);
        expect(p.content).toBe('<@&rel>');
        expect(p.allowedMentions).toEqual({ parse: [], roles: ['rel'] });
    });
    test('prerelease pings the beta role', () => {
        expect(buildReleasePost(rel('2-beta', true), feed, settings).allowedMentions.roles).toEqual(['beta']);
    });
    test('no role set means no ping at all', () => {
        const p = buildReleasePost(rel('2'), {}, settings);
        expect(p.content).toBeUndefined();
        expect(p.allowedMentions.roles).toEqual([]);
    });
});

describe('runReleaseFeed', () => {
    test('first run records the newest tag without posting', async () => {
        const { client, channel } = fakeClient();
        getRecentReleases.mockResolvedValue([rel('3'), rel('2')]);
        BotState.findOne.mockReturnValue(lean(null));
        await runReleaseFeed(client, ENV);
        expect(channel.send).not.toHaveBeenCalled();
        expect(BotState.findOneAndUpdate).toHaveBeenCalledWith({ guildId: 'g1' }, { lastReleaseTag: '3' }, { upsert: true });
    });

    test('posts new releases in order and saves each tag', async () => {
        const { client, channel } = fakeClient();
        getRecentReleases.mockResolvedValue([rel('3'), rel('2'), rel('1')]);
        BotState.findOne.mockReturnValue(lean({ lastReleaseTag: '1' }));
        await runReleaseFeed(client, ENV);
        expect(channel.send).toHaveBeenCalledTimes(2);
        const saved = BotState.findOneAndUpdate.mock.calls.map(c => c[1].lastReleaseTag);
        expect(saved).toEqual(['2', '3']);
    });

    test('a failed send keeps the earlier tag so the rest retry next tick', async () => {
        const { client, channel } = fakeClient();
        channel.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'));
        getRecentReleases.mockResolvedValue([rel('3'), rel('2'), rel('1')]);
        BotState.findOne.mockReturnValue(lean({ lastReleaseTag: '1' }));
        await expect(runReleaseFeed(client, ENV)).rejects.toThrow('boom');
        expect(BotState.findOneAndUpdate.mock.calls.map(c => c[1].lastReleaseTag)).toEqual(['2']);
    });

    test('missing permission posts nothing and keeps the saved tag', async () => {
        const { client, channel } = fakeClient({ canSend: false });
        getRecentReleases.mockResolvedValue([rel('2'), rel('1')]);
        BotState.findOne.mockReturnValue(lean({ lastReleaseTag: '1' }));
        await runReleaseFeed(client, ENV);
        expect(channel.send).not.toHaveBeenCalled();
        expect(BotState.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('channel on another shard is a quiet no-op', async () => {
        await runReleaseFeed({ channels: { cache: new Map() } }, ENV);
        expect(getRecentReleases).not.toHaveBeenCalled();
    });
});

describe('startReleaseFeed', () => {
    test('stays off without a channel', () => {
        expect(startReleaseFeed({}, {})).toBeNull();
        expect(startPolling).not.toHaveBeenCalled();
    });
    test('starts polling when a channel is set', () => {
        expect(startReleaseFeed({}, ENV)).toBe('handle');
        expect(startPolling).toHaveBeenCalledWith(expect.objectContaining({ name: 'RELEASES', immediate: true }));
    });
});
