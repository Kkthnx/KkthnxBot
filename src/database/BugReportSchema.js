/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const mongoose = require('mongoose');

// A bug filed through the wizard. It lives as a forum post in bug-reports and,
// once staff approve the draft, as a GitHub issue that the bot keeps in sync.
const bugReportSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    number: { type: Number, required: true },
    reporterId: { type: String, required: true },

    flavor: { type: String, enum: ['retail', 'classic'], required: true },
    gameVersion: { type: String, default: '' },
    addonVersion: { type: String, default: '' },
    summary: { type: String, required: true },
    steps: { type: String, default: '' },
    luaError: { type: String, default: '' },
    screenshotUrl: { type: String, default: null },

    // new: waiting for staff, needs_info: no error text or screenshot,
    // filed: GitHub issue open, fixed/closed: issue closed, rejected: staff said no.
    status: { type: String, enum: ['new', 'needs_info', 'filed', 'fixed', 'closed', 'rejected'], default: 'new' },

    threadId: { type: String, default: null },
    draftChannelId: { type: String, default: null },
    draftMessageId: { type: String, default: null },
    reviewedById: { type: String, default: null },
    issueNumber: { type: Number, default: null },
    issueUrl: { type: String, default: null },
}, { timestamps: true });

bugReportSchema.index({ guildId: 1, number: 1 }, { unique: true });
bugReportSchema.index({ status: 1, issueNumber: 1 });
bugReportSchema.index({ threadId: 1 });

module.exports = mongoose.model('BugReport', bugReportSchema);
