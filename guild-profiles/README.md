# GuildProfiles for Sunbird / Phoenix

Port of [wingio/plugins `GuildProfiles`](https://github.com/wingio/plugins/tree/main/GuildProfiles) (Aliucord/Java) to the Phoenix TypeScript plugin runtime.

## Original behaviour

The Aliucord plugin patched the Guild Profile sheet and added four actions:

- **Roles** — list the guild's roles, coloured by role colour
- **Mutual friends** — guild members you are friends with
- **Blocked users** — guild members you have blocked
- **Features** — the guild's enabled Discord features

Each opened a page listing the results, with avatars and a tap opening the user's profile.

## Phoenix port

Phoenix has no guild-profile-sheet patch API. This port uses the public plugin surface instead:

- `ui.addHeaderButton` → picker with the four actions
- `discord.get` → authenticated `/guilds/{id}/members` and `/guilds/{id}` calls
- `stores.sql` → read-only query over Phoenix's local role/relationship cache
- `ui.showSheet` → native sheet showing the results
- `ui.addProfileTab` → a small "Guild" tab on user profiles

Settings let you disable any of the four actions.

## Device verification needed

The local cache table names (`roles`, `relationships`) are inferred from the Phoenix
schema. Confirm on a device with the JS console:

1. Run `phoenix.stores.sql("SELECT name FROM sqlite_master WHERE type='table'")` and
   adjust the table/column names in `index.ts` if they differ.
2. Press the header button in a server channel → pick each action → the sheet
   should show roles / friends / blocked / features.

If the cache has no roles table, the roles query falls back to an empty list;
an alternative is to fetch `/guilds/{id}/roles` through `phoenix.discord` (needs
the Manage Roles permission on that server).
