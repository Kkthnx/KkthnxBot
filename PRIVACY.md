# KkthnxBot Privacy Policy

_Last updated: 2026-11-19_

KkthnxBot ("the bot") is the support and moderation bot for the KkthnxUI Discord server. This policy explains what data the bot stores and how it is handled, in line with the [Discord Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service).

Everything below is stored per server. The bot keeps no data that spans servers, and no data at all about servers it is not in.

## Data we store

| Data | Stored because | Removed by `/forgetme delete` |
| :--- | :--- | :--- |
| Discord user ID and server ID | Ties everything below to you in a given server. | Yes, along with the rows below that are removed |
| Reminders you set (**the text you wrote**, channel, due time) | Delivers `/remind`. Deleted once delivered. | Yes |
| Giveaway entries | Records that you entered, so the draw is fair. | Yes |
| Support tickets (number, type, the summary and version you typed, open and close times) | Support history for staff. The conversation itself is saved as a transcript message in a staff channel. | **No**, see below |
| Bug reports (**the text you wrote**, versions, Lua error, screenshot link, GitHub issue link) | Published to the bug-reports forum and, after staff approve, to a public GitHub issue. | **No**, see below |
| Suggestions you post (**the text you wrote**, vote tallies) | Published to the suggestion channel like a message. | **No**, see below |
| Moderation records (type, reason, moderator, duration) | The server's record of moderation actions. | **No**, see below |
| Tags you author (**the text you wrote**) | Saved answers for the whole server, used by `/faq` and `/install`. | No, managed by the server |
| Starboard entries (message IDs only, no content) | Keeps a highlighted message's star count in sync. | No, keyed to a message not a person |
| Server settings and bot state (channel and role IDs, counters) | Configuration. Contains no personal data. | Not applicable |

### About message content

The bot does **not** store the content of ordinary chat messages. Message text is processed in memory for the auto-moderation filter and is never written to the database.

It does store text you deliberately submit to a bot feature, as listed above.

Some features copy messages into Discord itself rather than into bot storage. The auto-moderation filter and the audit log post deleted or edited messages to the mod-log channel, a closed ticket's conversation is posted as a transcript file in a staff channel, and the starboard reposts highlighted messages. Those copies are Discord messages in the server and follow the server's own retention.

### GitHub

When staff approve a bug report, the bot creates a public issue on the KkthnxUI GitHub repository. The issue holds the report text, versions, Lua error and a link back to the Discord post. It does not include your Discord name or ID. Removing a GitHub issue is a request for the repository owner.

## Data we do not collect

- We do not sell or share your data with third parties.
- We do not store IP addresses or payment information.
- We do not read or store your direct messages. The bot only sends DMs for moderation notices and the welcome message.

## Your controls

- **`/forgetme export`** downloads everything the bot stores about you in that server, as a JSON file only you can see.
- **`/forgetme delete`** erases what the table above says it erases, after an explicit confirmation.

## Retention

- When the bot is removed from a server, all data for that server is permanently deleted, including moderation records, tickets and bug reports.
- Reminders are deleted as soon as they are delivered.
- Starboard entries are removed when the original message is deleted.
- Everything else is kept until it is erased or the bot leaves the server.

### Why some records survive a deletion request

**Moderation records** are the server's own record of what its moderators did. If a member could erase their own history on request, the record would be worthless.

**Suggestions and bug reports** are content you published for the community, in the same way a message is. Deleting a post is a staff decision, so ask staff and they can remove it.

**Ticket records** are support history the staff rely on to help with repeat problems.

`/forgetme delete` reports how many of each were kept.

## Contact

For privacy questions, contact the staff in the KkthnxUI Discord server.
