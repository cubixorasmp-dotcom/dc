# Cubixora Discord Bot

Cubixora SMP için Discord moderasyon, destek, etkinlik, oyun kanalları ve Minecraft durum botu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-bot run dev` — run the Discord bot and webhook server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_TOKEN`
- Optional env: `OWNER_IDS`, `MC_WEBHOOK_SECRET`, `MC_HOST`, `MC_PORT`, `SITE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `services/discord-bot/src/index.ts` — Discord commands, events and interaction handlers
- `services/discord-bot/src/store.ts` — persistent guild settings and giveaway records
- `services/discord-bot/src/minecraft.ts` — Minecraft status and webhook event bridge
- `services/discord-bot/src/http.ts` — health check and `/mc/events`
- `render.yaml` — Render 24/7 worker configuration

## Architecture decisions

- Bot token is read only from environment secrets and is never committed.
- Guild settings are persisted in `data/config.json`; the data directory can be redirected with `DATA_DIR`.
- Minecraft status uses Bedrock query on port 19132; chat and punishment events arrive through a signed webhook.
- Render uses a worker service so it does not depend on an HTTP preview port for bot uptime.

## Product

Cubixora Discord Bot responds to Turkish greetings, shows Java/Bedrock server details, updates its Minecraft player-count presence, handles moderation and punishments, welcomes members, protects roles and links, creates tickets, runs giveaways and polls, validates word/number games, and forwards Minecraft events to Discord.

## User preferences

- User wants Turkish responses and does not want the Discord token written into source files.

## Gotchas

- Discord Developer Portal privileged intents must be enabled for message commands and automatic roles.
- Discord's native timeout maximum is 28 days; longer mute requests are capped at that limit.
- Replit can run the workflow for development, but Render worker is the reliable always-on host.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
