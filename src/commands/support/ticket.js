/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPanel, closeTicket } = require('../../utils/ticketManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Support tickets')
        .setContexts(InteractionContextType.Guild)
        .addSubcommand(s => s.setName('panel').setDescription('Post the ticket panel in this channel (Manage Server)'))
        .addSubcommand(s => s.setName('close').setDescription('Close the ticket in this channel and save a transcript')
            .addStringOption(o => o.setName('reason').setDescription('Why it is being closed').setMaxLength(500))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'panel') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'You need the Manage Server permission to post the panel.', flags: MessageFlags.Ephemeral });
            }
            await interaction.channel.send(buildPanel());
            return interaction.reply({ content: 'Ticket panel posted.', flags: MessageFlags.Ephemeral });
        }

        if (sub === 'close') {
            return closeTicket(interaction, interaction.options.getString('reason'));
        }
    },
};
