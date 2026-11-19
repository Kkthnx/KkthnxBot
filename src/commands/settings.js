/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getOrCreateGuildConfig, invalidateGuildConfig } = require('../utils/guildConfigCache');
const { isSnowflake } = require('../utils/snowflake');
const { BRAND } = require('../utils/brand');

// Ranges for the numeric settings, so a typo can't store a value the code
// that reads it was never meant to handle.
const NUMERIC_BOUNDS = {
    starboardThreshold: { min: 1, max: 100 },
    minAccountAgeDays: { min: 0, max: 365 },
    newAccountHoldMinutes: { min: 0, max: 1440 },
    strikeWarnThreshold: { min: 0, max: 10 },
    strikeWindowDays: { min: 1, max: 365 },
    strikeTimeoutMinutes: { min: 1, max: 40320 },
};

// strikeAction isn't numeric, so it's validated separately in the set handler.
const STRIKE_ACTIONS = ['timeout', 'kick', 'ban'];

const BOOLEAN_KEYS = ['antiSpamEnabled', 'contentFilterEnabled', 'auditLogEnabled', 'autoModStrikes'];

// Every key the set subcommand accepts. The option uses autocomplete against
// this list, since Discord caps a fixed choice list at 25.
const SETTABLE_KEYS = [
    'antiSpamEnabled', 'contentFilterEnabled', 'auditLogEnabled',
    'announcementsChannelId', 'modLogChannelId',
    'starboardChannelId', 'starboardThreshold', 'starboardEmoji', 'suggestionChannelId',
    'minAccountAgeDays', 'newAccountHoldMinutes', 'cjkExemptChannelIds',
    'strikeWarnThreshold', 'strikeWindowDays', 'strikeAction',
    'strikeTimeoutMinutes', 'autoModStrikes',
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription(`View or update ${BRAND.bot} settings for this server`)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current server configuration'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Update a server setting')
                .addStringOption(option =>
                    option.setName('key')
                        .setDescription('The setting name to update (start typing to see options)')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('The new value for the setting')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        const config = await getOrCreateGuildConfig(guildId);

        if (subcommand === 'view') {
            const fields = [
                `announcementsChannelId: ${config.announcementsChannelId || 'not set'}`,
                `modLogChannelId: ${config.modLogChannelId || 'not set'}`,
                `starboardChannelId: ${config.starboardChannelId || 'not set'} (threshold ${config.starboardThreshold}, ${config.starboardEmoji})`,
                `suggestionChannelId: ${config.suggestionChannelId || 'not set'}`,
                `verifyRoleId: ${config.verifyRoleId || 'off'} (manage with /verify)`,
                `antiSpamEnabled: ${config.antiSpamEnabled}`,
                `contentFilterEnabled: ${config.contentFilterEnabled}`,
                `auditLogEnabled: ${config.auditLogEnabled}`,
                `selfRoles: ${config.selfRoles?.length || 0} configured (manage with /roles)`,
                `minAccountAgeDays: ${config.minAccountAgeDays} (0 = off)`,
                `newAccountHoldMinutes: ${config.newAccountHoldMinutes} (0 = flag only)`,
                `cjkExemptChannelIds: ${config.cjkExemptChannelIds?.join(', ') || 'none'}`,
                `strikeWarnThreshold: ${config.strikeWarnThreshold} (0 = off)`,
                `strikeWindowDays: ${config.strikeWindowDays}`,
                `strikeAction: ${config.strikeAction}`,
                `strikeTimeoutMinutes: ${config.strikeTimeoutMinutes}`,
                `autoModStrikes: ${config.autoModStrikes} (auto-mod warns count toward strikes)`,
            ];
            return interaction.reply({ content: fields.join('\n'), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'set') {
            const key = interaction.options.getString('key');
            const value = interaction.options.getString('value');

            if (!SETTABLE_KEYS.includes(key)) {
                return interaction.reply({ content: `Unknown setting. Valid keys: ${SETTABLE_KEYS.join(', ')}`, flags: MessageFlags.Ephemeral });
            }

            if (NUMERIC_BOUNDS[key]) {
                const { min, max } = NUMERIC_BOUNDS[key];
                const n = Number(value);
                // Number('') and Number(' ') are 0, so isNaN alone would let an
                // empty value through as zero.
                if (value.trim() === '' || !Number.isInteger(n)) {
                    return interaction.reply({ content: `\`${key}\` must be a whole number.`, flags: MessageFlags.Ephemeral });
                }
                if (n < min || n > max) {
                    return interaction.reply({ content: `\`${key}\` must be between ${min} and ${max}.`, flags: MessageFlags.Ephemeral });
                }
                config[key] = n;
            } else if (BOOLEAN_KEYS.includes(key)) {
                if (!['true', 'false'].includes(value.toLowerCase())) {
                    return interaction.reply({ content: 'That value must be true or false.', flags: MessageFlags.Ephemeral });
                }
                config[key] = value.toLowerCase() === 'true';
            } else if (key === 'cjkExemptChannelIds') {
                // Comma-separated channel IDs. Anything that isn't a snowflake
                // is rejected rather than stored.
                const ids = value.split(',').map(s => s.trim()).filter(Boolean);
                if (!ids.every(isSnowflake)) {
                    return interaction.reply({ content: 'Give comma-separated channel IDs, e.g. `123456789012345678, 987654321098765432`.', flags: MessageFlags.Ephemeral });
                }
                config[key] = ids;
            } else if (key === 'strikeAction') {
                if (!STRIKE_ACTIONS.includes(value.toLowerCase())) {
                    return interaction.reply({ content: `That value must be one of: ${STRIKE_ACTIONS.join(', ')}.`, flags: MessageFlags.Ephemeral });
                }
                config[key] = value.toLowerCase();
            } else {
                config[key] = value;
            }

            await config.save();
            invalidateGuildConfig(guildId);
            return interaction.reply({ content: `Updated \`${key}\` to \`${value}\`.`, flags: MessageFlags.Ephemeral });
        }

        return interaction.reply({ content: 'Invalid settings command.', flags: MessageFlags.Ephemeral });
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        // Match the camelCase key and its snake_case twin, so both
        // "contentFilter" and "content_filter" find contentFilterEnabled.
        const matches = SETTABLE_KEYS.filter(k => {
            const snake = k.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
            return k.toLowerCase().includes(focused) || snake.includes(focused);
        }).slice(0, 25);
        await interaction.respond(matches.map(k => ({ name: k, value: k })));
    },
};
