/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const BotState = require('../database/BotStateSchema');
const GuildConfig = require('../database/GuildConfigSchema');
const Infraction = require('../database/InfractionSchema');
const Reminder = require('../database/ReminderSchema');
const Giveaway = require('../database/GiveawaySchema');
const Suggestion = require('../database/SuggestionSchema');
const Starboard = require('../database/StarboardSchema');
const TempBan = require('../database/TempBanSchema');
const Tag = require('../database/TagSchema');
const ReactionRole = require('../database/ReactionRoleSchema');
const Ticket = require('../database/TicketSchema');
const BugReport = require('../database/BugReportSchema');
const { invalidateGuildConfig } = require('../utils/guildConfigCache');
const logger = require('../utils/logger');

// When the bot is removed from a guild, purge all data stored for it. We must
// not retain user data beyond a legitimate purpose.
module.exports = {
    name: 'guildDelete',
    async execute(guild) {
        // `guild` can be partial or unavailable during an outage. Skip unless
        // this is an actual removal.
        if (guild.available === false) {
            logger.warn(`[GUILD_DELETE] Guild ${guild.id} is unavailable (outage), skipping purge.`);
            return;
        }

        // Drop the cached config first, so nothing reads the settings of a
        // guild we just purged.
        invalidateGuildConfig(guild.id);

        const filter = { guildId: guild.id };
        const models = [
            BotState, GuildConfig, Infraction, Reminder, Giveaway, Suggestion, Starboard,
            TempBan, Tag, ReactionRole, Ticket, BugReport,
        ];

        try {
            const results = await Promise.all(models.map(m => m.deleteMany(filter)));
            const total = results.reduce((sum, r) => sum + (r.deletedCount || 0), 0);
            logger.info(`[GUILD_DELETE] Purged ${total} documents across ${results.length} collections for guild ${guild.id}.`);
        } catch (err) {
            logger.error(`[GUILD_DELETE] Failed to purge data for guild ${guild.id}:`, err);
        }
    },
};
