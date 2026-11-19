/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder } = require('discord.js');
const Infraction = require('../database/InfractionSchema');
const Ticket = require('../database/TicketSchema');
const BugReport = require('../database/BugReportSchema');
const { brandedEmbed, COLORS, footerFor } = require('../utils/brand');
const { humanizeDuration } = require('../utils/duration');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Support activity and bot health'),

    // Cooldown: five counts per run.
    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply();
        const guildId = interaction.guild.id;

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [openTickets, closedThisWeek, bugsToReview, bugsFiled, infractions] = await Promise.all([
            Ticket.countDocuments({ guildId, status: 'open' }),
            Ticket.countDocuments({ guildId, status: 'closed', closedAt: { $gte: weekAgo } }),
            BugReport.countDocuments({ guildId, status: { $in: ['new', 'needs_info'] } }),
            BugReport.countDocuments({ guildId, status: 'filed' }),
            Infraction.countDocuments({ guildId }),
        ]);
        const ping = Math.max(0, Math.round(interaction.client.ws.ping));
        const uptime = humanizeDuration(process.uptime() * 1000);

        // Memory and cache sizes for this shard. Worth surfacing because the
        // member cache is the one discord.js never sweeps on its own: if memory
        // ever does climb over a long uptime, this is where it shows up, and
        // comparing it against uptime turns "is it leaking?" into something you
        // can actually check rather than guess at.
        const mem = process.memoryUsage();
        const mb = bytes => `${Math.round(bytes / 1024 / 1024)}MB`;
        const cache = interaction.client;
        const cachedMembers = [...cache.guilds.cache.values()]
            .reduce((sum, g) => sum + g.members.cache.size, 0);
        const cachedMessages = [...cache.channels.cache.values()]
            .reduce((sum, c) => sum + (c.messages?.cache.size ?? 0), 0);

        const shardLabel = interaction.client.shard ? `, shard ${interaction.client.shard.ids[0]}` : '';
        const embed = brandedEmbed({ color: COLORS.primary, footer: footerFor(`Stats${shardLabel}`) })
            .setAuthor({ name: `${interaction.guild.name}, Server Stats`, iconURL: interaction.guild.iconURL() || undefined })
            .addFields(
                { name: '👥 Members', value: `${interaction.guild.memberCount.toLocaleString()}`, inline: true },
                { name: '🎫 Open tickets', value: `${openTickets}`, inline: true },
                { name: '✅ Closed this week', value: `${closedThisWeek}`, inline: true },
                { name: '🐞 Bugs to review', value: `${bugsToReview}`, inline: true },
                { name: '📌 Bugs on GitHub', value: `${bugsFiled}`, inline: true },
                { name: '🛡️ Infractions', value: `${infractions}`, inline: true },
                { name: '🤖 Bot Health', value: `Latency \`${ping}ms\`, Uptime \`${uptime}\``, inline: false },
                {
                    name: '🧠 Memory',
                    value: `Heap \`${mb(mem.heapUsed)}\` / \`${mb(mem.heapTotal)}\`, RSS \`${mb(mem.rss)}\``,
                    inline: true,
                },
                {
                    name: '📇 Caches',
                    value: `${cachedMembers.toLocaleString()} members, ${cache.users.cache.size.toLocaleString()} users, ${cachedMessages.toLocaleString()} messages`,
                    inline: true,
                },
            );

        return interaction.editReply({ embeds: [embed] });
    },
};
