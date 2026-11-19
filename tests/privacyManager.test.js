/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// These tests exist to keep the code and PRIVACY.md from drifting apart. An
// export that understates what's held, or a deletion that quietly leaves
// something behind, is the kind of bug you only find when somebody asks.

const MODELS = {
    InfractionSchema: 'Infraction',
    ReminderSchema: 'Reminder',
    GiveawaySchema: 'Giveaway',
    SuggestionSchema: 'Suggestion',
    TagSchema: 'Tag',
    TicketSchema: 'Ticket',
    BugReportSchema: 'BugReport',
};

// One shared record of every call, so a test can assert which collections were
// touched and how.
const calls = [];

function fakeModel(name) {
    const query = value => ({ lean: () => Promise.resolve(value) });
    return {
        find: jest.fn((filter, projection) => { calls.push({ name, op: 'find', filter, projection }); return query([]); }),
        findOne: jest.fn((filter, projection) => { calls.push({ name, op: 'findOne', filter, projection }); return query(null); }),
        deleteOne: jest.fn(filter => { calls.push({ name, op: 'deleteOne', filter }); return Promise.resolve({ deletedCount: 1 }); }),
        deleteMany: jest.fn(filter => { calls.push({ name, op: 'deleteMany', filter }); return Promise.resolve({ deletedCount: 2 }); }),
        updateMany: jest.fn((filter, update) => { calls.push({ name, op: 'updateMany', filter, update }); return Promise.resolve({ modifiedCount: 1 }); }),
        countDocuments: jest.fn(filter => { calls.push({ name, op: 'countDocuments', filter }); return Promise.resolve(3); }),
    };
}

for (const [file, name] of Object.entries(MODELS)) {
    jest.doMock(`../src/database/${file}`, () => fakeModel(name));
}

const { exportUserData, deleteUserData } = require('../src/utils/privacyManager');

const GUILD = 'g1';
const USER = 'u1';

function touched(name, op) {
    return calls.filter(c => c.name === name && c.op === op);
}

beforeEach(() => { calls.length = 0; });

describe('exportUserData', () => {
    beforeEach(async () => { await exportUserData(GUILD, USER); });

    test('reads every collection that keys on a person', () => {
        // If a new user-keyed collection is added, this is the list to extend,
        // along with the PRIVACY.md table.
        for (const name of Object.values(MODELS)) {
            expect(calls.some(c => c.name === name)).toBe(true);
        }
    });

    test('scopes every read to the one guild', () => {
        for (const call of calls) {
            expect(call.filter.guildId).toBe(GUILD);
        }
    });

    test('returns the documented shape even when the user has nothing stored', async () => {
        const out = await exportUserData(GUILD, USER);
        expect(out).toMatchObject({
            guildId: GUILD,
            userId: USER,
            infractions: [],
            reminders: [],
            giveawayEntries: [],
            suggestions: [],
            tags: [],
            tickets: [],
            bugReports: [],
        });
        expect(typeof out.exportedAt).toBe('string');
    });
});

describe('deleteUserData', () => {
    let result;
    beforeEach(async () => { result = await deleteUserData(GUILD, USER); });

    test('deletes reminders outright', () => {
        expect(touched('Reminder', 'deleteMany')).toHaveLength(1);
    });

    test('withdraws them from open giveaway entries', () => {
        const [giveaway] = touched('Giveaway', 'updateMany');
        expect(giveaway.update.$pull).toEqual({ entries: USER });
    });

    test('keeps moderation records, and only counts them', () => {
        // Deliberate: if a member could erase their own history the record would
        // be worthless. PRIVACY.md documents this.
        expect(touched('Infraction', 'countDocuments')).toHaveLength(1);
        expect(touched('Infraction', 'deleteOne')).toHaveLength(0);
        expect(touched('Infraction', 'deleteMany')).toHaveLength(0);
        expect(result.infractionsKept).toBe(3);
    });

    test('keeps published suggestions, bug reports and ticket records, and only counts them', () => {
        for (const name of ['Suggestion', 'BugReport', 'Ticket']) {
            expect(touched(name, 'countDocuments')).toHaveLength(1);
            expect(touched(name, 'deleteMany')).toHaveLength(0);
        }
        expect(result).toMatchObject({ suggestionsKept: 3, bugReportsKept: 3, ticketsKept: 3 });
    });

    test('reports what it did so the confirmation can be specific', () => {
        expect(result).toMatchObject({ remindersDeleted: 2, giveawaysUpdated: 1 });
    });

    test('never touches another guild', () => {
        for (const call of calls) {
            expect(call.filter.guildId).toBe(GUILD);
        }
    });
});
