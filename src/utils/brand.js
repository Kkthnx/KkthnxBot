/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

// Embed palette. Discord embeds get one accent stripe, so this is a small set
// of semantic colors rather than a full theme.
const PALETTE = {
    accent: 0x5cc8ff, // primary cyan
    purple: 0xb483ff,
    teal: 0x34d3b4,   // success
    gold: 0xf0b429,   // highlight
    danger: 0xff6b6b, // moderation and errors
    dim: 0x7c8aa0,    // muted
};

/** Parse a "#5865f2" or "5865f2" hex color, or null when it is not one. */
function parseHexColor(value) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
    return m ? parseInt(m[1], 16) : null;
}

// Names and the main accent can be overridden from .env, for a test server.
function brandFromEnv(env = process.env) {
    const community = (env.BRAND_COMMUNITY || '').trim() || 'KkthnxUI';
    const bot = (env.BRAND_BOT || '').trim() || 'KkthnxBot';
    return { community, bot, footer: community, accent: parseHexColor(env.BRAND_ACCENT) };
}

const BRAND = brandFromEnv();

// Semantic roles so call sites read intent, not hex.
const COLORS = {
    primary: BRAND.accent ?? PALETTE.accent,
    success: PALETTE.teal,
    hype: PALETTE.gold,
    danger: PALETTE.danger,
    neutral: PALETTE.dim,
    accent: PALETTE.purple,
};

/** Footer such as "KkthnxUI, Roles". */
function footerFor(section) {
    return section ? `${BRAND.community}, ${section}` : BRAND.footer;
}

/**
 * Base embed with the brand accent, a consistent footer and a timestamp.
 * @param {{ color?: number, footer?: string }} [opts]
 */
function brandedEmbed({ color = COLORS.primary, footer = BRAND.footer } = {}) {
    return new EmbedBuilder()
        .setColor(color)
        .setFooter({ text: footer })
        .setTimestamp();
}

/**
 * Unicode progress bar, used for suggestion approval.
 * @param {number} ratio - 0..1
 * @param {number} [slots=12]
 */
function progressBar(ratio, slots = 12) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const filled = Math.round(clamped * slots);
    return '▰'.repeat(filled) + '▱'.repeat(slots - filled);
}

module.exports = { BRAND, COLORS, PALETTE, brandedEmbed, progressBar, config, footerFor, brandFromEnv, parseHexColor };
