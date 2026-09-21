# Cubixora Discord Bot

Cubixora SMP için Discord moderasyon, ticket, çekiliş, anket, oyun kanalları ve Minecraft durum botu.

## Çalıştırma

1. `.env.example` dosyasını örnek alıp gerekli değerleri Replit Secrets veya Render Environment Variables içine ekleyin.
2. `DISCORD_TOKEN` değerini yalnızca gizli değişken olarak ekleyin. Kodun içine veya GitHub'a yazmayın.
3. Replit'te `pnpm --filter @workspace/discord-bot run dev` çalışır.
4. Render için `render.yaml` worker servisini kullanın. Worker tipi seçildiği için web sunucusu beklemez; bot 7/24 çalışır.

## Gerekli Discord ayarları

Discord Developer Portal'da **Message Content Intent** ve **Server Members Intent** açılmalıdır. Botu sunucuya eklerken `bot` ve `applications.commands` kapsamlarını, moderasyon için gerekli izinlerle seçin.

## Komutlar

- Slash: `/ip`, `/aktif`, `/site`, `/profil`, `/sil`, `/ban`, `/mute`
- Sunucu: `/otorol-ayarla`, `/hosgeldin-kanal`, `/gulegule-kanal`, `/koruma-rol`, `/koruma-list`, `/koruma-cikar`
- Etkinlik: `/cekilis`, `/anket`, `/ticket-kur`
- Oyun: `/kelime-kanal`, `/sayisayma`
- Log: `/dc-ceza`, `/mc-ceza`, `/mcsohbet`
- Sistem: `/owner-ekle`, `/owner-list`, `/owner-cikar`, `/likkoruma`, `/likkormakapat`, `/bakim`, `/site-ekle`, `/site-cikar`
- Prefix: `!ip`, `e!ip`, `e!sil`, `e!ban`, `e!owner`, `e!profil`, `e!aktif`, `e!site`

Discord slash komut adları ASCII kuralı nedeniyle `hoşgeldin` yerine `/hosgeldin-kanal`, `çekiliş` yerine `/cekilis` olarak kayıt edilir.

## Minecraft bağlantısı

Bot `cubixorasmp.play.hosting:19132` Bedrock durumunu periyodik kontrol eder ve profilinde oyuncu sayısını gösterir. Minecraft giriş/çıkış/sohbet/ceza olaylarını Discord'a göndermek için botun `/mc/events` endpoint'ine aşağıdaki JSON ile POST atılabilir:

```json
{
  "type": "chat",
  "player": "Oyuncu",
  "message": "Merhaba"
}
```

İstekte `x-mc-webhook-secret` başlığı bulunmalı ve `MC_WEBHOOK_SECRET` ile aynı olmalıdır. `/mc-ceza` ceza logunu, `/mcsohbet` sohbet ve giriş-çıkış kanalını belirler.

## 24/7 çalışma notu

Telefonun kapanması botu etkilemez. Replit workflow ve Render worker süreci botu yeniden başlatır; ancak Discord token olmadan bot bağlanamaz. Replit'in uyku politikası varsa kesintisiz kullanım için Render worker'ı açık tutun.