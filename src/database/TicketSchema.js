/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const mongoose = require('mongoose');

// A private support ticket. Each one owns a channel while
// open. Closed records stay so staff can look a past ticket up by number.
const ticketSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    number: { type: Number, required: true },
    openerId: { type: String, required: true },
    type: { type: String, enum: ['bug', 'install', 'profile', 'question'], required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    channelId: { type: String, default: null },
    summary: { type: String, default: '' },
    version: { type: String, default: '' },
    closedById: { type: String, default: null },
    closeReason: { type: String, default: null },
    closedAt: { type: Date, default: null },
}, { timestamps: true });

ticketSchema.index({ guildId: 1, number: 1 }, { unique: true });
ticketSchema.index({ channelId: 1 });
// One open ticket per member. The unique partial index makes this hold even
// when two button clicks race each other.
ticketSchema.index(
    { guildId: 1, openerId: 1 },
    { unique: true, partialFilterExpression: { status: 'open' } },
);

module.exports = mongoose.model('Ticket', ticketSchema);
