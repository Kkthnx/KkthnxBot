/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { supportSettings } = require('../../utils/features');
const { getRecentReleases } = require('../../utils/githubReleases');
const { buildChangelogEmbed, buildFallbackEmbed } = require('../../utils/supportReplies');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show release notes for recent KkthnxUI versions')
        .setContexts(InteractionContextType.Guild)
        .addIntegerOption(o => o.setName('count')
            .setDescription('How many recent releases to show (default 1)')
            .setMinValue(1)
            .setMaxValue(3)),

    async execute(interaction) {
        const settings = supportSettings();
        const count = interaction.options.getInteger('count') || 1;
        await interaction.deferReply();
        try {
            const releases = await getRecentReleases(settings.repo, count);
            if (!releases.length) return interaction.editReply({ embeds: [buildFallbackEmbed(settings)] });
            return interaction.editReply({ embeds: [buildChangelogEmbed(releases, settings)] });
        } catch (err) {
            logger.warn(`[SUPPORT] Changelog lookup failed: ${err.message}`);
            return interaction.editReply({ embeds: [buildFallbackEmbed(settings)] });
        }
    },
};
