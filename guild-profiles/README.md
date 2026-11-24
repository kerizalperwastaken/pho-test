# GuildProfiles for Sunbird / Phoenix

Birebir port: [wingio/plugins `GuildProfiles`](https://github.com/wingio/plugins/tree/main/GuildProfiles) (Aliucord/Java) → Phoenix TypeScript.

## Referans ne yapıyordu?

`WidgetGuildProfileSheet.configureUI` method'unu patch'leyip **sunucu profili sheet'ine** dört aksiyon ekliyordu:

- **Roles** — sunucunun rolleri (rol rengiyle)
- **Mutual Friends** — bu sunucuda olan arkadaşların
- **Blocked Users** — bu sunucuda engellediğin kişiler
- **Features** — sunucunun Discord özellikleri

Her aksiyon sonuçları listeleyen bir sayfa açıyordu.

## Phoenix portu

Phoenix'te adlandırılmış guild-sheet patch target'ı yok. Bu yüzden plugin genel view API'sini kullanıyor:

1. `ui.onEvent("press", …)` — guild/sunucu vieweden bir basış olduğunda kısa bir pencere açılır.
2. `ui.onNode({prefix:""})` — yeni bir sheet düğümü oluştuğunda aynı pencere tetiklenir.
3. `ui.root()` + `ui.node(id)` — yeni açılan sheet bulunur.
4. `ui.mount(sheet, …)` — **"GuildProfiles" bölümü doğrudan o sunucu profili sheet'ine** eklenir.
5. `phoenix.discord.get` — `/channels/{id}`, `/guilds/{id}/roles`, `/guilds/{id}/members`, `/users/@me/relationships`, `/guilds/{id}` ile veriler okunur.
6. `ui.showSheet` — sonuçlar gösterilir.

Sunucu kimliği, basış olayındaki `channelId`'den alınır. Header butonu, Phoenix bazı sürümlerde guild basış olayı vermediği için yedek giriş noktasıdır.

## Ayarlar

Dört aksiyonun her biri açılıp kapatılabilir. **"Log sheet node ids"** ayarı, sheet açılırken tüm `accessibilityId` değerlerini JS console'a yazar.

## Cihazda doğrulama

1. Plugin'i kur ve bir sunucuda **sunucu adına / ikonuna bas** → sunucu profili açılırken üstte "GuildProfiles" bölümü ve dört satır görünmeli.
2. Görünmezse "Log sheet node ids" ayarını aç, sunucu profilini yeniden aç ve JS Console çıktısını gönder. Bu log ile doğru `accessibilityId` bulunup eşleme sabitlenecek.
3. "Roller" satırına bas → rol listesi; diğer satırlar arkadaş/engelli/özellik listelerini açmalı.
