/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Mirrors new KkthnxUI GitHub releases into the changelog
// channel. Full releases ping the Release Pings role and prereleases ping the
// Beta Pings role, each only when that role is configured. The last posted tag
// is kept in BotState so a restart never posts a release twice.

const BotState = require('../database/BotStateSchema');
const { supportSettings } = require('./features');
const { getRecentReleases } = require('./githubReleases');
const { buildChangelogEmbed } = require('./supportReplies');
const { missingPermissions, describeMissing } = require('./channelAccess');
const { startPolling } = require('./scheduler');
const logger = require('./logger');

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_POLL_DELAY_MS = 30 * 1000;
const LOOKBACK = 5;

function feedSettings(env = process.env) {
    return {
        channelId: (env.CHANGELOG_CHANNEL_ID || '').trim(),
        releaseRoleId: (env.RELEASE_PING_ROLE_ID || '').trim(),
        betaRoleId: (env.BETA_PING_ROLE_ID || '').trim(),
    };
}

/**
 * Releases to post, oldest first. `releases` is newest first, as GitHub
 * returns it. With no saved tag the feed adopts the newest release silently,
 * so turning it on never dumps history. When the saved tag has fallen out of
 * the lookback window, only the newest release is posted, not a flood.
 */
function pickNewReleases(releases, lastTag) {
    if (!Array.isArray(releases) || !releases.length || !lastTag) return [];
    const idx = releases.findIndex(r => r.tag === lastTag);
    if (idx === 0) return [];
    const fresh = idx === -1 ? releases.slice(0, 1) : releases.slice(0, idx);
    return fresh.reverse();
}

/** Message payload for one release, pinging only the matching opt-in role. */
function buildReleasePost(release, feed, settings) {
    const roleId = release.prerelease ? feed.betaRoleId : feed.releaseRoleId;
    return {
        content: roleId ? `<@&${roleId}>` : undefined,
        embeds: [buildChangelogEmbed([release], settings)],
        allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
    };
}

async function saveTag(guildId, tag) {
    await BotState.findOneAndUpdate({ guildId }, { lastReleaseTag: tag }, { upsert: true });
}

async function runReleaseFeed(client, env = process.env) {
    const feed = feedSettings(env);
    if (!feed.channelId) return;
    const settings = supportSettings(env);

    const channel = client.channels.cache.get(feed.channelId);
    if (!channel || !channel.guild) return; // not on this shard, or the id is wrong
    const guildId = channel.guild.id;

    const releases = await getRecentReleases(settings.repo, LOOKBACK);
    if (!releases.length) return;

    const state = await BotState.findOne({ guildId }, { lastReleaseTag: 1 }).lean();
    const lastTag = state && state.lastReleaseTag;
    if (!lastTag) {
        await saveTag(guildId, releases[0].tag);
        logger.info(`[RELEASES] Feed started at ${releases[0].tag}, nothing posted.`);
        return;
    }

    const fresh = pickNewReleases(releases, lastTag);
    if (!fresh.length) return;

    // Leave the saved tag alone when the bot cannot post, so the release goes
    // out once the permission is fixed instead of being skipped.
    const missing = missingPermissions(channel, 'embed');
    if (missing.includes('SendMessages') || missing.includes('ViewChannel')) {
        logger.warn(`[RELEASES] Cannot post ${fresh.length} release(s): ${describeMissing(channel, missing)}.`);
        return;
    }

    for (const release of fresh) {
        await channel.send(buildReleasePost(release, feed, settings));
        // Save after each post so a failure midway never reposts earlier ones.
        await saveTag(guildId, release.tag);
        logger.info(`[RELEASES] Posted ${release.tag} to #${channel.name}.`);
    }
}

/** Starts the poller when a changelog channel is set. */
function startReleaseFeed(client, env = process.env) {
    if (!feedSettings(env).channelId) {
        logger.info('[RELEASES] CHANGELOG_CHANNEL_ID not set, release feed is off.');
        return null;
    }
    return startPolling({
        name: 'RELEASES',
        task: () => runReleaseFeed(client, env),
        intervalMs: POLL_INTERVAL_MS,
        immediate: true,
        delayMs: FIRST_POLL_DELAY_MS,
    });
}

module.exports = { startReleaseFeed, runReleaseFeed, pickNewReleases, buildReleasePost, feedSettings };
