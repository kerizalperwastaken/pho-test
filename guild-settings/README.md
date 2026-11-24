# Guild Settings for Sunbird / Phoenix

Sunucu ayarlarını metin olarak gösterir: overview, roller, kanallar, davetler, boost.

## Giriş
- Üst bardaki "Guild Settings" butonu (garanti)
- Sunucu ikonuna long-press → guild context menu → "Guild Settings" satırı (`guild.menu` düğümüne mount)
- Sunucu kimliği açık kanaldan alınır

## Veri
`/guilds/{id}?with_counts=true`, `/guilds/{id}/roles`, `/guilds/{id}/channels`, `/guilds/{id}/invites`

## Kurulum
```
https://raw.githubusercontent.com/kerizalperwastaken/pho-test/main/out/guild-settings.js
```
EOF