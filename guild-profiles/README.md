# GuildProfiles for Sunbird / Phoenix

Port of [wingio/plugins `GuildProfiles`](https://github.com/wingio/plugins/tree/main/GuildProfiles) (Aliucord/Java) to the Phoenix TypeScript plugin runtime.

## Nerede görünür?

Phoenix, Aliucord'daki `WidgetGuildProfileSheet.configureUI` hook'una karşılık gelen bir API sunmuyor. Bu yüzden plugin **sunucunun kendi profil sayfasına** buton ekleyemez. Aynı bilgiler şuradan açılır:

- **Sunucu kanalındayken üst bardaki "Guild profiles" butonu** → Roller / Ortak arkadaşlar / Engelli kullanıcılar / Sunucu özellikleri
- **Bir üyenin profili → "Guild" sekmesi** → o üyenin açık sunucudaki rolleri

## Original behaviour

The Aliucord plugin patched the Guild Profile sheet and added four actions:

- **Roles** — list the guild's roles, coloured by role colour
- **Mutual friends** — guild members you are friends with
- **Blocked users** — guild members you have blocked
- **Features** — the guild's enabled Discord features

## Phoenix port

This port uses only the public `phoenix` API:

- `ui.addHeaderButton` → picker with the four actions
- `phoenix.discord.get` → `/channels/{id}` (guild id), `/guilds/{id}/roles`,
  `/guilds/{id}/members`, `/users/@me/relationships`, `/guilds/{id}`
- `ui.showSheet` → native sheet showing the results
- `ui.addProfileTab` → the member's roles in the current server

Settings let you disable any of the four actions. No guessed cache tables are
used; the earlier `stores.sql` queries were removed because their table names
were unverified.
