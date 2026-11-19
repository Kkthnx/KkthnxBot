/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { ActivityType } = require('discord.js');
const { getGuildConfig } = require('../utils/guildConfigCache');
const logger = require('../utils/logger');

const STATUS = 'Helping with KkthnxUI, try /faq';

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        logger.info(`Logged in as ${client.user.tag}`);
        logger.info(`Serving ${client.guilds.cache.size} guild(s)`);

        // Capture and log the commit this process booted on (primes /botinfo).
        const v = require('../utils/version').getVersionInfo();
        logger.info(`Build: ${v.commit ? `commit ${v.commit} (${v.branch})` : `v${v.version}`}${v.subject ? `, ${v.subject}` : ''}`);

        // Forward error logs to a Discord channel if ERROR_CHANNEL_ID is set.
        require('../utils/errorAlerts').attachErrorAlerts(client);

        // Keep slash commands in sync automatically (guild commands are instant).
        // Runs once, on shard 0.
        if (process.env.AUTO_DEPLOY !== 'false' && (!client.shard || client.shard.ids.includes(0))) {
            await require('../utils/registerCommands').registerGuildCommands(client);
        }

        try {
            client.user.setPresence({
                activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: STATUS }],
                status: 'online',
            });
        } catch (err) {
            logger.warn(`[STATUS] Failed to set presence: ${err.message}`);
        }

        // Schedulers. Each one handles its own errors.
        require('../utils/giveawayManager').startGiveawayScheduler(client);
        require('../utils/reminderManager').startReminderScheduler(client);
        require('../utils/tempBanManager').startTempBanScheduler(client);
        require('../utils/releaseFeed').startReleaseFeed(client);
        require('../utils/bugReportManager').startIssueSync(client);
        require('../utils/showcaseManager').startShowcaseRotation(client);

        // Warm the reaction-role menu cache so reactions skip the DB.
        require('../utils/reactionRoleManager').loadMenuCache()
            .catch(err => logger.error('[REACTIONROLE] Cache load failed:', err));

        // Flag channels the bot cannot post in, so a denied Send Messages shows
        // up in the log as a cause rather than as scattered 50013s.
        require('../utils/channelAccess').auditChannelAccess(client, getGuildConfig)
            .catch(err => logger.error('[ACCESS] Audit failed:', err));

        if (client.guilds.cache.size === 0) logger.warn('No guilds found in cache.');
    },
};
