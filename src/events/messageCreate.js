/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const config = require('../../config.json');
const { evaluateContentFilter, enforceContentFilter, runAntiSpam } = require('../utils/autoMod');
const { getGuildConfig } = require('../utils/guildConfigCache');
const { handleLuaErrorMessage } = require('../utils/luaErrors');
const logger = require('../utils/logger');

const AS = config.moderation?.antiSpam || {};

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        // Ignore bot messages and DMs.
        if (message.author.bot || !message.guild) return;

        const guildConfig = await getGuildConfig(message.guild.id) || {};

        // Word filter first, then anti-spam. Anything caught stops here.
        const violation = evaluateContentFilter(message, guildConfig);
        if (violation) {
            await enforceContentFilter(message, violation, guildConfig);
            return;
        }

        if (guildConfig.antiSpamEnabled !== false && AS.enabled !== false) {
            try {
                if (await runAntiSpam(message, guildConfig)) return;
            } catch (err) {
                logger.error('Anti-spam check failed:', err);
            }
        }

        // Long Lua error pastes move into a thread with any known fix.
        try {
            await handleLuaErrorMessage(message);
        } catch (err) {
            logger.error('Lua error handling failed:', err);
        }
    },
};
