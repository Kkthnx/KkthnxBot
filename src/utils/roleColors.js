/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Recognizable colors for the roles this server uses, so the bot can paint
// version, class and ping roles their real color instead of a random one.
// Keys are normalized (lowercased, single-spaced). Unknown names fall back to a
// random palette color at the callsite.

const MAP = {
    // Game version
    'retail': '#3fa7ff', 'classic': '#c9a15b',

    // Ping and utility roles
    'release pings': '#5cc8ff', 'beta pings': '#b483ff',
    'announcements': '#ff5fd0', 'giveaways': '#f0b429',

    // Class colors as the game shows them
    'death knight': '#c41e3a', 'demon hunter': '#a330c9', 'druid': '#ff7c0a', 'evoker': '#33937f',
    'hunter': '#aad372', 'mage': '#3fc7eb', 'monk': '#00ff98', 'paladin': '#f48cba', 'priest': '#ffffff',
    'rogue': '#fff468', 'shaman': '#0070dd', 'warlock': '#8788ee', 'warrior': '#c69b6d',
};

function normalize(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Returns a curated hex color for a known role name, or null if unknown. */
function smartColor(name) {
    return MAP[normalize(name)] || null;
}

module.exports = { smartColor, normalize, MAP };
