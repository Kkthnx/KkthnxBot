/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Tickets must stay private, never open twice for one member, and never lose
// the conversation when closing goes wrong.

jest.mock('../src/database/TicketSchema', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(async () => ({})),
    create: jest.fn(),
    deleteOne: jest.fn(async () => ({})),
}));
jest.mock('../src/database/BotStateSchema', () => ({ findOneAndUpdate: jest.fn(async () => ({ ticketSeq: 7 })) }));
jest.mock('../src/utils/auditLog', () => ({ getModLogChannel: jest.fn(async () => null) }));
jest.mock('../src/utils/moderationManager', () => ({ logModAction: jest.fn(async () => {}) }));

const { PermissionFlagsBits } = require('discord.js');
const Ticket = require('../src/database/TicketSchema');
const { getModLogChannel } = require('../src/utils/auditLog');
const tm = require('../src/utils/ticketManager');

const lean = value => ({ lean: async () => value });
const OPEN = { _id: 'x', guildId: 'g', number: 7, openerId: 'u1', type: 'bug', status: 'open', channelId: 'c1', summary: 's' };

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TICKET_TRANSCRIPT_CHANNEL_ID;
});

describe('pure helpers', () => {
    test('channel names follow the lowercase hyphen rule', () => {
        expect(tm.channelNameFor('bug', 7)).toBe('bug-0007');
        expect(tm.channelNameFor('question', 12345)).toBe('question-12345');
    });

    test('settings keep only real role ids', () => {
        const s = tm.ticketSettings({ TICKET_STAFF_ROLE_IDS: '123456789012345678, nope ,234567890123456789' });
        expect(s.staffRoleIds).toEqual(['123456789012345678', '234567890123456789']);
    });

    test('overwrites hide the channel from everyone and skip deleted roles', () => {
        const ow = tm.buildOverwrites({
            everyoneId: 'g', openerId: 'u1', botId: 'bot', staffRoleIds: ['r1', 'gone'], existingRoleIds: new Set(['r1']),
        });
        expect(ow.find(o => o.id === 'g').deny).toContain(PermissionFlagsBits.ViewChannel);
        expect(ow.find(o => o.id === 'u1').allow).toContain(PermissionFlagsBits.ViewChannel);
        expect(ow.find(o => o.id === 'bot').allow).toContain(PermissionFlagsBits.ManageChannels);
        expect(ow.some(o => o.id === 'r1')).toBe(true);
        expect(ow.some(o => o.id === 'gone')).toBe(false);
        expect(ow.find(o => o.id === 'u1').allow).not.toContain(PermissionFlagsBits.ManageMessages);
    });

    test('staff is a staff role or Manage Messages', () => {
        const member = (roles, manage = false) => ({ roles: { cache: new Map(roles.map(r => [r, {}])) }, permissions: { has: () => manage } });
        expect(tm.isStaff(member(['r1']), ['r1'])).toBe(true);
        expect(tm.isStaff(member([]), ['r1'])).toBe(false);
        expect(tm.isStaff(member([], true), [])).toBe(true);
        expect(tm.isStaff(null, ['r1'])).toBe(false);
    });

    test('transcript is oldest first and keeps embeds and files', () => {
        const msgs = [
            { createdTimestamp: 2000, author: { tag: 'helper', id: 'h' }, content: 'try a reinstall', embeds: [], attachments: new Map() },
            { createdTimestamp: 1000, author: { tag: 'bot', id: 'b' }, content: '', embeds: [{ title: 'Ticket #7, Bug', description: 'broken bags' }], attachments: new Map() },
            { createdTimestamp: 3000, author: { tag: 'user', id: 'u1' }, content: 'ok', embeds: [], attachments: new Map([['a', { name: 'err.png', url: 'https://cdn/err.png' }]]) },
        ];
        const text = tm.formatTranscript({ ...OPEN, createdAt: new Date(0) }, msgs, 'KkthnxUI');
        const body = text.split('\n').slice(4).join('\n');
        expect(text.startsWith('Ticket #7 (Bug) in KkthnxUI')).toBe(true);
        expect(body.indexOf('broken bags')).toBeLessThan(body.indexOf('try a reinstall'));
        expect(body).toContain('[file] err.png https://cdn/err.png');
    });
});

describe('builders', () => {
    test('panel has one button per type and they route to open', () => {
        const json = tm.buildPanel().components[0].toJSON();
        expect(json.components.map(c => c.custom_id)).toEqual(['ticket:open:bug', 'ticket:open:install', 'ticket:open:profile', 'ticket:open:question']);
    });

    test('modal labels fit Discord limits', () => {
        for (const type of Object.keys(tm.TYPES)) {
            const json = tm.buildModal(type).toJSON();
            for (const row of json.components) {
                const input = row.components[0];
                expect(input.label.length).toBeLessThanOrEqual(45);
                expect((input.placeholder || '').length).toBeLessThanOrEqual(100);
            }
        }
    });

    test('opening message pings only the opener', () => {
        expect(tm.buildOpening(OPEN).allowedMentions).toEqual({ users: ['u1'] });
    });
});

function closeInteraction({ userId = 'u1', staff = false } = {}) {
    const channel = {
        id: 'c1',
        messages: { fetch: jest.fn(async () => Object.assign(new Map(), { last: () => null })) },
        delete: jest.fn(async () => {}),
    };
    return {
        channelId: 'c1',
        channel,
        guild: { id: 'g', name: 'KkthnxUI', channels: { cache: new Map() } },
        user: { id: userId, tag: userId },
        member: { permissions: { has: () => staff }, roles: { cache: new Map() } },
        reply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
    };
}

describe('closeTicket', () => {
    test('a stranger cannot close someone else\'s ticket', async () => {
        Ticket.findOne.mockReturnValue(lean(OPEN));
        const i = closeInteraction({ userId: 'u2' });
        await tm.closeTicket(i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Only the member/);
        expect(Ticket.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('a second close while one is running is refused', async () => {
        Ticket.findOne.mockReturnValue(lean(OPEN));
        Ticket.findOneAndUpdate.mockReturnValue(lean(null));
        const i = closeInteraction();
        await tm.closeTicket(i);
        expect(i.reply.mock.calls[0][0].content).toMatch(/already closing/);
    });

    test('no transcript destination reopens the ticket and keeps the channel', async () => {
        Ticket.findOne.mockReturnValue(lean(OPEN));
        Ticket.findOneAndUpdate.mockReturnValue(lean({ ...OPEN, status: 'closed' }));
        getModLogChannel.mockResolvedValue(null);
        const i = closeInteraction();
        await tm.closeTicket(i);
        expect(Ticket.updateOne).toHaveBeenCalledWith({ _id: 'x' }, expect.objectContaining({ status: 'open' }));
        expect(i.channel.delete).not.toHaveBeenCalled();
    });

    test('a failed transcript post reopens the ticket', async () => {
        Ticket.findOne.mockReturnValue(lean(OPEN));
        Ticket.findOneAndUpdate.mockReturnValue(lean({ ...OPEN, status: 'closed' }));
        getModLogChannel.mockResolvedValue({ send: jest.fn(async () => { throw new Error('50013'); }) });
        const i = closeInteraction({ userId: 'staff', staff: true });
        await tm.closeTicket(i);
        expect(Ticket.updateOne).toHaveBeenCalledWith({ _id: 'x' }, expect.objectContaining({ status: 'open' }));
        expect(i.followUp.mock.calls[0][0]).toMatch(/could not be saved/);
    });

    test('a saved transcript deletes the channel after the delay', async () => {
        jest.useFakeTimers();
        const send = jest.fn(async () => {});
        Ticket.findOne.mockReturnValue(lean(OPEN));
        Ticket.findOneAndUpdate.mockReturnValue(lean({ ...OPEN, status: 'closed' }));
        getModLogChannel.mockResolvedValue({ send });
        const i = closeInteraction();
        await tm.closeTicket(i, 'solved');
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].files[0].name).toBe('ticket-0007.txt');
        expect(i.channel.delete).not.toHaveBeenCalled();
        jest.runAllTimers();
        expect(i.channel.delete).toHaveBeenCalled();
        jest.useRealTimers();
    });
});

describe('opening', () => {
    test('a member with a live ticket is pointed at it instead of a new form', async () => {
        Ticket.findOne.mockReturnValue(lean(OPEN));
        const i = {
            customId: 'ticket:open:bug',
            user: { id: 'u1' },
            guild: { id: 'g', channels: { cache: new Map([['c1', {}]]) } },
            reply: jest.fn(async () => {}),
            showModal: jest.fn(),
        };
        await tm.handleTicketButton(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(i.reply.mock.calls[0][0].content).toContain('<#c1>');
    });

    test('a ticket whose channel vanished is closed and a new form opens', async () => {
        Ticket.findOne.mockReturnValue(lean(OPEN));
        const i = {
            customId: 'ticket:open:bug',
            user: { id: 'u1' },
            guild: { id: 'g', channels: { cache: new Map() } },
            reply: jest.fn(async () => {}),
            showModal: jest.fn(async () => {}),
        };
        await tm.handleTicketButton(i);
        expect(Ticket.updateOne).toHaveBeenCalledWith({ _id: 'x', status: 'open' }, expect.objectContaining({ status: 'closed' }));
        expect(i.showModal).toHaveBeenCalled();
    });

    test('an unknown ticket type does nothing', async () => {
        const i = { customId: 'ticket:open:nope', reply: jest.fn(async () => {}), showModal: jest.fn() };
        await tm.handleTicketButton(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(Ticket.findOne).not.toHaveBeenCalled();
    });
});
