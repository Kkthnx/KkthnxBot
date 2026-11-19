/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Embeds for the support layer's release commands. Kept apart from the
// commands so the formatting can be tested without Discord or the network.

const { brandedEmbed, COLORS } = require('./brand');
const { supportSettings } = require('./features');
const { trimNotes } = require('./githubReleases');
const { LIMITS } = require('./embedText');

function releasesPage(repo) {
    return `https://github.com/${repo}/releases`;
}

function linkLines(release, settings) {
    const lines = [`[CurseForge](${settings.curseforgeUrl})`, `[GitHub releases](${releasesPage(settings.repo)})`];
    if (release && release.zipUrl) lines.push(`[Direct zip](${release.zipUrl})`);
    return lines.join(' · ');
}

function unixTime(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) ? Math.floor(date.getTime() / 1000) : null;
}

/** /version and /download: the current release with where to get it. */
function buildReleaseEmbed(release, settings = supportSettings()) {
    const embed = brandedEmbed({ color: COLORS.primary, footer: settings.productName })
        .setTitle(`${settings.productName} ${release.tag}`)
        .setURL(release.url || releasesPage(settings.repo));
    const ts = unixTime(release.publishedAt);
    const lines = [];
    if (ts) lines.push(`Released <t:${ts}:D> (<t:${ts}:R>)`);
    lines.push(linkLines(release, settings));
    embed.setDescription(lines.join('\n'));
    return embed;
}

/** Shown when GitHub cannot be reached, so the member still gets the links. */
function buildFallbackEmbed(settings = supportSettings()) {
    return brandedEmbed({ color: COLORS.neutral, footer: settings.productName })
        .setTitle(`Download ${settings.productName}`)
        .setDescription(`Release info is unavailable right now. The links still work.\n${linkLines(null, settings)}`);
}

/** /changelog: notes for one or more releases, newest first. */
function buildChangelogEmbed(releases, settings = supportSettings()) {
    const embed = brandedEmbed({ color: COLORS.accent, footer: settings.productName })
        .setTitle(`${settings.productName} changelog`)
        .setURL(releasesPage(settings.repo));

    if (releases.length === 1) {
        const [r] = releases;
        embed.setTitle(`${settings.productName} ${r.tag} changelog`).setURL(r.url || releasesPage(settings.repo));
        embed.setDescription(trimNotes(r.body, LIMITS.description) || 'No notes were published for this release.');
        return embed;
    }

    // Field values cap at 1024 characters, and all fields share the embed total.
    const perField = Math.min(LIMITS.fieldValue, Math.floor(4000 / releases.length));
    for (const r of releases) {
        const ts = unixTime(r.publishedAt);
        const label = `${r.tag}${r.prerelease ? ' (beta)' : ''}${ts ? `, <t:${ts}:D>` : ''}`;
        embed.addFields({ name: label.slice(0, LIMITS.fieldName), value: trimNotes(r.body, perField) || 'No notes.' });
    }
    return embed;
}

module.exports = { buildReleaseEmbed, buildFallbackEmbed, buildChangelogEmbed, releasesPage };
