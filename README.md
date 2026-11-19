# KkthnxBot

The support bot for the KkthnxUI Discord server. It gets a member from install to answer fast. Release info comes straight from GitHub, common answers live in the database where staff can edit them, tickets open private channels, and bug reports arrive complete and go to GitHub only after staff approve them.

Built on Discord.js v14 and Node.js, stored in MongoDB, and run under a sharding manager.

## What it does

**Support**
- `/version` and `/download` show the latest KkthnxUI release with CurseForge, GitHub and direct zip links. `/changelog` shows recent release notes.
- New GitHub releases post in the changelog channel by themselves, pinging the opt-in Release Pings or Beta Pings role.
- `/faq` and `/install` post answers saved with `/tag`, so staff edit them without a redeploy.
- Long Lua error pastes in the support channels move into a thread with a short preview left behind. Errors from other addons are flagged, and staff link known fixes to error text with `/luafix`.
- A ticket panel with Bug, Install, Profile and Question buttons. Each ticket is a private channel, and closing saves a transcript before the channel is deleted.
- A bug report wizard. It collects flavor, versions, what happened, steps, the Lua error and a screenshot, then opens a tagged forum post. A GitHub issue draft waits in the staff review channel until a Developer or Moderator approves it. When the issue closes, the post is retagged Fixed or Closed and the reporter is told.

**Moderation**
- `/warn`, `/timeout`, `/kick`, `/ban` (permanent or timed), `/massban`, `/unban`, `/purge`, `/lock`, `/slowmode`, and a per-member infraction history.
- Auto-mod for slurs, invites, known phishing domains, mention spam, floods and repeated messages.
- Raid mode that trips on a join flood and holds new members until staff clear the raiders.
- Audit log in the mod-log channel, strike escalation, and an appeal flow. Details are in [docs/MODERATION.md](docs/MODERATION.md).

**Community**
- A welcome post (`/showcase post`) with the welcome copy, a role picker button and a featured setup that rotates through starred posts from show-your-ui every few hours.
- A rules gate (`/verify`), self-assign roles for game version, class and pings, reaction roles, polls, giveaways, suggestions, a starboard and reminders.

**Privacy**
- `/forgetme` exports or erases what is stored about a member, and all server data is purged when the bot is removed. See [PRIVACY.md](PRIVACY.md).

## Commands

| Area | Commands |
| --- | --- |
| Support | `/version` `/download` `/changelog` `/install` `/faq` `/ticket` `/bug` `/tag` `/luafix` |
| Community | `/showcase` `/roles` `/reactionrole` `/suggest` `/poll` `/giveaway` `/remind` `/verify` |
| Moderation | `/warn` `/timeout` `/kick` `/ban` `/massban` `/unban` `/infractions` `/purge` `/lock` `/unlock` `/slowmode` `/raidmode` `/appeal` |
| Info | `/help` `/stats` `/serverinfo` `/userinfo` `/avatar` `/botinfo` `/forgetme` |
| Admin | `/settings` |

## Setup

You need Node.js 20.19 or newer, a MongoDB database, and a bot application from the Discord developer portal.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and fill it in. The shard manager refuses to start without `TOKEN` and `MONGO_URI`.
3. In the developer portal, switch on the Server Members and Message Content privileged intents.
4. Run `npm start`. Slash commands register themselves on startup. `AUTO_DEPLOY=false` turns that off.

### Bot permissions

View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Manage Messages, Manage Threads, Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate Members, View Audit Log and Send Polls. Its role must sit above any role it hands out.

### First-time setup in Discord

Run these as someone with Manage Server.

1. `/settings set modLogChannelId <id>` for infractions, tickets, appeals and the audit log.
2. Make `bug-reports` a forum channel with the tags Retail, Classic, New, Needs Info, Filed, Fixed and Closed. Members should be able to reply in posts but not create them, so every report goes through the wizard.
3. Fill in the ticket, bug and changelog IDs in `.env`, then restart.
4. `/ticket panel` in `create-ticket`, and `/bug panel` to pin the Report a bug post in the forum.
5. `/tag create name:install` with the install steps, plus any FAQ entries.
6. `/roles preset pack:version`, `pack:pings` and `pack:classes` for the self-assign roles.
7. `/settings set starboardChannelId <id>`, then `/showcase post` in `welcome` for the welcome post and its featured setup.
8. `/verify setup role:@Member` then `/verify post channel:#rules` for the rules gate. Lock member channels to that role first.

## How it is put together

```
shard.js              sharding manager, env check
src/index.js          client, bounded caches, Mongo reconnect loop, loaders
src/events/           one file per gateway event, wrapped so errors never go unhandled
src/commands/         slash commands, support commands in commands/support
src/utils/            managers and pure helpers (tickets, bug reports, GitHub, auto-mod)
src/database/         Mongoose schemas
tests/                Jest
```

- Every poller (release feed, issue sync, giveaways, reminders, temp-bans) runs through `utils/scheduler.js`, which never lets two ticks overlap or a rejection escape.
- GitHub release lookups are cached for ten minutes and fall back to the last good answer when GitHub is down.
- Nothing is written to GitHub without a staff click, and every bot action is logged to the mod-log or a ticket transcript.

## Development

```bash
npm test        # Jest
npm run lint    # ESLint
npm run dev     # nodemon
npm run deploy  # register slash commands by hand
```

Do not point a development copy at the production token. Two processes on one token answer every command twice.

## Support the work

Free forever. If it saved you time, chip in.

- [Ko-fi](https://ko-fi.com/kkthnx)
- [Buy Me a Coffee](https://buymeacoffee.com/kkthnx)
- [PayPal](https://www.paypal.com/paypalme/kkthnxtv)

## License

Copyright (c) 2026 Kkthnx. All rights reserved. Proprietary. No permission is granted to use, copy, modify, distribute, or host this code without written permission. See [LICENSE](LICENSE).
