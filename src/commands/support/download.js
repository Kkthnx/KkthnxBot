/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { replyWithLatest } = require('./version');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('download')
        .setDescription('Get the download links for the current KkthnxUI release')
        .setContexts(InteractionContextType.Guild),
    execute: replyWithLatest,
};
