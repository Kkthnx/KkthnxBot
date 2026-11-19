/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// The welcome copy from the server plan, shared by the join DM and the
// welcome channel post.

const { BRAND } = require('./brand');

/** Mentions a channel by name when it exists, so the text links straight to it. */
function channelRef(guild, name) {
    const channel = guild.channels.cache.find(c => c.name === name);
    return channel ? `<#${channel.id}>` : `#${name}`;
}

/** The plan's welcome copy, with live channel links. */
function welcomeText(guild) {
    const c = name => channelRef(guild, name);
    return [
        `This is the support and community home for ${BRAND.community}.`,
        '',
        `New here? Start in ${c('get-started')} for the 3-step install. Need help? Open a ticket in ${c('create-ticket')} or ask in ${c('help-retail')} or ${c('help-classic')}. Want to show off your setup? Post it in ${c('show-your-ui')}.`,
        '',
        `Free forever. If it saved you time, chip in links live in ${c('downloads')}.`,
    ].join('\n');
}

module.exports = { welcomeText, channelRef };
