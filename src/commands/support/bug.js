/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { openWizard, postPanel } = require('../../utils/bugReportManager');

module.exports = {
    // One report form per member per minute keeps the forum from being flooded.
    cooldown: 60,
    data: new SlashCommandBuilder()
        .setName('bug')
        .setDescription('Report a KkthnxUI bug')
        .setContexts(InteractionContextType.Guild)
        .addSubcommand(s => s.setName('report').setDescription('Open the bug report form'))
        .addSubcommand(s => s.setName('panel').setDescription('Pin the how-to post with the Report a bug button (Manage Server)')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'report') return openWizard(interaction);

        if (sub === 'panel') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'You need the Manage Server permission to post the panel.', flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const { thread, error } = await postPanel(interaction.guild);
            return interaction.editReply(error || `Posted and pinned: <#${thread.id}>`);
        }
    },
};
