/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const mongoose = require('mongoose');

// One document per guild holding bot-wide state that must survive restarts.
const botStateSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },

    // When slash commands were last registered successfully, so a crash loop
    // respawning shard 0 doesn't burn the command-registration rate limit by
    // re-registering on every boot.
    lastCommandRegisterAt: { type: Date, default: null },

    // Tag of the last KkthnxUI release posted to the changelog channel, so a
    // restart never posts it again.
    lastReleaseTag: { type: String, default: null },

    // Last ticket and bug report numbers handed out, so numbers never repeat.
    ticketSeq: { type: Number, default: 0 },
    bugSeq: { type: Number, default: 0 },

    // The welcome post that carries the showcase, and the starred post it
    // features right now, so a restart continues the rotation in place.
    showcaseChannelId: { type: String, default: null },
    showcaseMessageId: { type: String, default: null },
    showcaseOriginId: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('BotState', botStateSchema);
