/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */


const { PermissionFlagsBits } = require('discord.js');
const { missingPermissions, sendWithFallback, isMissingPermissions } = require('../src/utils/channelAccess');

function channelWith(granted, extra = {}) {
    return {
        id: 'c1',
        name: 'announcements',
        guild: { members: { me: {} } },
        permissionsFor: () => ({ has: flag => granted.some(name => PermissionFlagsBits[name] === flag) }),
        ...extra,
    };
}

const denied = () => Object.assign(new Error('Missing Permissions'), { code: 50013 });

describe('missingPermissions', () => {
    test('lists what the bot lacks', () => {
        const ch = channelWith(['ViewChannel', 'EmbedLinks']);
        expect(missingPermissions(ch, 'file')).toEqual(['SendMessages', 'AttachFiles']);
    });

    test('is empty when everything is granted', () => {
        const ch = channelWith(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles']);
        expect(missingPermissions(ch, 'file')).toEqual([]);
    });

    test('is empty for a channel it cannot check', () => {
        expect(missingPermissions({}, 'file')).toEqual([]);
        expect(missingPermissions(null, 'file')).toEqual([]);
    });
});

describe('sendWithFallback', () => {
    test('retries without files when the attachment is refused', async () => {
        const send = jest.fn().mockRejectedValueOnce(denied()).mockResolvedValueOnce({ id: 'm' });
        await sendWithFallback({ send }, { embeds: [1], files: ['f'] });
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][0]).toEqual({ embeds: [1] });
    });

    test('rethrows when there was nothing to strip', async () => {
        const send = jest.fn().mockRejectedValue(denied());
        await expect(sendWithFallback({ send }, { embeds: [1], files: [] })).rejects.toThrow('Missing Permissions');
        expect(send).toHaveBeenCalledTimes(1);
    });

    test('rethrows other errors untouched', async () => {
        const boom = new Error('boom');
        const send = jest.fn().mockRejectedValue(boom);
        await expect(sendWithFallback({ send }, { files: ['f'] })).rejects.toBe(boom);
        expect(isMissingPermissions(boom)).toBe(false);
    });
});

