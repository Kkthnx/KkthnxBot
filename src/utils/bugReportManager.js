/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 *
 * Bug report wizard.
 *
 *   1. A member presses Report a bug (pinned post in bug-reports) or runs /bug report.
 *   2. A form asks for flavor, game version, KkthnxUI version, what happened and steps.
 *   3. A second, optional form takes the Lua error and a screenshot. Without
 *      either, the report is tagged Needs Info.
 *   4. The bot opens a tagged forum post with the details as its first message.
 *   5. A GitHub issue draft goes to the staff review channel. Nothing reaches
 *      GitHub until a Developer or Moderator presses Approve.
 *   6. A poller watches filed issues. When one closes, the post is retagged
 *      Fixed or Closed and the reporter is told in the post.
 */

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, FileUploadBuilder, ChannelType, MessageFlags,
    PermissionFlagsBits, AttachmentBuilder,
} = require('discord.js');
const BugReport = require('../database/BugReportSchema');
const BotState = require('../database/BotStateSchema');
const { brandedEmbed, COLORS, footerFor } = require('./brand');
const { supportSettings } = require('./features');
const { getModLogChannel } = require('./auditLog');
const { logModAction } = require('./moderationManager');
const { createIssue, getIssueState, hasToken } = require('./githubIssues');
const { startPolling } = require('./scheduler');
const { isSnowflake } = require('./snowflake');
const logger = require('./logger');

const ID = {
    prefix: 'bug:',
    start: 'bug:start',
    mainModal: 'bug:modal:main',
    extraModal: 'bug:modal:extra',
    addExtra: 'bug:extra',
    submit: 'bug:submit',
    approve: 'bug:approve:', // + report id
    reject: 'bug:reject:',   // + report id
};
const FIELD = {
    flavor: 'bug_flavor', game: 'bug_game', addon: 'bug_addon', summary: 'bug_summary',
    steps: 'bug_steps', lua: 'bug_lua', shot: 'bug_shot',
};
const FLAVORS = { retail: 'Retail', classic: 'Classic' };

const LIMIT = { version: 40, summary: 1000, steps: 1000, lua: 4000 };
const TITLE_MAX = 90;
const DRAFT_TTL_MS = 15 * 60 * 1000;
const MAX_DRAFTS = 500;
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const SYNC_BATCH = 40;
// Long errors go up as a file so the post stays readable.
const INLINE_LUA_MAX = 900;

// ---------------------------------------------------------------------------
// Settings and pure helpers
// ---------------------------------------------------------------------------

function bugSettings(env = process.env) {
    const ids = s => String(s || '').split(',').map(x => x.trim()).filter(isSnowflake);
    return {
        forumId: (env.BUG_FORUM_CHANNEL_ID || '').trim(),
        reviewChannelId: (env.BUG_REVIEW_CHANNEL_ID || '').trim(),
        approverRoleIds: ids(env.BUG_APPROVER_ROLE_IDS),
    };
}

/** Developers and Moderators approve. Manage Server always can. */
function canApprove(member, approverRoleIds) {
    if (!member) return false;
    if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
    const roles = member.roles?.cache;
    return Boolean(roles && approverRoleIds.some(id => roles.has(id)));
}

/** A report with neither error text nor a screenshot needs more info. */
function initialStatus(report) {
    return report.luaError || report.screenshotUrl ? 'new' : 'needs_info';
}

function postTitle(report) {
    const oneLine = report.summary.replace(/\s+/g, ' ').trim();
    const head = `#${report.number} [${FLAVORS[report.flavor]}] `;
    const room = TITLE_MAX - head.length;
    return head + (oneLine.length > room ? `${oneLine.slice(0, room - 1).trimEnd()}…` : oneLine);
}

/** Forum tag ids by name, case-insensitive. Missing tags are skipped. */
function pickTags(availableTags, names) {
    const byName = new Map((availableTags || []).map(t => [String(t.name).toLowerCase(), t.id]));
    return names.map(n => byName.get(n.toLowerCase())).filter(Boolean).slice(0, 5);
}

const STATUS_TAG = { new: 'New', needs_info: 'Needs Info', filed: 'Filed', fixed: 'Fixed', closed: 'Closed', rejected: 'Closed' };

function tagNamesFor(report) {
    return [FLAVORS[report.flavor], STATUS_TAG[report.status]].filter(Boolean);
}

/** Extension from an image URL, so a JPEG is not re-uploaded as .png. */
function imageExtension(url) {
    try {
        const ext = /\.([a-z0-9]{3,4})$/i.exec(new URL(url).pathname);
        return ext && ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext[1].toLowerCase()) ? ext[1].toLowerCase() : 'png';
    } catch {
        return 'png';
    }
}

function fence(text) {
    // A stray ``` in the error would end the code block early.
    return '```\n' + String(text).replace(/```/g, '``​`') + '\n```';
}

/** The GitHub issue, in the same shape as the forum post. */
function buildIssue(report, { postUrl } = {}) {
    const lines = [
        `**Flavor:** ${FLAVORS[report.flavor]}`,
        `**Game version:** ${report.gameVersion || 'not given'}`,
        `**KkthnxUI version:** ${report.addonVersion || 'not given'}`,
        '',
        '### What happened',
        report.summary,
        '',
        '### Steps to reproduce',
        report.steps || 'Not given.',
    ];
    if (report.luaError) lines.push('', '### Lua error', fence(report.luaError));
    // Discord file links expire, so the issue points at the post instead.
    if (report.screenshotUrl) lines.push('', 'A screenshot is attached to the Discord post.');
    if (postUrl) lines.push('', `Reported on Discord: ${postUrl}`);
    return {
        title: `[${FLAVORS[report.flavor]}] ${report.summary.replace(/\s+/g, ' ').trim().slice(0, 120)}`,
        body: lines.join('\n'),
        labels: ['bug'],
    };
}

/** Maps a closed GitHub issue to the report status. */
function statusForClosedIssue(stateReason) {
    return stateReason === 'completed' ? 'fixed' : 'closed';
}

// ---------------------------------------------------------------------------
// Drafts between the two forms, kept in memory for a short while
// ---------------------------------------------------------------------------

const drafts = new Map(); // userId -> { draft, expires }

function putDraft(userId, draft, now = Date.now()) {
    for (const [id, d] of drafts) if (d.expires <= now) drafts.delete(id);
    drafts.delete(userId);
    drafts.set(userId, { draft, expires: now + DRAFT_TTL_MS });
    while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
}

function takeDraft(userId, now = Date.now()) {
    const d = drafts.get(userId);
    drafts.delete(userId);
    return d && d.expires > now ? d.draft : null;
}

// ---------------------------------------------------------------------------
// Discord builders
// ---------------------------------------------------------------------------

function textLabel(label, input) {
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function buildMainModal() {
    const flavor = new StringSelectMenuBuilder()
        .setCustomId(FIELD.flavor)
        .setPlaceholder('Pick one')
        .addOptions(Object.entries(FLAVORS).map(([value, label]) => new StringSelectMenuOptionBuilder().setLabel(label).setValue(value)));

    return new ModalBuilder()
        .setCustomId(ID.mainModal)
        .setTitle('Report a bug')
        .addLabelComponents(
            new LabelBuilder().setLabel('Game flavor').setStringSelectMenuComponent(flavor),
            textLabel('Game version', new TextInputBuilder().setCustomId(FIELD.game)
                .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(LIMIT.version).setPlaceholder('For example 12.0.7')),
            textLabel('KkthnxUI version', new TextInputBuilder().setCustomId(FIELD.addon)
                .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(LIMIT.version).setPlaceholder('Shown on the login screen or in /version')),
            textLabel('What happened?', new TextInputBuilder().setCustomId(FIELD.summary)
                .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(LIMIT.summary)),
            textLabel('Steps to make it happen', new TextInputBuilder().setCustomId(FIELD.steps)
                .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(LIMIT.steps).setPlaceholder('1. Log in\n2. Open bags\n3. ...')),
        );
}

function buildExtraModal() {
    return new ModalBuilder()
        .setCustomId(ID.extraModal)
        .setTitle('Error and screenshot')
        .addLabelComponents(
            textLabel('Lua error text', new TextInputBuilder().setCustomId(FIELD.lua)
                .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(LIMIT.lua)
                .setPlaceholder('Paste the whole error, including the stack')),
            new LabelBuilder().setLabel('Screenshot').setDescription('One image, optional')
                .setFileUploadComponent(new FileUploadBuilder().setCustomId(FIELD.shot).setRequired(false).setMaxValues(1)),
        );
}

function buildPanelPost() {
    const embed = brandedEmbed({ color: COLORS.danger, footer: footerFor('Bug reports') })
        .setTitle('How to report a bug')
        .setDescription([
            'Press **Report a bug**. A short form asks for your game flavor, versions, what happened and the steps.',
            'Then add the Lua error and a screenshot if you have them. Reports without either get the Needs Info tag.',
            '',
            'Staff review every report before it goes to GitHub. You get a reply in your post when it is fixed.',
        ].join('\n'));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.start).setLabel('Report a bug').setStyle(ButtonStyle.Danger),
    );
    return { embeds: [embed], components: [row] };
}

function buildReportMessage(report) {
    const embed = brandedEmbed({ color: COLORS.danger, footer: footerFor(`Bug #${report.number}`) })
        .setTitle(`Bug #${report.number}`)
        .addFields(
            { name: 'Flavor', value: FLAVORS[report.flavor], inline: true },
            { name: 'Game version', value: report.gameVersion || 'Not given', inline: true },
            { name: 'KkthnxUI version', value: report.addonVersion || 'Not given', inline: true },
            { name: 'What happened', value: report.summary.slice(0, 1024) },
            { name: 'Steps to reproduce', value: (report.steps || 'Not given').slice(0, 1024) },
        );

    const files = [];
    if (report.luaError) {
        if (report.luaError.length <= INLINE_LUA_MAX) {
            embed.addFields({ name: 'Lua error', value: fence(report.luaError) });
        } else {
            files.push(new AttachmentBuilder(Buffer.from(report.luaError, 'utf8'), { name: `bug-${report.number}-error.txt` }));
            embed.addFields({ name: 'Lua error', value: 'Attached as a file.' });
        }
    }
    if (report.screenshotUrl) {
        const name = `bug-${report.number}-screenshot.${imageExtension(report.screenshotUrl)}`;
        files.push({ attachment: report.screenshotUrl, name });
        embed.setImage(`attachment://${name}`);
    }

    const content = report.status === 'needs_info'
        ? `Reported by <@${report.reporterId}>. Tagged **Needs Info**: please reply with the Lua error or a screenshot if you can get one.`
        : `Reported by <@${report.reporterId}>. Staff will review it.`;
    return { content, embeds: [embed], files, allowedMentions: { users: [report.reporterId] } };
}

function buildReviewMessage(report, threadUrl) {
    const issue = buildIssue(report, { postUrl: threadUrl });
    const embed = brandedEmbed({ color: COLORS.hype, footer: footerFor('Bug review') })
        .setTitle(`GitHub draft for bug #${report.number}`)
        .setURL(threadUrl || null)
        .setDescription(`**${issue.title}**\n\n${issue.body}`.slice(0, 4000));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.approve + report._id).setLabel('Approve and file on GitHub').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ID.reject + report._id).setLabel('Do not file').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

function forumChannel(guild) {
    const { forumId } = bugSettings();
    const forum = forumId && guild.channels.cache.get(forumId);
    return forum && forum.type === ChannelType.GuildForum ? forum : null;
}

async function openWizard(interaction) {
    if (!forumChannel(interaction.guild)) {
        return interaction.reply(ephemeral('Bug reports are not set up yet. Please open a ticket instead.'));
    }
    return interaction.showModal(buildMainModal());
}

async function handleMainModal(interaction) {
    const f = interaction.fields;
    const flavor = f.getStringSelectValues(FIELD.flavor)[0];
    if (!FLAVORS[flavor]) return interaction.reply(ephemeral('Pick Retail or Classic and try again.'));

    putDraft(interaction.user.id, {
        flavor,
        gameVersion: f.getTextInputValue(FIELD.game).trim().slice(0, LIMIT.version),
        addonVersion: f.getTextInputValue(FIELD.addon).trim().slice(0, LIMIT.version),
        summary: f.getTextInputValue(FIELD.summary).trim().slice(0, LIMIT.summary),
        steps: f.getTextInputValue(FIELD.steps).trim().slice(0, LIMIT.steps),
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.addExtra).setLabel('Add error and screenshot').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ID.submit).setLabel('Submit without them').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
        content: 'Almost done. Do you have the Lua error text or a screenshot? Reports without either are tagged Needs Info.',
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

async function nextBugNumber(guildId) {
    const state = await BotState.findOneAndUpdate(
        { guildId }, { $inc: { bugSeq: 1 } }, { upsert: true, returnDocument: 'after' },
    );
    return state.bugSeq;
}

/** Turns a finished draft into the forum post and the staff review draft. */
async function fileReport(interaction, draft) {
    const { guild, user } = interaction;
    const forum = forumChannel(guild);
    if (!forum) return interaction.editReply({ content: 'Bug reports are not set up yet. Please open a ticket instead.', components: [] });

    const report = new BugReport({ ...draft, guildId: guild.id, reporterId: user.id, number: await nextBugNumber(guild.id) });
    report.status = initialStatus(report);

    let thread;
    try {
        thread = await forum.threads.create({
            name: postTitle(report),
            message: buildReportMessage(report),
            appliedTags: pickTags(forum.availableTags, tagNamesFor(report)),
            reason: `Bug #${report.number} from ${user.tag}`,
        });
    } catch (err) {
        logger.warn(`[BUG] Forum post for #${report.number} failed: ${err.message}`);
        return interaction.editReply({ content: 'Could not create the bug post. Please open a ticket instead and tell staff.', components: [] });
    }
    report.threadId = thread.id;
    await report.save();

    const threadUrl = `https://discord.com/channels/${guild.id}/${thread.id}`;
    const review = await reviewChannel(guild);
    if (review) {
        try {
            const msg = await review.send(buildReviewMessage(report, threadUrl));
            report.draftChannelId = review.id;
            report.draftMessageId = msg.id;
            await report.save();
        } catch (err) {
            logger.warn(`[BUG] Review draft for #${report.number} failed: ${err.message}`);
        }
    } else {
        logger.warn(`[BUG] No review channel, bug #${report.number} has no GitHub draft.`);
    }

    await logModAction({
        guild, moderator: user, title: `Bug #${report.number} reported`,
        fields: [
            { name: 'Flavor', value: FLAVORS[report.flavor], inline: true },
            { name: 'Post', value: `<#${thread.id}>`, inline: true },
        ],
    });
    logger.info(`[BUG] #${report.number} filed by ${user.id} as ${report.status}.`);
    return interaction.editReply({ content: `Thanks, your report is up: <#${thread.id}>`, components: [] });
}

async function reviewChannel(guild) {
    const { reviewChannelId } = bugSettings();
    const ch = reviewChannelId && guild.channels.cache.get(reviewChannelId);
    if (ch && ch.isTextBased?.()) return ch;
    return getModLogChannel(guild);
}

async function handleSubmitButton(interaction) {
    const draft = takeDraft(interaction.user.id);
    if (!draft) return interaction.update({ content: 'That form expired. Press Report a bug to start again.', components: [] });
    await interaction.update({ content: 'Posting your report…', components: [] });
    return fileReport(interaction, draft);
}

async function handleAddExtraButton(interaction) {
    const d = drafts.get(interaction.user.id);
    if (!d || d.expires <= Date.now()) {
        return interaction.update({ content: 'That form expired. Press Report a bug to start again.', components: [] });
    }
    return interaction.showModal(buildExtraModal());
}

async function handleExtraModal(interaction) {
    const draft = takeDraft(interaction.user.id);
    if (!draft) return interaction.reply(ephemeral('That form expired. Press Report a bug to start again.'));
    draft.luaError = interaction.fields.getTextInputValue(FIELD.lua).trim().slice(0, LIMIT.lua);
    const files = interaction.fields.getUploadedFiles(FIELD.shot);
    const shot = files && files.first();
    if (shot && String(shot.contentType || '').startsWith('image/')) draft.screenshotUrl = shot.url;

    // The modal came from the ephemeral prompt, so update that message.
    if (interaction.isFromMessage?.()) await interaction.update({ content: 'Posting your report…', components: [] });
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return fileReport(interaction, draft);
}

// ---------------------------------------------------------------------------
// Staff review
// ---------------------------------------------------------------------------

async function setThreadState(guild, report, note) {
    const thread = report.threadId && await guild.channels.fetch(report.threadId).catch(() => null);
    if (!thread) return;
    try {
        if (thread.archived) await thread.setArchived(false);
        const forum = thread.parent;
        if (forum && forum.availableTags) await thread.setAppliedTags(pickTags(forum.availableTags, tagNamesFor(report)));
        if (note) await thread.send({ content: note, allowedMentions: { users: [report.reporterId] } });
    } catch (err) {
        logger.warn(`[BUG] Could not update post for #${report.number}: ${err.message}`);
    }
}

async function handleReview(interaction, approve) {
    const prefix = approve ? ID.approve : ID.reject;
    const reportId = interaction.customId.slice(prefix.length);
    const { approverRoleIds } = bugSettings();
    if (!canApprove(interaction.member, approverRoleIds)) {
        return interaction.reply(ephemeral('Only Developers and Moderators can review bug drafts.'));
    }
    if (approve && !hasToken()) {
        return interaction.reply(ephemeral('GITHUB_TOKEN is not set, so the bot cannot file issues.'));
    }

    // Claim the report so two reviewers cannot both act on it.
    const claimed = await BugReport.findOneAndUpdate(
        { _id: reportId, status: { $in: ['new', 'needs_info'] } },
        { status: approve ? 'filed' : 'rejected', reviewedById: interaction.user.id },
        { returnDocument: 'before' },
    ).lean().catch(() => null);
    if (!claimed) return interaction.reply(ephemeral('This draft was already reviewed.'));

    await interaction.deferUpdate();
    const { guild, user } = interaction;
    const report = { ...claimed, status: approve ? 'filed' : 'rejected' };
    const threadUrl = report.threadId ? `https://discord.com/channels/${guild.id}/${report.threadId}` : null;

    if (approve) {
        let issue;
        try {
            issue = await createIssue(supportSettings().repo, buildIssue(report, { postUrl: threadUrl }));
        } catch (err) {
            logger.error(`[BUG] GitHub issue for #${report.number} failed:`, err);
            await BugReport.updateOne({ _id: reportId }, { status: claimed.status, reviewedById: null });
            return interaction.followUp(ephemeral(`Filing on GitHub failed (${err.message}). The draft is still open.`));
        }
        await BugReport.updateOne({ _id: reportId }, { issueNumber: issue.number, issueUrl: issue.url });
        await setThreadState(guild, report, `Filed on GitHub as ${issue.url}. You will get a reply here when it is closed.`);
        await interaction.editReply({ content: `Approved by <@${user.id}>, filed as ${issue.url}`, components: [], allowedMentions: { parse: [] } });
    } else {
        await setThreadState(guild, report, null);
        await interaction.editReply({ content: `Not filed, reviewed by <@${user.id}>.`, components: [], allowedMentions: { parse: [] } });
    }

    await logModAction({
        guild, moderator: user, title: `Bug #${report.number} ${approve ? 'filed on GitHub' : 'not filed'}`,
        fields: [{ name: 'Post', value: report.threadId ? `<#${report.threadId}>` : 'unknown', inline: true }],
    });
}

// ---------------------------------------------------------------------------
// GitHub close sync
// ---------------------------------------------------------------------------

async function syncFiledIssues(client) {
    if (!hasToken()) return;
    const repo = supportSettings().repo;
    const guildIds = [...client.guilds.cache.keys()];
    const open = await BugReport.find({ guildId: { $in: guildIds }, status: 'filed', issueNumber: { $ne: null } })
        .sort({ updatedAt: 1 }).limit(SYNC_BATCH).lean();

    for (const report of open) {
        let state;
        try {
            state = await getIssueState(repo, report.issueNumber);
        } catch (err) {
            logger.warn(`[BUG] Issue #${report.issueNumber} check failed: ${err.message}`);
            continue;
        }
        if (state.state !== 'closed') {
            // Move it to the back of the queue so the batch walks every open report.
            await BugReport.updateOne({ _id: report._id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
            continue;
        }
        const status = statusForClosedIssue(state.stateReason);
        const done = await BugReport.findOneAndUpdate({ _id: report._id, status: 'filed' }, { status }).lean();
        if (!done) continue;
        const guild = client.guilds.cache.get(report.guildId);
        const note = status === 'fixed'
            ? `<@${report.reporterId}> this bug is fixed in the code. It ships with the next KkthnxUI release.`
            : `<@${report.reporterId}> the GitHub issue for this report was closed without a fix. Staff may add a note here.`;
        if (guild) await setThreadState(guild, { ...report, status }, note);
        logger.info(`[BUG] #${report.number} marked ${status} from GitHub.`);
    }
}

function startIssueSync(client) {
    if (!hasToken()) {
        logger.info('[BUG] GITHUB_TOKEN not set, GitHub issue sync is off.');
        return null;
    }
    return startPolling({
        name: 'BUG_SYNC', task: () => syncFiledIssues(client), intervalMs: SYNC_INTERVAL_MS, immediate: true, delayMs: 60 * 1000,
    });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function handleBugButton(interaction) {
    const id = interaction.customId;
    if (id === ID.start) return openWizard(interaction);
    if (id === ID.addExtra) return handleAddExtraButton(interaction);
    if (id === ID.submit) return handleSubmitButton(interaction);
    if (id.startsWith(ID.approve)) return handleReview(interaction, true);
    if (id.startsWith(ID.reject)) return handleReview(interaction, false);
}

async function handleBugModal(interaction) {
    if (interaction.customId === ID.mainModal) return handleMainModal(interaction);
    if (interaction.customId === ID.extraModal) return handleExtraModal(interaction);
}

/** Pins the how-to post with the Report a bug button in the forum. */
async function postPanel(guild) {
    const forum = forumChannel(guild);
    if (!forum) return { error: 'Set BUG_FORUM_CHANNEL_ID to the bug-reports forum channel first.' };
    const thread = await forum.threads.create({ name: 'How to report a bug', message: buildPanelPost() });
    await thread.pin().catch(err => logger.warn(`[BUG] Could not pin the panel post: ${err.message}`));
    return { thread };
}

function _resetDrafts() {
    drafts.clear();
}

module.exports = {
    ID, FIELD, FLAVORS,
    bugSettings, canApprove, initialStatus, postTitle, pickTags, tagNamesFor, buildIssue, statusForClosedIssue,
    putDraft, takeDraft, _resetDrafts,
    buildMainModal, buildExtraModal, buildPanelPost, buildReportMessage, buildReviewMessage, imageExtension,
    openWizard, handleBugButton, handleBugModal, handleReview, syncFiledIssues, startIssueSync, postPanel,
};
