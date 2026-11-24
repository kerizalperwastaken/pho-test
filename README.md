# sunbird-plugins

Collection of [Sunbird / Phoenix](https://github.com/sunbird-tools/sunbird) plugins.

Each plugin lives in its own top-level folder:

| Plugin | Source | Description |
|--------|--------|-------------|
| [fake-muted-deafen](fake-muted-deafen/) | [ValencedPlugins/fakemutedeafen](https://github.com/il1ll/ValencedPlugins/tree/main/plugins/fakemutedeafen) | Appear muted/deafened to others while still talking and hearing. Header menu + composer button. |
| [guild-profiles](guild-profiles/) | [wingio/plugins/GuildProfiles](https://github.com/wingio/plugins/tree/main/GuildProfiles) | Roles, mutual friends, blocked users and server features injected into the guild profile sheet. |
| [server-info](server-info/) | [WolfPlugs/valenced-plugins/server-info](https://github.com/WolfPlugs/valenced-plugins/tree/main/plugins/server-info) | Full server info: members, online, roles, channels, boosts, owner, created and friends. |

## Build / install

Bundle each `src/index.ts` with `web/tools/bundle-plugins.ts` from the sunbird
repo, then install the resulting `.js` through Settings → Phoenix Unlocker in
the patched Discord. The leading `// @` lines are the bundle metadata.

All plugins use only the public `phoenix` API described in
`crates/runtime/phoenix.d.ts`; see each plugin's README for device verification notes.

## Ready-to-install bundles

Pre-built `.js` bundles are in [`out/`](out/) — download the raw files:

| Plugin | Direct download |
|--------|-----------------|
| Fake Mute & Deafen | https://raw.githubusercontent.com/kerizalperwastaken/pho-test/main/out/fake-muted-deafen.js |
| GuildProfiles | https://raw.githubusercontent.com/kerizalperwastaken/pho-test/main/out/guild-profiles.js |
| Server Info | https://raw.githubusercontent.com/kerizalperwastaken/pho-test/main/out/server-info.js |

Install them on the phone with **Discord → Settings → Phoenix → Plugins → Install from URL**
(paste the raw link) or **Install from file** (download the `.js` first and pick it).
Then switch the plugin on in the same menu.
