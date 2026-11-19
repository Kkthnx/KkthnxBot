/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { supportSettings } = require('../../utils/features');
const { getLatestRelease } = require('../../utils/githubReleases');
const { buildReleaseEmbed, buildFallbackEmbed } = require('../../utils/supportReplies');
const logger = require('../../utils/logger');

/** Shared by /version and /download, which answer the same question. */
async function replyWithLatest(interaction) {
    const settings = supportSettings();
    await interaction.deferReply();
    try {
        const release = await getLatestRelease(settings.repo);
        const embed = release ? buildReleaseEmbed(release, settings) : buildFallbackEmbed(settings);
        return interaction.editReply({ embeds: [embed] });
    } catch (err) {
        logger.warn(`[SUPPORT] Latest release lookup failed: ${err.message}`);
        return interaction.editReply({ embeds: [buildFallbackEmbed(settings)] });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('version')
        .setDescription('Show the current KkthnxUI release and where to get it')
        .setContexts(InteractionContextType.Guild),
    execute: replyWithLatest,
    replyWithLatest,
};
