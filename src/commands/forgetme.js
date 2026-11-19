/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { exportUserData, CONFIRM_ID } = require('../utils/privacyManager');
const { BRAND, brandedEmbed, COLORS, footerFor } = require('../utils/brand');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forgetme')
        .setDescription(`Export or delete the data ${BRAND.bot} stores about you`)
        .setContexts(InteractionContextType.Guild)
        .addSubcommand(sub => sub.setName('export').setDescription('Download a copy of your stored data'))
        .addSubcommand(sub => sub.setName('delete').setDescription('Erase your reminders and giveaway entries')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'export') {
            const data = await exportUserData(interaction.guild.id, interaction.user.id);
            const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), { name: `${BRAND.bot.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-data.json` });
            return interaction.reply({
                content: `📄 Here's everything ${BRAND.bot} stores about you in this server.`,
                files: [file],
                flags: MessageFlags.Ephemeral,
            });
        }

        // delete, require an explicit confirmation click.
        const embed = brandedEmbed({ color: COLORS.danger, footer: footerFor('Privacy') })
            .setTitle('⚠️ Erase your data?')
            .setDescription(
                'This permanently deletes any **reminders** you have pending and withdraws you from any open giveaway.\n\n' +
                'Some records are kept: **moderation records** as server records, **suggestions** and **bug reports** you posted, which are published like a message, ' +
                'and **support ticket** records, which are support history. Staff can remove an individual post.\n\nThis cannot be undone.'
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel('Yes, erase my data').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        );
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    },
};
