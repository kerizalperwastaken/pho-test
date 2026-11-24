# Server Info for Sunbird / Phoenix

Birebir taşıma: [WolfPlugs/valenced-plugins `server-info`](https://github.com/WolfPlugs/valenced-plugins/tree/main/plugins/server-info).

## Referans ne yapıyordu?

Sunucu ikonuna long-press → guild context menu → **"Server Info"** maddesi → tam ekran sheet:

- banner + ikon + sunucu adı/açıklaması
- **Overview**: Members, Online, Roles, Channels, Boost Level
- **Server**: Owner (profili açılır), Created (snowflake'ten), ID
- **Friends in Server**: ilk 5 arkadaş + "Show all", her biri üye profilini açar

## Phoenix portu

Phoenix'te guild context-menu patch API'si ve sayfalarda görsel bölüm yok. Bu yüzden:

- **Giriş**: **sadece** üst bardaki "Server Info" butonu. Global basış/long-press hook'ları kaldırıldı — sunucu profilindeki her satırda tetiklenip her şeyi Server Info'ya çeviriyordu.
- **Veri**: `phoenix.discord.get` — `/channels/{id}`, `/guilds/{id}?with_counts=true`, `/guilds/{id}/roles`, `/guilds/{id}/channels`, `/users/@me/relationships`, `/guilds/{id}/members`, `/users/{ownerId}`
- **Sunum**: `ui.openPage` — Overview, Server ve Friends bölümleri; "Show all N friends" butonu sayfayı genişletilmiş olarak yeniden açar
- Banner/ikon URL'leri metin olarak gösterilir (Phoenix page API'sinde image bölümü yok)

## Ayarlar

- **Guild menu entry** — context menu'ye satır eklemeyi aç/kapat
- **Friends in server** — arkadaş listesini dahil et

Kurulum: `out/server-info.js` dosyasını Phoenix → Plugins → Install from URL ile yükle:

```
https://raw.githubusercontent.com/kerizalperwastaken/pho-test/main/out/server-info.js
```
