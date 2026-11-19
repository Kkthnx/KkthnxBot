/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Channel and role IDs come from the environment so they never live in the
// committed repo.
module.exports = {
    announcements: process.env.ANNOUNCEMENTS_CHANNEL_ID || '',
    modLog: process.env.MOD_LOG_CHANNEL_ID || '',
    roles: {
        // Role given to every new member on join, when the rules gate is off.
        member: process.env.MEMBER_ROLE_ID || '',
    },
};
