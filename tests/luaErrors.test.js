/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Long Lua errors must move into a thread without losing the text, ordinary
// chat must never be touched, and known fixes must reach the right thread.

jest.mock('../src/database/TagSchema', () => ({ find: jest.fn() }));
jest.mock('../src/utils/guildConfigCache', () => ({ getGuildConfig: jest.fn() }));

const { ChannelType } = require('discord.js');
const Tag = require('../src/database/TagSchema');
const { getGuildConfig } = require('../src/utils/guildConfigCache');
const lua = require('../src/utils/luaErrors');

const CHANNEL = '123456789012345678';
const ENV = { LUA_ERROR_CHANNEL_IDS: `${CHANNEL}, nope` };

const STACK = [
    'Message: Interface/AddOns/KkthnxUI/Modules/Inventory/Bags.lua:212: attempt to index local \'slot\' (a nil value)',
    'Time: Wed Nov 19 20:14:02 2026',
    'Count: 1',
    'Stack: Interface/AddOns/KkthnxUI/Modules/Inventory/Bags.lua:212: in function <Interface/AddOns/KkthnxUI/Modules/Inventory/Bags.lua:200>',
    '[string "=[C]"]: in function `UpdateSlot\'',
    'Interface/AddOns/KkthnxUI/Modules/Inventory/Bags.lua:340: in function `Refresh\'',
    'Locals: self = <table> {',
    '}',
    'slot = nil',
].join('\n');

const BUGSACK = '1x Details/functions/profiles.lua:88: attempt to call field \'Thing\' (a nil value)\n[string "@Details/functions/profiles.lua"]:88: in function <...>';
const BLOCKED = "AddOn 'KkthnxUI' tried to call the protected function 'CastSpellByName()'.";

beforeEach(() => {
    jest.clearAllMocks();
    getGuildConfig.mockResolvedValue({ luaFixes: [] });
    Tag.find.mockReturnValue({ lean: async () => [] });
});

describe('parseLuaError', () => {
    test('reads a full error with stack', () => {
        const p = lua.parseLuaError(STACK);
        expect(p).toMatchObject({ addon: 'KkthnxUI', file: 'Bags.lua', line: 212 });
        expect(p.message).toMatch(/attempt to index local 'slot'/);
        expect(lua.isLong(p)).toBe(true);
    });

    test('reads an error-catcher line without the Interface prefix', () => {
        expect(lua.parseLuaError(BUGSACK)).toMatchObject({ addon: 'Details', file: 'profiles.lua', line: 88 });
    });

    test('reads a protected call block', () => {
        expect(lua.parseLuaError(BLOCKED)).toMatchObject({ addon: 'KkthnxUI', file: null });
    });

    test('ignores code fences around the paste', () => {
        expect(lua.parseLuaError('```lua\n' + STACK + '\n```').text.startsWith('Message:')).toBe(true);
    });

    test('leaves ordinary chat alone, even with a file path in it', () => {
        expect(lua.parseLuaError('hey, my bags are broken after the update')).toBeNull();
        expect(lua.parseLuaError('Should I delete Interface/AddOns/KkthnxUI/Core.lua:12: or not?')).toBeNull();
        expect(lua.parseLuaError('')).toBeNull();
    });
});

describe('helpers', () => {
    test('thread name names the addon and spot, capped at 100', () => {
        expect(lua.threadName(lua.parseLuaError(STACK))).toBe('Lua error, KkthnxUI Bags.lua:212');
        expect(lua.threadName({ addon: 'x'.repeat(200), file: 'a.lua', line: 1 }).length).toBe(100);
    });

    test('preview keeps three short lines and cannot break the fence', () => {
        const p = lua.previewLines({ text: 'a\n' + 'b'.repeat(500) + '\nc```\nd' });
        expect(p.split('\n')).toHaveLength(3);
        expect(p.split('\n')[1].length).toBe(160);
        expect(p).not.toContain('```');
    });

    test('errors from other addons are flagged', () => {
        expect(lua.isOtherAddon({ addon: 'Details' })).toBe(true);
        expect(lua.isOtherAddon({ addon: 'KkthnxUI' })).toBe(false);
        expect(lua.isOtherAddon({ addon: 'KkthnxUI_Config' })).toBe(false);
    });

    test('fixes match case-insensitively and cap at three', () => {
        const fixes = ['bags.lua:212', 'nomatch', 'SLOT', 'nil value', 'Bags'].map((m, i) => ({ match: m, tag: `t${i}` }));
        expect(lua.matchFixes(fixes, STACK).map(f => f.tag)).toEqual(['t0', 't2', 't3']);
    });

    test('channel list keeps real ids only', () => {
        expect(lua.luaChannelIds(ENV)).toEqual([CHANNEL]);
    });

    test('thread body inlines a short error and files a long one, never over 2000', () => {
        const short = lua.buildThreadBody(lua.parseLuaError(STACK), 'u1', []);
        expect(short[0].content).toContain('```lua');
        expect(short[0].files).toBeUndefined();
        const big = lua.buildThreadBody({ ...lua.parseLuaError(STACK), text: STACK + '\n' + 'x'.repeat(5000) }, 'u1', [{ name: 'fix', content: 'y'.repeat(3000) }]);
        expect(big[0].files[0].name).toBe('lua-error.txt');
        for (const msg of big) expect(msg.content.length).toBeLessThanOrEqual(2000);
        expect(big[1].allowedMentions).toEqual({ parse: [] });
    });

    test('moved messages are remembered briefly', () => {
        lua.markMoved('m1', 0);
        expect(lua.wasMovedByBot('m1', 1000)).toBe(true);
        expect(lua.wasMovedByBot('m1', 61 * 1000)).toBe(false);
    });
});

function fakeMessage(content, { channelId = CHANNEL, deletable = true } = {}) {
    const thread = { send: jest.fn(async () => ({})) };
    const anchor = { startThread: jest.fn(async () => thread) };
    return {
        thread, anchor,
        message: {
            id: 'm9', content, channelId,
            guild: { id: 'g' },
            author: { id: 'u1', tag: 'user' },
            channel: { name: 'help-retail', type: ChannelType.GuildText, send: jest.fn(async () => anchor) },
            startThread: jest.fn(async () => thread),
            delete: jest.fn(async () => { if (!deletable) throw new Error('Missing Permissions'); }),
        },
    };
}

describe('handleLuaErrorMessage', () => {
    test('moves a long error into a thread and removes the paste', async () => {
        const { message, anchor, thread } = fakeMessage(STACK);
        expect(await lua.handleLuaErrorMessage(message, ENV)).toBe(true);
        const preview = message.channel.send.mock.calls[0][0];
        expect(preview.content).toContain('**KkthnxUI**');
        expect(preview.allowedMentions).toEqual({ parse: [] });
        expect(anchor.startThread.mock.calls[0][0].name).toBe('Lua error, KkthnxUI Bags.lua:212');
        expect(thread.send.mock.calls[0][0].content).toContain('attempt to index local');
        expect(message.delete).toHaveBeenCalled();
        expect(lua.wasMovedByBot('m9')).toBe(true);
    });

    test('keeps going when the paste cannot be removed', async () => {
        const { message, thread } = fakeMessage(STACK, { deletable: false });
        expect(await lua.handleLuaErrorMessage(message, ENV)).toBe(true);
        expect(thread.send).toHaveBeenCalled();
    });

    test('a short error with no known fix is left alone', async () => {
        const { message } = fakeMessage(BUGSACK);
        expect(await lua.handleLuaErrorMessage(message, ENV)).toBe(false);
        expect(message.channel.send).not.toHaveBeenCalled();
        expect(message.startThread).not.toHaveBeenCalled();
    });

    test('a short error with a known fix gets a thread on the original message', async () => {
        getGuildConfig.mockResolvedValue({ luaFixes: [{ match: 'profiles.lua:88', tag: 'details-fix' }] });
        Tag.find.mockReturnValue({ lean: async () => [{ name: 'details-fix', content: 'Update Details.' }] });
        const { message, thread } = fakeMessage(BUGSACK);
        expect(await lua.handleLuaErrorMessage(message, ENV)).toBe(true);
        expect(message.delete).not.toHaveBeenCalled();
        expect(message.startThread).toHaveBeenCalled();
        expect(thread.send.mock.calls[0][0].content).toMatch(/comes from \*\*Details\*\*/);
        expect(thread.send.mock.calls[1][0].content).toContain('Update Details.');
    });

    test('channels outside the list are ignored', async () => {
        const { message } = fakeMessage(STACK, { channelId: '999999999999999999' });
        expect(await lua.handleLuaErrorMessage(message, ENV)).toBe(false);
        expect(getGuildConfig).not.toHaveBeenCalled();
    });

    test('ordinary chat in a support channel is ignored', async () => {
        const { message } = fakeMessage('how do I move the minimap?');
        expect(await lua.handleLuaErrorMessage(message, ENV)).toBe(false);
        expect(getGuildConfig).not.toHaveBeenCalled();
    });
});
