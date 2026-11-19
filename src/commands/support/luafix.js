/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Staff link a piece of Lua error text to an FAQ tag. When a pasted error
// contains that text, the tag's answer is posted in the error's thread.

const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Tag = require('../../database/TagSchema');
const { getOrCreateGuildConfig, invalidateGuildConfig } = require('../../utils/guildConfigCache');
const { normalize } = require('../tag');

const MATCH_MIN = 6;
const MATCH_MAX = 120;
const MAX_FIXES = 50;

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('luafix')
        .setDescription('Link Lua error text to an FAQ answer (Manage Messages)')
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(s => s.setName('add').setDescription('Post an FAQ answer when an error contains this text')
            .addStringOption(o => o.setName('match').setDescription('Text from the error, for example Bags/Core.lua:212').setRequired(true)
                .setMinLength(MATCH_MIN).setMaxLength(MATCH_MAX))
            .addStringOption(o => o.setName('name').setDescription('FAQ tag to post').setRequired(true).setAutocomplete(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Stop matching this text')
            .addStringOption(o => o.setName('match').setDescription('The match text to remove').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('Show every linked fix')),

    autocomplete: (interaction) => require('../tag').autocomplete(interaction),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const cfg = await getOrCreateGuildConfig(interaction.guild.id);
        const fixes = cfg.luaFixes || [];

        if (sub === 'list') {
            if (!fixes.length) return interaction.reply(ephemeral('No Lua fixes yet. Add one with `/luafix add`.'));
            const lines = fixes.map(f => `\`${f.match}\` → \`${f.tag}\``);
            return interaction.reply(ephemeral(lines.join('\n').slice(0, 1900)));
        }

        const match = interaction.options.getString('match').trim();

        if (sub === 'remove') {
            const before = fixes.length;
            cfg.luaFixes = fixes.filter(f => f.match.toLowerCase() !== match.toLowerCase());
            if (cfg.luaFixes.length === before) return interaction.reply(ephemeral('No fix uses that match text.'));
            await cfg.save();
            invalidateGuildConfig(interaction.guild.id);
            return interaction.reply(ephemeral(`Removed the fix for \`${match}\`.`));
        }

        // add
        if (match.length < MATCH_MIN) return interaction.reply(ephemeral(`Use at least ${MATCH_MIN} characters so it does not match every error.`));
        const tag = normalize(interaction.options.getString('name'));
        const exists = await Tag.exists({ guildId: interaction.guild.id, name: tag });
        if (!exists) return interaction.reply(ephemeral(`No FAQ tag named \`${tag}\`. Create it with \`/tag create\` first.`));
        if (fixes.some(f => f.match.toLowerCase() === match.toLowerCase())) {
            return interaction.reply(ephemeral('That match text is already linked. Remove it first to change it.'));
        }
        if (fixes.length >= MAX_FIXES) return interaction.reply(ephemeral(`You can link up to ${MAX_FIXES} fixes. Remove an old one first.`));

        cfg.luaFixes = [...fixes, { match, tag }];
        await cfg.save();
        invalidateGuildConfig(interaction.guild.id);
        return interaction.reply(ephemeral(`Errors containing \`${match}\` now get the \`${tag}\` answer.`));
    },
};
