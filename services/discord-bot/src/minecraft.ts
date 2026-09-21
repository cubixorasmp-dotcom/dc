import { statusBedrock } from "minecraft-server-util";
import type { Client, Guild } from "discord.js";
import type { ConfigStore } from "./store.js";

export type MinecraftEvent = {
  type: "join" | "leave" | "chat" | "ban" | "kick" | "mute";
  player?: string;
  message?: string;
  reason?: string;
};

export class MinecraftBridge {
  private readonly host = process.env.MC_HOST ?? "cubixorasmp.play.hosting";
  private readonly port = Number(process.env.MC_PORT ?? 19132);
  private readonly intervalMs = Number(process.env.MC_STATUS_INTERVAL_MS ?? 60_000);
  private timer?: NodeJS.Timeout;
  private lastOnline: number | null = null;
  private lastError = false;

  constructor(private readonly client: Client, private readonly store: ConfigStore) {}

  start(): void {
    void this.updatePresence();
    this.timer = setInterval(() => void this.updatePresence(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async status(): Promise<{ online: boolean; players: number; maxPlayers: number; version: string }> {
    const response = await statusBedrock(this.host, this.port, { timeout: 5_000 });
    return {
      online: true,
      players: response.players.online,
      maxPlayers: response.players.max,
      version: response.version.name,
    };
  }

  async updatePresence(): Promise<void> {
    try {
      const current = await this.status();
      this.lastOnline = current.players;
      this.lastError = false;
      this.client.user?.setPresence({
        activities: [{ name: `Minecraft: ${current.players}/${current.maxPlayers}`, type: 0 }],
        status: "online",
      });
    } catch {
      this.lastError = true;
      this.client.user?.setPresence({
        activities: [{ name: "Minecraft: Sunucu kapalı", type: 0 }],
        status: "idle",
      });
    }
  }

  summary(): string {
    if (this.lastError) return "Sunucu kapalı veya erişilemiyor";
    if (this.lastOnline === null) return "Durum kontrol ediliyor";
    return `${this.lastOnline} oyuncu çevrimiçi`;
  }

  async sendEvent(event: MinecraftEvent): Promise<void> {
    const typeLabel: Record<MinecraftEvent["type"], string> = {
      join: "giriş yaptı",
      leave: "çıkış yaptı",
      chat: "sohbete yazdı",
      ban: "banlandı",
      kick: "atıldı",
      mute: "susturuldu",
    };

    for (const guild of this.client.guilds.cache.values()) {
      const config = this.store.guild(guild.id);
      const channelId =
        event.type === "chat" ? config.minecraftChatChannelId : config.minecraftLogChannelId;
      if (!channelId) continue;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const detail = event.message ? `: ${event.message}` : event.reason ? `: ${event.reason}` : "";
      await channel
        .send(`**Minecraft** • ${event.player ?? "Bilinmeyen oyuncu"} ${typeLabel[event.type]}${detail}`)
        .catch(() => undefined);
    }
  }

  async serverStatusForGuild(guild: Guild): Promise<string> {
    const config = this.store.guild(guild.id);
    if (config.maintenanceMode) return "Bakım modu açık";
    return this.summary();
  }
}