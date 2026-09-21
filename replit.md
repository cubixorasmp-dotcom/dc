# Cubixora Discord Bot

7/24 çalışan Cubixora SMP Discord botu; moderasyon, koruma, ticket, oyun kanalları ve Minecraft durum/log özelliklerini yönetir.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — Discord botu ve sağlık API'sini birlikte çalıştırır
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN`
- Optional secret: `MC_WEBHOOK_SECRET` — Minecraft eklentisinden `/api/minecraft/event` çağrıları için

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/discord.ts` — Discord bağlantısı, slash/prefix komutları ve event handler'ları
- `artifacts/api-server/src/bot/store.ts` — sunucu ayarlarının JSON kalıcılığı
- `artifacts/api-server/src/bot/minecraft.ts` — Java/Bedrock durum kontrolü ve bot profili
- `artifacts/api-server/src/routes/minecraft.ts` — Minecraft chat/ceza webhook endpoint'i
- `artifacts/api-server/src/index.ts` — Express sağlık servisi ve Discord bot başlangıcı

## Architecture decisions

- Discord bağlantısı API Server workflow'ünün aynı uzun ömürlü Node sürecinde çalışır; telefon, tarayıcı veya yerel internet kesilse de yayınlanan süreç bağımsız kalır.
- Sunucu ayarları `data/guild-settings.json` dosyasına yazılır; canlı ayar dosyası Git'e gönderilmez.
- Slash komutları sunucuya özel kaydedilir; yeni komutlar anında görünür.
- Minecraft olayları yalnızca `MC_WEBHOOK_SECRET` ayarlıysa kabul edilir.

## Product

Moderasyon, hoş geldin/otorol, rol ve link koruması, çekiliş, anket, ticket, kelime/sayı oyunları, Discord/Minecraft log kanalları, site/IP bilgileri ve Minecraft oyuncu sayısını bot profilinde gösterme.

## User preferences

- Kullanıcı yanıtları Türkçe istiyor.

## Gotchas

- Minecraft sohbet ve ceza logları için Minecraft tarafında `MC_WEBHOOK_SECRET` ile `/api/minecraft/event` çağrısı yapan bir eklenti/bridge gerekir; bot tek başına Minecraft sunucusunun iç olaylarını okuyamaz.
- Discord Developer Portal'da Message Content Intent ve Server Members Intent açık olmalıdır.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
