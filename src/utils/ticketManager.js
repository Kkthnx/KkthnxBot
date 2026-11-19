/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// Ticket system. A panel in create-ticket offers four ticket
// types. Each opens a short form, then a private channel only the member and
// the support staff can see. Closing saves a transcript before the channel is
// deleted, and opens and closes are written to the mod-log.

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const Ticket = require('../database/TicketSchema');
const BotState = require('../database/BotStateSchema');
const { brandedEmbed, COLORS, footerFor } = require('./brand');
const { getModLogChannel } = require('./auditLog');
const { logModAction } = require('./moderationManager');
const { isSnowflake } = require('./snowflake');
const logger = require('./logger');

const TYPES = {
    // `ask` is the modal label (Discord caps it at 45), `hint` the placeholder.
    bug: { label: 'Bug', emoji: '🐞', style: ButtonStyle.Danger, ask: 'What went wrong?', hint: 'What happened, and the steps that make it happen' },
    install: { label: 'Install', emoji: '📦', style: ButtonStyle.Primary, ask: 'Where are you stuck?', hint: 'Installing, updating, or the first run' },
    profile: { label: 'Profile', emoji: '🧩', style: ButtonStyle.Secondary, ask: 'What do you need with a profile?', hint: 'Importing, exporting, or a profile that will not load' },
    question: { label: 'Question', emoji: '❓', style: ButtonStyle.Secondary, ask: 'What is your question?', hint: 'Ask away' },
};

const ID = {
    open: 'ticket:open:',      // + type
    modal: 'ticket:modal:',    // + type
    close: 'ticket:close',
    confirm: 'ticket:closeconfirm',
};
const INPUT = { summary: 'ticket_summary', version: 'ticket_version' };

const SUMMARY_MAX = 1000;
const VERSION_MAX = 80;
const TRANSCRIPT_MAX_MESSAGES = 2000;
const DELETE_DELAY_MS = 5000;
const DISCORD_MISSING_PERMISSIONS = 50013;
const MONGO_DUPLICATE_KEY = 11000;

// ---------------------------------------------------------------------------
// Settings and pure helpers
// ---------------------------------------------------------------------------

function ticketSettings(env = process.env) {
    const ids = s => String(s || '').split(',').map(x => x.trim()).filter(isSnowflake);
    return {
        categoryId: (env.TICKET_CATEGORY_ID || '').trim(),
        transcriptChannelId: (env.TICKET_TRANSCRIPT_CHANNEL_ID || '').trim(),
        staffRoleIds: ids(env.TICKET_STAFF_ROLE_IDS),
    };
}

function channelNameFor(type, number) {
    return `${type}-${String(number).padStart(4, '0')}`;
}

/** Staff can see and close any ticket. Manage Messages counts as staff too. */
function isStaff(member, staffRoleIds) {
    if (!member) return false;
    if (member.permissions?.has?.(PermissionFlagsBits.ManageMessages)) return true;
    const roles = member.roles?.cache;
    return Boolean(roles && staffRoleIds.some(id => roles.has(id)));
}

/**
 * Who can see a ticket channel: nobody by default, then the opener, the staff
 * roles and the bot itself. Role ids that no longer exist are dropped because
 * Discord rejects an overwrite for an unknown role.
 */
function buildOverwrites({ everyoneId, openerId, botId, staffRoleIds, existingRoleIds }) {
    const member = [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
    ];
    const overwrites = [
        { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
        { id: openerId, allow: member },
        { id: botId, allow: [...member, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ];
    for (const id of staffRoleIds) {
        if (existingRoleIds.has(id)) overwrites.push({ id, allow: [...member, PermissionFlagsBits.ManageMessages] });
    }
    return overwrites;
}

function attachmentsOf(message) {
    const a = message.attachments;
    if (!a) return [];
    return typeof a.values === 'function' ? [...a.values()] : Array.from(a);
}

/** Plain-text transcript, oldest message first. */
function formatTranscript(ticket, messages, guildName) {
    const header = [
        `Ticket #${ticket.number} (${TYPES[ticket.type]?.label || ticket.type}) in ${guildName}`,
        `Opened by ${ticket.openerId} at ${new Date(ticket.createdAt || Date.now()).toISOString()}`,
        `Messages: ${messages.length}`,
        '',
    ];
    const sorted = [...messages].sort((x, y) => x.createdTimestamp - y.createdTimestamp);
    const lines = sorted.map(m => {
        const time = new Date(m.createdTimestamp).toISOString();
        const who = `${m.author?.tag || m.author?.username || 'unknown'} (${m.author?.id || '?'})`;
        const parts = [m.content || ''];
        for (const e of m.embeds || []) {
            const text = [e.title, e.description].filter(Boolean).join(' | ');
            if (text) parts.push(`[embed] ${text}`);
        }
        for (const att of attachmentsOf(m)) parts.push(`[file] ${att.name || 'attachment'} ${att.url || ''}`.trim());
        return `[${time}] ${who}: ${parts.filter(Boolean).join('\n    ')}`;
    });
    return header.concat(lines).join('\n');
}

// ---------------------------------------------------------------------------
// Discord-facing builders
// ---------------------------------------------------------------------------

function buildPanel() {
    const embed = brandedEmbed({ color: COLORS.primary, footer: footerFor('Support') })
        .setTitle('Open a support ticket')
        .setDescription([
            'Pick the button that fits. A short form opens, then a private channel that only you and the support team can see.',
            '',
            '🐞 **Bug** something broke or throws a Lua error',
            '📦 **Install** installing or updating',
            '🧩 **Profile** importing or sharing a profile',
            '❓ **Question** anything else',
        ].join('\n'));
    const row = new ActionRowBuilder().addComponents(
        Object.entries(TYPES).map(([type, t]) => new ButtonBuilder()
            .setCustomId(ID.open + type).setLabel(t.label).setEmoji(t.emoji).setStyle(t.style)),
    );
    return { embeds: [embed], components: [row] };
}

function buildModal(type) {
    const t = TYPES[type];
    return new ModalBuilder()
        .setCustomId(ID.modal + type)
        .setTitle(`${t.label} ticket`)
        .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId(INPUT.summary).setLabel(t.ask)
                .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(SUMMARY_MAX)
                .setPlaceholder(t.hint)),
            new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId(INPUT.version).setLabel('KkthnxUI version and game flavor')
                .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(VERSION_MAX)
                .setPlaceholder('For example 11.1.1, Retail')),
        );
}

function buildOpening(ticket) {
    const t = TYPES[ticket.type];
    const embed = brandedEmbed({ color: COLORS.primary, footer: footerFor('Support') })
        .setTitle(`Ticket #${ticket.number}, ${t.label}`)
        .setDescription(ticket.summary || 'No details given.')
        .addFields(
            { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
            { name: 'Version', value: ticket.version || 'Not given', inline: true },
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.close).setLabel('Close ticket').setStyle(ButtonStyle.Secondary),
    );
    return {
        content: `<@${ticket.openerId}> thanks, a helper will reply here. Add screenshots or the full Lua error if you have them.`,
        embeds: [embed],
        components: [row],
        allowedMentions: { users: [ticket.openerId] },
    };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

/** An open record whose channel is gone is closed, so the member is not stuck. */
async function findLiveOpenTicket(guild, openerId) {
    const open = await Ticket.findOne({ guildId: guild.id, openerId, status: 'open' }).lean();
    if (!open) return null;
    if (open.channelId && guild.channels.cache.has(open.channelId)) return open;
    await Ticket.updateOne({ _id: open._id, status: 'open' }, { status: 'closed', closeReason: 'Channel missing', closedAt: new Date() });
    return null;
}

async function handleOpenButton(interaction) {
    const type = interaction.customId.slice(ID.open.length);
    if (!TYPES[type]) return interaction.reply(ephemeral('That ticket type does not exist.'));
    const existing = await findLiveOpenTicket(interaction.guild, interaction.user.id);
    if (existing) return interaction.reply(ephemeral(`You already have an open ticket: <#${existing.channelId}>`));
    return interaction.showModal(buildModal(type));
}

async function nextTicketNumber(guildId) {
    const state = await BotState.findOneAndUpdate(
        { guildId },
        { $inc: { ticketSeq: 1 } },
        { upsert: true, returnDocument: 'after' },
    );
    return state.ticketSeq;
}

async function handleModalSubmit(interaction) {
    const type = interaction.customId.slice(ID.modal.length);
    if (!TYPES[type]) return interaction.reply(ephemeral('That ticket type does not exist.'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { guild, user } = interaction;
    const settings = ticketSettings();
    const summary = interaction.fields.getTextInputValue(INPUT.summary).trim().slice(0, SUMMARY_MAX);
    const version = (interaction.fields.getTextInputValue(INPUT.version) || '').trim().slice(0, VERSION_MAX);

    const existing = await findLiveOpenTicket(guild, user.id);
    if (existing) return interaction.editReply(`You already have an open ticket: <#${existing.channelId}>`);

    // Reserve the ticket first. The unique index turns a double submit into a
    // duplicate-key error instead of two channels.
    let ticket;
    try {
        ticket = await Ticket.create({
            guildId: guild.id, number: await nextTicketNumber(guild.id), openerId: user.id, type, summary, version,
        });
    } catch (err) {
        if (err.code === MONGO_DUPLICATE_KEY) return interaction.editReply('You already have an open ticket.');
        throw err;
    }

    const parent = settings.categoryId && guild.channels.cache.get(settings.categoryId);
    let channel;
    try {
        channel = await guild.channels.create({
            name: channelNameFor(type, ticket.number),
            type: ChannelType.GuildText,
            parent: parent && parent.type === ChannelType.GuildCategory ? parent.id : undefined,
            topic: `Ticket #${ticket.number} for ${user.tag} (${user.id})`,
            permissionOverwrites: buildOverwrites({
                everyoneId: guild.roles.everyone.id,
                openerId: user.id,
                botId: guild.members.me.id,
                staffRoleIds: settings.staffRoleIds,
                existingRoleIds: new Set(guild.roles.cache.keys()),
            }),
            reason: `Ticket #${ticket.number} opened by ${user.tag}`,
        });
    } catch (err) {
        await Ticket.deleteOne({ _id: ticket._id }).catch(() => {});
        logger.warn(`[TICKET] Channel create failed for #${ticket.number}: ${err.message}`);
        const hint = err.code === DISCORD_MISSING_PERMISSIONS ? ' The bot is missing Manage Channels.' : '';
        return interaction.editReply(`Could not open a ticket channel.${hint} Please tell a moderator.`);
    }

    ticket.channelId = channel.id;
    await ticket.save();
    await channel.send(buildOpening(ticket));
    await logModAction({
        guild, moderator: user, title: `Ticket #${ticket.number} opened`,
        fields: [
            { name: 'Type', value: TYPES[type].label, inline: true },
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        ],
    });
    logger.info(`[TICKET] #${ticket.number} (${type}) opened by ${user.id}.`);
    return interaction.editReply(`Ticket opened: <#${channel.id}>`);
}

/** Checks the channel is an open ticket and the member may close it. */
async function closableTicket(interaction) {
    const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: 'open' }).lean();
    if (!ticket) return { error: 'This is not an open ticket channel.' };
    const { staffRoleIds } = ticketSettings();
    if (ticket.openerId !== interaction.user.id && !isStaff(interaction.member, staffRoleIds)) {
        return { error: 'Only the member who opened this ticket or support staff can close it.' };
    }
    return { ticket };
}

async function handleCloseButton(interaction) {
    const { error } = await closableTicket(interaction);
    if (error) return interaction.reply(ephemeral(error));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ID.confirm).setLabel('Close and save transcript').setStyle(ButtonStyle.Danger),
    );
    return interaction.reply({ content: 'Close this ticket? The channel is deleted after the transcript is saved.', components: [row], flags: MessageFlags.Ephemeral });
}

async function fetchAllMessages(channel) {
    const all = [];
    let before;
    while (all.length < TRANSCRIPT_MAX_MESSAGES) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!batch.size) break;
        all.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    return all;
}

async function transcriptDestination(guild) {
    const { transcriptChannelId } = ticketSettings();
    const configured = transcriptChannelId && guild.channels.cache.get(transcriptChannelId);
    if (configured && configured.isTextBased?.()) return configured;
    return getModLogChannel(guild);
}

/**
 * Closes the ticket in this channel. The record is flipped to closed first so
 * two clicks cannot both run this, and flipped back if the transcript cannot
 * be saved, because deleting the channel then would lose the conversation.
 */
async function closeTicket(interaction, reason = null) {
    const { ticket, error } = await closableTicket(interaction);
    if (error) return interaction.reply(ephemeral(error));
    const { guild, channel, user } = interaction;

    const claimed = await Ticket.findOneAndUpdate(
        { _id: ticket._id, status: 'open' },
        { status: 'closed', closedById: user.id, closeReason: reason, closedAt: new Date() },
        { returnDocument: 'after' },
    ).lean();
    if (!claimed) return interaction.reply(ephemeral('This ticket is already closing.'));
    await interaction.reply({ content: 'Saving the transcript and closing this ticket.' });

    const reopen = () => Ticket.updateOne(
        { _id: ticket._id },
        { status: 'open', closedById: null, closeReason: null, closedAt: null },
    ).catch(err => logger.error(`[TICKET] Could not reopen #${ticket.number} after a failed close:`, err));

    const destination = await transcriptDestination(guild);
    if (!destination) {
        await reopen();
        return interaction.followUp('No transcript channel is set (TICKET_TRANSCRIPT_CHANNEL_ID or the mod-log), so the ticket stays open.');
    }

    try {
        const messages = await fetchAllMessages(channel);
        const text = formatTranscript(claimed, messages, guild.name);
        const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${String(ticket.number).padStart(4, '0')}.txt` });
        const embed = brandedEmbed({ color: COLORS.neutral, footer: footerFor('Support') })
            .setTitle(`Ticket #${ticket.number}, ${TYPES[ticket.type].label}`)
            .addFields(
                { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
                { name: 'Closed by', value: `<@${user.id}>`, inline: true },
                { name: 'Messages', value: String(messages.length), inline: true },
                { name: 'Summary', value: (ticket.summary || 'None').slice(0, 1024) },
            );
        if (reason) embed.addFields({ name: 'Reason', value: reason.slice(0, 1024) });
        await destination.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
    } catch (err) {
        logger.error(`[TICKET] Transcript for #${ticket.number} failed:`, err);
        await reopen();
        return interaction.followUp('The transcript could not be saved, so the ticket stays open. Check the bot can post files in the transcript channel.');
    }

    await logModAction({
        guild, moderator: user, title: `Ticket #${ticket.number} closed`,
        fields: [
            { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
            { name: 'Reason', value: (reason || 'None').slice(0, 1024), inline: true },
        ],
    });
    logger.info(`[TICKET] #${ticket.number} closed by ${user.id}.`);

    setTimeout(() => {
        channel.delete(`Ticket #${ticket.number} closed by ${user.tag}`)
            .catch(err => logger.warn(`[TICKET] Could not delete channel for #${ticket.number}: ${err.message}`));
    }, DELETE_DELAY_MS);
}

async function handleTicketButton(interaction) {
    const id = interaction.customId;
    if (id.startsWith(ID.open)) return handleOpenButton(interaction);
    if (id === ID.close) return handleCloseButton(interaction);
    if (id === ID.confirm) return closeTicket(interaction);
}

/** A ticket channel deleted by hand closes its record. */
async function handleChannelDelete(channel) {
    await Ticket.updateOne(
        { channelId: channel.id, status: 'open' },
        { status: 'closed', closeReason: 'Channel deleted', closedAt: new Date() },
    );
}

module.exports = {
    TYPES, ID,
    ticketSettings, channelNameFor, isStaff, buildOverwrites, formatTranscript,
    buildPanel, buildModal, buildOpening,
    handleTicketButton, handleModalSubmit, closeTicket, handleChannelDelete,
};
