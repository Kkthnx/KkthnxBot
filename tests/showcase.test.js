/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// The welcome post must rotate through starred setups in order, skip posts
// that are gone or have no image, and never break when there is nothing to show.

jest.mock('../src/database/BotStateSchema', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(async () => ({})),
    updateOne: jest.fn(async () => ({})),
}));
jest.mock('../src/database/StarboardSchema', () => ({ find: jest.fn() }));

const BotState = require('../src/database/BotStateSchema');
const Starboard = require('../src/database/StarboardSchema');
const sc = require('../src/utils/showcaseManager');

const SOURCE = '111111111111111111';
const entry = id => ({ originMessageId: id, originChannelId: SOURCE });
const imageMsg = (id, extra = {}) => ({
    id, url: `https://discord.com/channels/g/${SOURCE}/${id}`, author: { id: `a${id}` }, content: 'My  layout',
    attachments: new Map([['x', { contentType: 'image/png', name: 'ui.png', url: `https://cdn/${id}.png` }]]),
    embeds: [], ...extra,
});

function guildWith(messages, extraChannels = {}) {
    const source = { id: SOURCE, messages: { fetch: jest.fn(async id => messages[id] || Promise.reject(new Error('Unknown Message'))) } };
    return {
        id: 'g',
        channels: { cache: Object.assign(new Map([[SOURCE, source], ...Object.entries(extraChannels)]), { find: () => null }) },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHOWCASE_SOURCE_CHANNEL_ID = SOURCE;
    delete process.env.SHOWCASE_ROTATE_HOURS;
});
afterAll(() => { delete process.env.SHOWCASE_SOURCE_CHANNEL_ID; });

describe('pure helpers', () => {
    test('rotation continues after the current post and repeats it last', () => {
        const list = ['a', 'b', 'c'].map(entry);
        expect(sc.orderCandidates(list, 'b').map(e => e.originMessageId)).toEqual(['c', 'a', 'b']);
        expect(sc.orderCandidates(list, 'zzz').map(e => e.originMessageId)).toEqual(['a', 'b', 'c']);
        expect(sc.orderCandidates([entry('a')], 'a').map(e => e.originMessageId)).toEqual(['a']);
    });

    test('finds an image in attachments or embeds, ignores other files', () => {
        expect(sc.firstImage(imageMsg('1'))).toBe('https://cdn/1.png');
        expect(sc.firstImage({ attachments: new Map([['x', { name: 'log.txt', url: 'u' }]]), embeds: [{ image: { url: 'https://e/i.png' } }] })).toBe('https://e/i.png');
        expect(sc.firstImage({ attachments: new Map([['x', { name: 'log.txt', url: 'u' }]]), embeds: [] })).toBeNull();
    });

    test('rotation interval defaults to 6 hours and is capped at 24', () => {
        expect(sc.showcaseSettings({}).rotateMs).toBe(6 * 3600000);
        expect(sc.showcaseSettings({ SHOWCASE_ROTATE_HOURS: '12' }).rotateMs).toBe(12 * 3600000);
        expect(sc.showcaseSettings({ SHOWCASE_ROTATE_HOURS: '48' }).rotateMs).toBe(6 * 3600000);
        expect(sc.showcaseSettings({ SHOWCASE_ROTATE_HOURS: '0' }).rotateMs).toBe(6 * 3600000);
    });

    test('welcome post has the welcome copy, the role button, and never pings', () => {
        const post = sc.buildWelcomePost(guildWith({}), null);
        expect(post.embeds).toHaveLength(2);
        expect(post.embeds[0].toJSON().description).toMatch(/3-step install/);
        expect(post.embeds[1].toJSON().description).toMatch(/Star a screenshot/);
        expect(post.components[0].toJSON().components[0].custom_id).toBe('roles:open');
        expect(post.allowedMentions).toEqual({ parse: [] });
    });

    test('featured setup shows the image, author and a one-line snippet', () => {
        const json = sc.buildWelcomePost(guildWith({}), {
            originId: '1', authorId: 'a1', channelId: SOURCE, jumpUrl: 'https://j', imageUrl: 'https://cdn/1.png', text: 'My layout',
        }).embeds[1].toJSON();
        expect(json.image.url).toBe('https://cdn/1.png');
        expect(json.description).toContain('<@a1>');
        expect(json.description).toContain('> My layout');
    });
});

describe('pickFeature', () => {
    const findReturns = list => Starboard.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => list }) }) });

    test('skips deleted posts and posts without an image', async () => {
        findReturns(['1', '2', '3'].map(entry));
        const guild = guildWith({ 2: imageMsg('2', { attachments: new Map(), embeds: [] }), 3: imageMsg('3') });
        const f = await sc.pickFeature(guild, SOURCE, null);
        expect(f).toMatchObject({ originId: '3', authorId: 'a3', imageUrl: 'https://cdn/3.png', text: 'My layout' });
    });

    test('returns null when nothing is starred', async () => {
        findReturns([]);
        expect(await sc.pickFeature(guildWith({}), SOURCE, null)).toBeNull();
    });
});

describe('rotateShowcase', () => {
    test('edits the welcome post to the next setup and remembers it', async () => {
        Starboard.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => ['1', '2'].map(entry) }) }) });
        const welcome = { edit: jest.fn(async () => {}) };
        const welcomeChannel = { messages: { fetch: jest.fn(async () => welcome) } };
        const guild = guildWith({ 1: imageMsg('1'), 2: imageMsg('2') }, { w: welcomeChannel });
        BotState.findOne.mockReturnValue({ lean: async () => ({ showcaseChannelId: 'w', showcaseMessageId: 'm', showcaseOriginId: '1' }) });

        await sc.rotateShowcase({ guilds: { cache: new Map([['g', guild]]) } });
        expect(welcome.edit.mock.calls[0][0].embeds[1].toJSON().image.url).toBe('https://cdn/2.png');
        expect(BotState.updateOne).toHaveBeenCalledWith({ guildId: 'g' }, { showcaseOriginId: '2' });
    });

    test('a deleted welcome post clears the state instead of failing every tick', async () => {
        BotState.findOne.mockReturnValue({ lean: async () => ({ showcaseChannelId: 'w', showcaseMessageId: 'm' }) });
        const guild = guildWith({}, { w: { messages: { fetch: jest.fn(async () => { throw new Error('Unknown Message'); }) } } });
        await sc.rotateShowcase({ guilds: { cache: new Map([['g', guild]]) } });
        expect(BotState.updateOne).toHaveBeenCalledWith({ guildId: 'g' }, { showcaseChannelId: null, showcaseMessageId: null, showcaseOriginId: null });
    });

    test('does nothing without a source channel', async () => {
        delete process.env.SHOWCASE_SOURCE_CHANNEL_ID;
        await sc.rotateShowcase({ guilds: { cache: new Map([['g', guildWith({})]]) } });
        expect(BotState.findOne).not.toHaveBeenCalled();
    });
});
