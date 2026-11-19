/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { postAnswer, INSTALL_TAG } = require('./faq');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('install')
        .setDescription('Post the KkthnxUI install steps')
        .setContexts(InteractionContextType.Guild),
    execute: (interaction) => postAnswer(interaction, INSTALL_TAG),
};
