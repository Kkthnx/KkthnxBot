/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const Infraction = require('../database/InfractionSchema');
const Reminder = require('../database/ReminderSchema');
const Giveaway = require('../database/GiveawaySchema');
const Suggestion = require('../database/SuggestionSchema');
const Tag = require('../database/TagSchema');
const Ticket = require('../database/TicketSchema');
const BugReport = require('../database/BugReportSchema');
const { brandedEmbed, COLORS, footerFor } = require('./brand');
const logger = require('./logger');

/**
 * Gathers everything the bot stores about a user in one guild, for a
 * self-service data export.
 *
 * This has to cover every collection that keys on a user, or the export quietly
 * understates what's held. Anything added here needs a matching row in
 * PRIVACY.md and, unless there's a reason to keep it, in deleteUserData below.
 */
async function exportUserData(guildId, userId) {
    const [infractions, reminders, giveaways, suggestions, tags, tickets, bugs] = await Promise.all([
        Infraction.find({ guildId, userId }).lean(),
        Reminder.find({ guildId, userId }, { message: 1, remindAt: 1 }).lean(),
        Giveaway.find({ guildId, entries: userId }, { prize: 1, endsAt: 1, winners: 1 }).lean(),
        Suggestion.find({ guildId, authorId: userId }, { text: 1, status: 1, createdAt: 1 }).lean(),
        Tag.find({ guildId, authorId: userId }, { name: 1, uses: 1, createdAt: 1 }).lean(),
        Ticket.find({ guildId, openerId: userId }, { number: 1, type: 1, status: 1, summary: 1, version: 1, createdAt: 1 }).lean(),
        BugReport.find({ guildId, reporterId: userId }).lean(),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        guildId,
        userId,
        infractions: infractions.map(i => ({ type: i.type, reason: i.reason, at: i.createdAt })),
        reminders: reminders.map(r => ({ message: r.message, remindAt: r.remindAt })),
        giveawayEntries: giveaways.map(g => ({ prize: g.prize, endsAt: g.endsAt, won: (g.winners || []).includes(userId) })),
        suggestions: suggestions.map(s => ({ text: s.text, status: s.status, at: s.createdAt })),
        tags: tags.map(t => ({ name: t.name, uses: t.uses, at: t.createdAt })),
        tickets: tickets.map(t => ({ number: t.number, type: t.type, status: t.status, summary: t.summary, version: t.version, at: t.createdAt })),
        bugReports: bugs.map(b => ({
            number: b.number, status: b.status, flavor: b.flavor, gameVersion: b.gameVersion, addonVersion: b.addonVersion,
            summary: b.summary, steps: b.steps, luaError: b.luaError, issueUrl: b.issueUrl, at: b.createdAt,
        })),
    };
}

/**
 * Erases the user's personal data and removes them from entry lists.
 *
 * Kept on purpose, and reported back so the request stays transparent:
 *   - Moderation infractions, as server records. Erasing them on request would
 *     let anyone clear their own history.
 *   - Suggestions and bug reports, which are content they published to the
 *     server, the same way a message is. Staff can remove an individual post.
 *   - Ticket records. The transcripts are support history the staff rely on.
 */
async function deleteUserData(guildId, userId) {
    const [reminderRes, giveawayRes, infractionCount, suggestionCount, ticketCount, bugCount] = await Promise.all([
        Reminder.deleteMany({ guildId, userId }),
        Giveaway.updateMany({ guildId, entries: userId }, { $pull: { entries: userId } }),
        Infraction.countDocuments({ guildId, userId }),
        Suggestion.countDocuments({ guildId, authorId: userId }),
        Ticket.countDocuments({ guildId, openerId: userId }),
        BugReport.countDocuments({ guildId, reporterId: userId }),
    ]);

    logger.info(
        `[PRIVACY] Erased data for ${userId} in ${guildId} (kept ${infractionCount} moderation record(s), ` +
        `${suggestionCount} suggestion(s), ${ticketCount} ticket(s), ${bugCount} bug report(s)).`,
    );

    return {
        remindersDeleted: reminderRes.deletedCount,
        giveawaysUpdated: giveawayRes.modifiedCount,
        infractionsKept: infractionCount,
        suggestionsKept: suggestionCount,
        ticketsKept: ticketCount,
        bugReportsKept: bugCount,
    };
}

const CONFIRM_ID = 'forgetme:confirm';

async function handleForgetConfirm(interaction) {
    const result = await deleteUserData(interaction.guild.id, interaction.user.id);

    const lines = [`Reminders: **${result.remindersDeleted}** deleted`];
    if (result.giveawaysUpdated) lines.push(`Withdrawn from **${result.giveawaysUpdated}** giveaway(s)`);
    if (result.infractionsKept) lines.push(`**${result.infractionsKept}** moderation record(s) were kept as server records`);
    if (result.suggestionsKept) lines.push(`**${result.suggestionsKept}** suggestion(s) you posted were left up, ask staff to remove one`);
    if (result.bugReportsKept) lines.push(`**${result.bugReportsKept}** bug report(s) you filed were left up, ask staff to remove one`);
    if (result.ticketsKept) lines.push(`**${result.ticketsKept}** support ticket record(s) were kept as support history`);
    if (lines.length === 1) lines.push('Nothing was kept.');

    const embed = brandedEmbed({ color: COLORS.success, footer: footerFor('Privacy') })
        .setTitle('Your data was erased')
        .setDescription(lines.map(l => `• ${l}`).join('\n'));

    // Disable the button on the original ephemeral message.
    await interaction.update({ embeds: [embed], components: [] });
}

module.exports = { exportUserData, deleteUserData, handleForgetConfirm, CONFIRM_ID };
