# Cubixora Discord Bot

Cubixora SMP için Discord botu. Tek dosyalık dcs.js sürümü Render worker olarak çalışır.

## Render

1. Render'da bu GitHub deposunu seçin.
2. Render, render.yaml dosyasını okuyarak worker servisini oluşturur.
3. Environment Variables bölümüne DISCORD_TOKEN ekleyin. Tokenı GitHub'a yazmayın.
4. Discord Developer Portal'da Message Content Intent ve Server Members Intent seçeneklerini açın.
5. Deploy edin.

## Yerel çalıştırma

`npm install` ardından DISCORD_TOKEN değişkenini ekleyip `node dcs.js` çalıştırın.

## Komutlar

/ip, /aktif, /site, /profil, /sil, /ban, /mute, /cekilis, /anket, /ticket-kur, /kelime-kanal, /sayisayma, /koruma-rol, /likkoruma, /bakim ve owner komutları kullanılabilir. Prefix komutları e!ip, e!sil, e!ban, e!owner, e!profil, e!aktif ve e!site şeklindedir.

Minecraft durumu cubixorasmp.play.hosting:19132 üzerinden kontrol edilir. Minecraft olayları için /mc/events webhook'u kullanılır.
