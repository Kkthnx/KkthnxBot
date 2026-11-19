/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 *
 * Lua error cleanup for the support channels.
 *
 * A long pasted error is moved into a thread: the bot deletes the paste, posts
 * a short preview with the first lines, opens a thread on that preview, and
 * puts the full error and any known fixes inside. A short error stays where it
 * is, and gets a thread only when a known fix matches it. Known fixes are FAQ
 * tags that staff link to a piece of error text with /luafix.
 */

const { AttachmentBuilder, ChannelType } = require('discord.js');
const Tag = require('../database/TagSchema');
const { getGuildConfig } = require('./guildConfigCache');
const { isSnowflake } = require('./snowflake');
const logger = require('./logger');

const LONG_LINES = 8;
const LONG_CHARS = 600;
const PREVIEW_LINES = 3;
const PREVIEW_LINE_MAX = 160;
const INLINE_MAX = 1800;
const MAX_FIXES_SHOWN = 3;
const FIX_TEXT_MAX = 1000;
const THREAD_NAME_MAX = 100;
const MOVED_TTL_MS = 60 * 1000;
const PRODUCT = 'KkthnxUI';

// ---------------------------------------------------------------------------
// Detection, pure
// ---------------------------------------------------------------------------

// Matches the three shapes errors arrive in:
//   Interface/AddOns/KkthnxUI/Modules/Bags.lua:123:
//   [string "@Interface/AddOns/KkthnxUI/Modules/Bags.lua"]:123:
//   KkthnxUI/Modules/Bags.lua:123:            (error-catcher addons drop the prefix)
const LOC_RE = /(?:Interface[\\/]+AddOns[\\/]+)?([A-Za-z0-9_!.-]+)[\\/]((?:[^\s:"'\\/\]]+[\\/])*[^\s:"'\\/\]]+\.lua)"?\]?:(\d+):/i;
const BLOCKED_RE = /AddOn '([^']+)' tried to call the protected function '([^']+)'/i;
const HINT_RE = /attempt to (index|call|compare|perform arithmetic|concatenate)|bad argument #\d|stack overflow|nil value|Locals:|Stack:|Message:/i;

/** Removes code fences so a pasted ```lua block reads as plain text. */
function stripFences(text) {
    return String(text || '').replace(/```[a-z]*\n?/gi, '').trim();
}

/**
 * Reads a pasted error. Returns null when the text is not a WoW Lua error.
 * @returns {null | { addon: string|null, file: string|null, line: number|null, message: string, lines: number, text: string }}
 */
function parseLuaError(raw) {
    const text = stripFences(raw);
    if (!text) return null;
    const lines = text.split(/\r?\n/).length;

    const blocked = BLOCKED_RE.exec(text);
    if (blocked) {
        return { addon: blocked[1], file: null, line: null, message: `tried to call the protected function ${blocked[2]}`, lines, text };
    }

    const loc = LOC_RE.exec(text);
    if (!loc) return null;
    // A file path alone is not enough, people paste paths in normal questions.
    if (!HINT_RE.test(text)) return null;

    const msgMatch = /\.lua"?\]?:\d+:\s*(.+)/.exec(text);
    return {
        addon: loc[1],
        file: loc[2].split(/[\\/]/).pop(),
        line: Number(loc[3]),
        message: msgMatch ? msgMatch[1].trim() : '',
        lines,
        text,
    };
}

function isLong(parsed) {
    return parsed.lines >= LONG_LINES || parsed.text.length >= LONG_CHARS;
}

function threadName(parsed) {
    const where = parsed.file ? `${parsed.file}:${parsed.line}` : 'protected call';
    const name = `Lua error, ${parsed.addon || 'unknown addon'} ${where}`;
    return name.length > THREAD_NAME_MAX ? `${name.slice(0, THREAD_NAME_MAX - 1)}…` : name;
}

function previewLines(parsed) {
    return parsed.text.split(/\r?\n/).slice(0, PREVIEW_LINES)
        .map(l => (l.length > PREVIEW_LINE_MAX ? `${l.slice(0, PREVIEW_LINE_MAX - 1)}…` : l))
        .join('\n').replace(/```/g, '``​`');
}

function isOtherAddon(parsed) {
    return Boolean(parsed.addon) && !parsed.addon.toLowerCase().startsWith(PRODUCT.toLowerCase());
}

/** Fix entries whose match text appears in the error, case-insensitive. */
function matchFixes(fixes, text) {
    const haystack = text.toLowerCase();
    return (fixes || []).filter(f => f.match && haystack.includes(f.match.toLowerCase())).slice(0, MAX_FIXES_SHOWN);
}

function luaChannelIds(env = process.env) {
    return String(env.LUA_ERROR_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(isSnowflake);
}

// ---------------------------------------------------------------------------
// Messages we moved, so the delete audit does not log them as removals
// ---------------------------------------------------------------------------

const moved = new Map(); // messageId -> expiry

function markMoved(id, now = Date.now()) {
    for (const [k, exp] of moved) if (exp <= now) moved.delete(k);
    moved.set(id, now + MOVED_TTL_MS);
}

function wasMovedByBot(id, now = Date.now()) {
    const exp = moved.get(id);
    return Boolean(exp && exp > now);
}

// ---------------------------------------------------------------------------
// Discord side
// ---------------------------------------------------------------------------

/**
 * Messages to post in the thread: the error first, then one per known fix.
 * Kept as separate messages so nothing is cut at Discord's 2000 characters.
 */
function buildThreadBody(parsed, authorId, fixTags) {
    const intro = [`<@${authorId}> here is your full error. Helpers will reply in this thread.`];
    if (isOtherAddon(parsed)) {
        intro.push(`This error comes from **${parsed.addon}**, not ${PRODUCT}. Try with ${parsed.addon} turned off first.`);
    }
    const head = intro.join('\n\n');
    const block = '```lua\n' + parsed.text.replace(/```/g, '``​`') + '\n```';

    const first = { allowedMentions: { users: [authorId] } };
    if (head.length + 2 + block.length <= INLINE_MAX) {
        first.content = `${head}\n\n${block}`;
    } else {
        first.content = `${head}\n\nThe full error is attached as a file.`;
        first.files = [new AttachmentBuilder(Buffer.from(parsed.text, 'utf8'), { name: 'lua-error.txt' })];
    }

    const fixes = fixTags.map(tag => ({
        content: `**Known fix (${tag.name})**\n${tag.content.slice(0, FIX_TEXT_MAX)}`,
        allowedMentions: { parse: [] },
    }));
    return [first, ...fixes];
}

async function postAll(thread, payloads) {
    for (const p of payloads) await thread.send(p);
}

async function loadFixTags(guildId, fixes) {
    if (!fixes.length) return [];
    const names = [...new Set(fixes.map(f => f.tag))];
    const tags = await Tag.find({ guildId, name: { $in: names } }, { name: 1, content: 1 }).lean();
    return names.map(n => tags.find(t => t.name === n)).filter(Boolean);
}

/**
 * Handles a message in a configured support channel. Returns true when it
 * acted, so the caller can stop.
 */
async function handleLuaErrorMessage(message, env = process.env) {
    if (!luaChannelIds(env).includes(message.channelId)) return false;
    if (message.channel?.type !== ChannelType.GuildText) return false;

    const parsed = parseLuaError(message.content);
    if (!parsed) return false;

    const cfg = await getGuildConfig(message.guild.id) || {};
    const fixTags = await loadFixTags(message.guild.id, matchFixes(cfg.luaFixes, parsed.text));
    const long = isLong(parsed);
    if (!long && !fixTags.length) return false;

    const body = buildThreadBody(parsed, message.author.id, fixTags);

    // Short error with a known fix: leave it in place, answer in a thread on it.
    if (!long) {
        const thread = await message.startThread({ name: threadName(parsed), reason: 'Known Lua error fix' });
        await postAll(thread, body);
        return true;
    }

    // Long error: replace the paste with a short preview and move it into a thread.
    const where = parsed.file ? ` (\`${parsed.file}:${parsed.line}\`)` : '';
    let anchor;
    try {
        anchor = await message.channel.send({
            content: `<@${message.author.id}> posted a Lua error from **${parsed.addon || 'an addon'}**${where}. The full text is in the thread.\n\`\`\`\n${previewLines(parsed)}\n\`\`\``,
            allowedMentions: { parse: [] },
        });
    } catch (err) {
        logger.warn(`[LUA] Could not post a preview in #${message.channel.name}: ${err.message}`);
        return false;
    }

    const thread = await anchor.startThread({ name: threadName(parsed), reason: `Lua error from ${message.author.tag}` });
    await postAll(thread, body);

    markMoved(message.id);
    await message.delete().catch(err => {
        // Without Manage Messages the paste stays, the thread still helps.
        logger.warn(`[LUA] Could not remove the original paste: ${err.message}`);
    });
    logger.info(`[LUA] Moved a ${parsed.lines}-line error from ${message.author.id} into a thread.`);
    return true;
}

module.exports = {
    parseLuaError, stripFences, isLong, threadName, previewLines, isOtherAddon, matchFixes, luaChannelIds,
    buildThreadBody, handleLuaErrorMessage, markMoved, wasMovedByBot,
    LIMITS: { LONG_LINES, LONG_CHARS, INLINE_MAX, MAX_FIXES_SHOWN },
};
