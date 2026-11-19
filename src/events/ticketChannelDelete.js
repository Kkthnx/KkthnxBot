/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { handleChannelDelete } = require('../utils/ticketManager');
const logger = require('../utils/logger');

// A ticket channel deleted by hand must not leave its member unable to open a
// new ticket.
module.exports = {
    name: 'channelDelete',
    async execute(channel) {
        await handleChannelDelete(channel).catch(err => logger.warn(`[TICKET] Channel delete cleanup failed: ${err.message}`));
    },
};
