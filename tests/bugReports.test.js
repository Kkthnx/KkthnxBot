/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// The wizard must produce complete, tagged reports, never reach GitHub without
// a reviewer, never file one report twice, and follow the issue when it closes.

jest.mock('../src/database/BugReportSchema', () => ({
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(async () => ({})),
    find: jest.fn(),
}));
jest.mock('../src/database/BotStateSchema', () => ({ findOneAndUpdate: jest.fn(async () => ({ bugSeq: 3 })) }));
jest.mock('../src/utils/auditLog', () => ({ getModLogChannel: jest.fn(async () => null) }));
jest.mock('../src/utils/moderationManager', () => ({ logModAction: jest.fn(async () => {}) }));
jest.mock('../src/utils/githubIssues', () => ({
    createIssue: jest.fn(),
    getIssueState: jest.fn(),
    hasToken: jest.fn(() => true),
}));

const { PermissionFlagsBits } = require('discord.js');
const BugReport = require('../src/database/BugReportSchema');
const gh = require('../src/utils/githubIssues');
const bug = require('../src/utils/bugReportManager');

const REPORT = {
    _id: 'r1', guildId: 'g', number: 3, reporterId: 'u1', flavor: 'retail',
    gameVersion: '12.0.7', addonVersion: '11.1.1', summary: 'Bags   do not\nopen', steps: '1. press B',
    luaError: '', screenshotUrl: null, status: 'new', threadId: 't1',
};
const lean = value => ({ lean: () => ({ catch: async () => value, then: (r) => Promise.resolve(value).then(r) }) });

beforeEach(() => {
    jest.clearAllMocks();
    bug._resetDrafts();
    gh.hasToken.mockReturnValue(true);
});

describe('pure helpers', () => {
    test('a report with neither error nor screenshot needs info', () => {
        expect(bug.initialStatus({ luaError: '', screenshotUrl: null })).toBe('needs_info');
        expect(bug.initialStatus({ luaError: 'x', screenshotUrl: null })).toBe('new');
        expect(bug.initialStatus({ luaError: '', screenshotUrl: 'https://cdn/a.png' })).toBe('new');
    });

    test('post title is one line, numbered, tagged with the flavor and capped', () => {
        expect(bug.postTitle(REPORT)).toBe('#3 [Retail] Bags do not open');
        const long = bug.postTitle({ ...REPORT, summary: 'x'.repeat(300) });
        expect(long.length).toBeLessThanOrEqual(90);
        expect(long.endsWith('…')).toBe(true);
    });

    test('tags are matched by name and missing ones are skipped', () => {
        const available = [{ id: '1', name: 'Retail' }, { id: '2', name: 'needs info' }, { id: '3', name: 'Fixed' }];
        expect(bug.pickTags(available, bug.tagNamesFor({ flavor: 'retail', status: 'needs_info' }))).toEqual(['1', '2']);
        expect(bug.pickTags(available, bug.tagNamesFor({ flavor: 'classic', status: 'fixed' }))).toEqual(['3']);
    });

    test('closed issues map to fixed only when completed', () => {
        expect(bug.statusForClosedIssue('completed')).toBe('fixed');
        expect(bug.statusForClosedIssue('not_planned')).toBe('closed');
        expect(bug.statusForClosedIssue(null)).toBe('closed');
    });

    test('issue body carries every field and fences the Lua error safely', () => {
        const issue = bug.buildIssue({ ...REPORT, luaError: 'boom ``` end' }, { postUrl: 'https://discord.com/channels/g/t1' });
        expect(issue.title).toBe('[Retail] Bags do not open');
        expect(issue.body).toContain('**KkthnxUI version:** 11.1.1');
        expect(issue.body).toContain('### Steps to reproduce');
        expect(issue.body).toContain('Reported on Discord: https://discord.com/channels/g/t1');
        expect(issue.body.match(/```/g)).toHaveLength(2);
        expect(issue.labels).toEqual(['bug']);
    });

    test('issue never links an expiring Discord file', () => {
        const issue = bug.buildIssue({ ...REPORT, screenshotUrl: 'https://cdn.discordapp.com/x.png?ex=1' });
        expect(issue.body).not.toContain('cdn.discordapp.com');
    });

    test('screenshot keeps its real extension', () => {
        expect(bug.imageExtension('https://cdn/x/shot.JPG?ex=1')).toBe('jpg');
        expect(bug.imageExtension('https://cdn/x/shot')).toBe('png');
        expect(bug.imageExtension('not a url')).toBe('png');
    });

    test('approvers are listed roles or Manage Server', () => {
        const member = (roles, manage = false) => ({
            roles: { cache: new Map(roles.map(r => [r, {}])) },
            permissions: { has: flag => manage && flag === PermissionFlagsBits.ManageGuild },
        });
        expect(bug.canApprove(member(['dev']), ['dev'])).toBe(true);
        expect(bug.canApprove(member(['helper']), ['dev'])).toBe(false);
        expect(bug.canApprove(member([], true), [])).toBe(true);
        expect(bug.canApprove(null, ['dev'])).toBe(false);
    });
});

describe('drafts', () => {
    test('a draft is taken once and expires', () => {
        bug.putDraft('u1', { a: 1 }, 0);
        expect(bug.takeDraft('u1', 1000)).toEqual({ a: 1 });
        expect(bug.takeDraft('u1', 1000)).toBeNull();
        bug.putDraft('u2', { b: 1 }, 0);
        expect(bug.takeDraft('u2', 16 * 60 * 1000)).toBeNull();
    });
});

describe('builders', () => {
    test('main form has five labelled fields within Discord limits', () => {
        const json = bug.buildMainModal().toJSON();
        expect(json.components).toHaveLength(5);
        for (const c of json.components) expect(c.label.length).toBeLessThanOrEqual(45);
        expect(json.components[0].component.options.map(o => o.value)).toEqual(['retail', 'classic']);
    });

    test('report message attaches a long Lua error as a file and pings only the reporter', () => {
        const msg = bug.buildReportMessage({ ...REPORT, luaError: 'e'.repeat(2000), status: 'new' });
        expect(msg.files[0].name).toBe('bug-3-error.txt');
        expect(msg.allowedMentions).toEqual({ users: ['u1'] });
    });

    test('needs info reports ask the reporter for the missing piece', () => {
        expect(bug.buildReportMessage({ ...REPORT, status: 'needs_info' }).content).toMatch(/Needs Info/);
    });

    test('review draft has approve and reject buttons for this report', () => {
        const json = bug.buildReviewMessage(REPORT, 'https://x').components[0].toJSON();
        expect(json.components.map(c => c.custom_id)).toEqual(['bug:approve:r1', 'bug:reject:r1']);
    });
});

function reviewInteraction({ approver = true, id = 'bug:approve:r1' } = {}) {
    return {
        customId: id,
        member: { permissions: { has: () => approver }, roles: { cache: new Map() } },
        user: { id: 'staff' },
        guild: { id: 'g', channels: { fetch: jest.fn(async () => null) } },
        reply: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        followUp: jest.fn(async () => {}),
    };
}

describe('staff review', () => {
    test('a member without approval rights cannot file', async () => {
        const i = reviewInteraction({ approver: false });
        await bug.handleReview(i, true);
        expect(i.reply.mock.calls[0][0].content).toMatch(/Only Developers and Moderators/);
        expect(gh.createIssue).not.toHaveBeenCalled();
    });

    test('nothing is filed without a token', async () => {
        gh.hasToken.mockReturnValue(false);
        const i = reviewInteraction();
        await bug.handleReview(i, true);
        expect(i.reply.mock.calls[0][0].content).toMatch(/GITHUB_TOKEN/);
        expect(BugReport.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('a draft already reviewed is not filed again', async () => {
        BugReport.findOneAndUpdate.mockReturnValue(lean(null));
        const i = reviewInteraction();
        await bug.handleReview(i, true);
        expect(i.reply.mock.calls[0][0].content).toMatch(/already reviewed/);
        expect(gh.createIssue).not.toHaveBeenCalled();
    });

    test('approve files the issue and stores its number', async () => {
        BugReport.findOneAndUpdate.mockReturnValue(lean(REPORT));
        gh.createIssue.mockResolvedValue({ number: 42, url: 'https://github.com/o/r/issues/42' });
        const i = reviewInteraction();
        await bug.handleReview(i, true);
        expect(gh.createIssue).toHaveBeenCalledTimes(1);
        expect(BugReport.updateOne).toHaveBeenCalledWith({ _id: 'r1' }, { issueNumber: 42, issueUrl: 'https://github.com/o/r/issues/42' });
        expect(i.editReply.mock.calls[0][0].content).toContain('issues/42');
    });

    test('a GitHub failure puts the draft back so it can be retried', async () => {
        BugReport.findOneAndUpdate.mockReturnValue(lean(REPORT));
        gh.createIssue.mockRejectedValue(new Error('GitHub API 401'));
        const i = reviewInteraction();
        await bug.handleReview(i, true);
        expect(BugReport.updateOne).toHaveBeenCalledWith({ _id: 'r1' }, { status: 'new', reviewedById: null });
        expect(i.followUp.mock.calls[0][0].content).toMatch(/still open/);
    });

    test('reject never calls GitHub', async () => {
        BugReport.findOneAndUpdate.mockReturnValue(lean(REPORT));
        const i = reviewInteraction({ id: 'bug:reject:r1' });
        await bug.handleReview(i, false);
        expect(gh.createIssue).not.toHaveBeenCalled();
        expect(i.editReply.mock.calls[0][0].content).toMatch(/Not filed/);
    });
});

describe('GitHub close sync', () => {
    const client = (thread) => ({
        guilds: { cache: new Map([['g', { id: 'g', channels: { fetch: jest.fn(async () => thread) } }]]) },
    });
    const filed = { ...REPORT, status: 'filed', issueNumber: 42 };
    const findReturns = list => BugReport.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => list }) }) });

    test('a completed issue marks the report fixed and tells the reporter', async () => {
        findReturns([filed]);
        gh.getIssueState.mockResolvedValue({ state: 'closed', stateReason: 'completed' });
        BugReport.findOneAndUpdate.mockReturnValue({ lean: async () => filed });
        const thread = { archived: true, setArchived: jest.fn(async () => {}), setAppliedTags: jest.fn(async () => {}), send: jest.fn(async () => {}), parent: { availableTags: [{ id: 'f', name: 'Fixed' }] } };
        await bug.syncFiledIssues(client(thread));
        expect(BugReport.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'r1', status: 'filed' }, { status: 'fixed' });
        expect(thread.setArchived).toHaveBeenCalledWith(false);
        expect(thread.setAppliedTags).toHaveBeenCalledWith(['f']);
        expect(thread.send.mock.calls[0][0].content).toMatch(/<@u1> this bug is fixed/);
    });

    test('an open issue only moves to the back of the queue', async () => {
        findReturns([filed]);
        gh.getIssueState.mockResolvedValue({ state: 'open', stateReason: null });
        await bug.syncFiledIssues(client(null));
        expect(BugReport.findOneAndUpdate).not.toHaveBeenCalled();
        expect(BugReport.updateOne.mock.calls[0][2]).toEqual({ timestamps: false });
    });

    test('does nothing without a token', async () => {
        gh.hasToken.mockReturnValue(false);
        await bug.syncFiledIssues(client(null));
        expect(BugReport.find).not.toHaveBeenCalled();
    });
});
