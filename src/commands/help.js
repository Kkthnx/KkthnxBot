/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { BRAND, brandedEmbed, COLORS, footerFor } = require('../utils/brand');
const { chunkLines } = require('../utils/embedText');

// Admin-only commands are grouped separately so they don't clutter the
// member-facing list. Everything else is auto-discovered from the loaded
// command collection, so this never drifts out of sync with reality.
const ADMIN_COMMANDS = new Set(['settings', 'verify', 'massban', 'raidmode', 'giveaway', 'reactionrole', 'warn', 'timeout', 'kick', 'ban', 'unban', 'infractions', 'purge', 'slowmode', 'lock', 'unlock', 'botinfo', 'luafix', 'showcase']);

// Adds a group as one or more embed fields, never exceeding Discord's 1024-char
// field limit. Continuation fields use a zero-width name so it reads as one
// section. Without this, /help throws once enough commands are registered.
function addGroup(embed, name, list) {
    const lines = list.map(c => `\`/${c.data.name}\`, ${c.data.description}`);
    if (!lines.length) {
        embed.addFields({ name, value: '*None available.*' });
        return;
    }
    chunkLines(lines).forEach((value, i) => {
        embed.addFields({ name: i === 0 ? name : '​', value });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription(`Show help information for ${BRAND.bot} commands`),

    async execute(interaction) {
        const commands = [...interaction.client.commands.values()]
            .sort((a, b) => a.data.name.localeCompare(b.data.name));

        const member = commands.filter(c => !ADMIN_COMMANDS.has(c.data.name));
        const admin = commands.filter(c => ADMIN_COMMANDS.has(c.data.name));

        const embed = brandedEmbed({ color: COLORS.primary, footer: footerFor(BRAND.bot) })
            .setTitle(`${BRAND.bot}, Command Guide`)
            .setDescription('Get KkthnxUI help fast: `/install` for setup, `/faq` for common answers, `/version` for the current release, or open a ticket in create-ticket.');

        addGroup(embed, 'Members', member);
        if (admin.length) addGroup(embed, 'Staff', admin);

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
