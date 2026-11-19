/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// FAQ answers live in the same store as /tag, so staff add or edit them with
// /tag create and /tag edit and nothing needs a redeploy. /faq and /install
// are the member-facing way to post one.

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const Tag = require('../../database/TagSchema');
const tagCommand = require('../tag');

const INSTALL_TAG = 'install';

/** Posts a stored answer publicly, or explains privately how to add it. */
async function postAnswer(interaction, rawName) {
    const name = tagCommand.normalize(rawName);
    if (!name) return interaction.reply({ content: 'Pick an FAQ entry.', flags: MessageFlags.Ephemeral });
    const entry = await Tag.findOneAndUpdate(
        { guildId: interaction.guild.id, name },
        { $inc: { uses: 1 } },
    ).lean();
    if (!entry) {
        return interaction.reply({
            content: `No FAQ entry named \`${name}\` yet. Staff can add it with \`/tag create name:${name}\`.`,
            flags: MessageFlags.Ephemeral,
        });
    }
    return interaction.reply({ content: entry.content, allowedMentions: { parse: [] } });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('faq')
        .setDescription('Post an answer to a common question')
        .setContexts(InteractionContextType.Guild)
        .addStringOption(o => o.setName('name').setDescription('FAQ entry').setRequired(true).setAutocomplete(true)),

    autocomplete: (interaction) => tagCommand.autocomplete(interaction),

    execute(interaction) {
        return postAnswer(interaction, interaction.options.getString('name'));
    },

    postAnswer,
    INSTALL_TAG,
};
