/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 *
 * The welcome post and its showcase rotation.
 *
 * /showcase post puts one bot-owned message in the welcome channel: the welcome
 * copy, a role picker button, and a featured setup. Every few hours the bot
 * edits that message to feature the next starred post from show-your-ui.
 * Discord file links expire, so the original post is fetched again at every
 * rotation to get a fresh image link.
 */

const BotState = require('../database/BotStateSchema');
const Starboard = require('../database/StarboardSchema');
const { brandedEmbed, COLORS, footerFor, BRAND } = require('./brand');
const { welcomeText, channelRef } = require('./welcomeCopy');
const { buildPanelButton } = require('./selfRoleManager');
const { startPolling } = require('./scheduler');
const logger = require('./logger');

const DEFAULT_HOURS = 6;
// Discord image links last about a day, so a slower rotation would show a
// broken image before the next edit refreshes it.
const MAX_HOURS = 24;
const CANDIDATES = 50;
const MAX_TRIES = 5;
const SNIPPET_MAX = 200;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

function showcaseSettings(env = process.env) {
    const hours = Number(env.SHOWCASE_ROTATE_HOURS);
    const valid = Number.isFinite(hours) && hours >= 1 && hours <= MAX_HOURS;
    return {
        sourceChannelId: (env.SHOWCASE_SOURCE_CHANNEL_ID || '').trim(),
        rotateMs: (valid ? hours : DEFAULT_HOURS) * 60 * 60 * 1000,
    };
}

/**
 * Candidates in the order to try them: the ones after the post featured now,
 * then wrapping around, with the current one last so it only repeats when it
 * is the only one.
 */
function orderCandidates(entries, currentOriginId) {
    const idx = entries.findIndex(e => e.originMessageId === currentOriginId);
    if (idx === -1) return entries.slice();
    return entries.slice(idx + 1).concat(entries.slice(0, idx + 1));
}

/** First image on a message, from an attachment or an embed. */
function firstImage(message) {
    for (const a of message.attachments?.values?.() ?? []) {
        if (String(a.contentType || '').startsWith('image/') || IMAGE_EXT.test(a.name || '')) return a.url;
    }
    for (const e of message.embeds || []) {
        const url = e.image?.url || e.thumbnail?.url;
        if (url) return url;
    }
    return null;
}

function snippet(text) {
    const one = String(text || '').replace(/\s+/g, ' ').trim();
    return one.length > SNIPPET_MAX ? `${one.slice(0, SNIPPET_MAX - 1)}…` : one;
}

function buildWelcomePost(guild, feature) {
    const welcome = brandedEmbed({ color: COLORS.primary, footer: BRAND.footer })
        .setTitle(`Welcome to the ${BRAND.community} server`)
        .setDescription(welcomeText(guild));

    const show = brandedEmbed({ color: COLORS.hype, footer: footerFor('Featured setup') }).setTitle('Featured setup');
    if (feature) {
        const lines = [`Shared by <@${feature.authorId}> in <#${feature.channelId}>. [See the post](${feature.jumpUrl})`];
        if (feature.text) lines.push('', `> ${feature.text}`);
        show.setDescription(lines.join('\n')).setImage(feature.imageUrl);
    } else {
        show.setDescription(`Star a screenshot in ${channelRef(guild, 'show-your-ui')} and it can be featured here.`);
    }

    return { embeds: [welcome, show], components: [buildPanelButton()], allowedMentions: { parse: [] } };
}

/** The next starred post that still exists and still has an image. */
async function pickFeature(guild, sourceChannelId, currentOriginId) {
    const entries = await Starboard.find({ guildId: guild.id, originChannelId: sourceChannelId })
        .sort({ createdAt: -1 }).limit(CANDIDATES).lean();
    const source = guild.channels.cache.get(sourceChannelId);
    if (!source || !entries.length) return null;

    for (const entry of orderCandidates(entries, currentOriginId).slice(0, MAX_TRIES)) {
        const message = await source.messages.fetch(entry.originMessageId).catch(() => null);
        const imageUrl = message && firstImage(message);
        if (!imageUrl) continue;
        return {
            originId: message.id,
            authorId: message.author?.id,
            channelId: source.id,
            jumpUrl: message.url,
            imageUrl,
            text: snippet(message.content),
        };
    }
    return null;
}

/** Posts the welcome post in a channel and makes it the one that rotates. */
async function postWelcome(channel) {
    const { sourceChannelId } = showcaseSettings();
    const feature = sourceChannelId ? await pickFeature(channel.guild, sourceChannelId, null) : null;
    const message = await channel.send(buildWelcomePost(channel.guild, feature));
    await BotState.findOneAndUpdate(
        { guildId: channel.guild.id },
        { showcaseChannelId: channel.id, showcaseMessageId: message.id, showcaseOriginId: feature?.originId || null },
        { upsert: true },
    );
    return message;
}

/** Edits each guild's welcome post to feature the next starred setup. */
async function rotateShowcase(client) {
    const { sourceChannelId } = showcaseSettings();
    if (!sourceChannelId) return;

    for (const guild of client.guilds.cache.values()) {
        const state = await BotState.findOne({ guildId: guild.id }).lean();
        if (!state?.showcaseMessageId) continue;

        const channel = guild.channels.cache.get(state.showcaseChannelId);
        const message = channel && await channel.messages.fetch(state.showcaseMessageId).catch(() => null);
        if (!message) {
            logger.warn(`[SHOWCASE] Welcome post in ${guild.id} is gone, run /showcase post again.`);
            await BotState.updateOne({ guildId: guild.id }, { showcaseChannelId: null, showcaseMessageId: null, showcaseOriginId: null });
            continue;
        }

        const feature = await pickFeature(guild, sourceChannelId, state.showcaseOriginId);
        await message.edit(buildWelcomePost(guild, feature));
        await BotState.updateOne({ guildId: guild.id }, { showcaseOriginId: feature?.originId || null });
        if (feature) logger.info(`[SHOWCASE] Featuring ${feature.originId} in ${guild.id}.`);
    }
}

function startShowcaseRotation(client) {
    const settings = showcaseSettings();
    if (!settings.sourceChannelId) {
        logger.info('[SHOWCASE] SHOWCASE_SOURCE_CHANNEL_ID not set, showcase rotation is off.');
        return null;
    }
    return startPolling({
        name: 'SHOWCASE', task: () => rotateShowcase(client), intervalMs: settings.rotateMs, immediate: true, delayMs: 45 * 1000,
    });
}

module.exports = {
    showcaseSettings, orderCandidates, firstImage, snippet, buildWelcomePost, pickFeature,
    postWelcome, rotateShowcase, startShowcaseRotation,
};
