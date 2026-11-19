/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { postWelcome, rotateShowcase, showcaseSettings } = require('../../utils/showcaseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showcase')
        .setDescription('The welcome post with the featured setup (Manage Server)')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(s => s.setName('post').setDescription('Post the welcome post in this channel'))
        .addSubcommand(s => s.setName('next').setDescription('Feature the next starred setup now')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const note = showcaseSettings().sourceChannelId ? '' : ' Set SHOWCASE_SOURCE_CHANNEL_ID to start featuring setups.';

        if (sub === 'post') {
            const message = await postWelcome(interaction.channel);
            return interaction.editReply(`Welcome post is up: ${message.url}.${note}`);
        }

        if (sub === 'next') {
            if (note) return interaction.editReply(note.trim());
            await rotateShowcase(interaction.client);
            return interaction.editReply('Rotated to the next featured setup.');
        }
    },
};
