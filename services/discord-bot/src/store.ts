import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GiveawayRecord, GuildConfig, StoreData, TicketSettings } from "./types.js";

function createGuildConfig(): GuildConfig {
  return {
    prefix: process.env.PREFIX ?? "e!",
    siteUrl: process.env.SITE_URL ?? "https://cubixoraweb.onrender.com",
    maintenanceMode: false,
    protectionEnabled: false,
    linkProtectionEnabled: false,
    wordGames: {},
    numberGames: {},
  };
}

export class ConfigStore {
  private readonly filePath: string;
  private data: StoreData;

  constructor() {
    const directory = process.env.DATA_DIR ?? "data";
    this.filePath = join(directory, "config.json");
    mkdirSync(dirname(this.filePath), { recursive: true });

    try {
      this.data = JSON.parse(readFileSync(this.filePath, "utf8")) as StoreData;
      this.data.guilds ??= {};
      this.data.owners ??= [];
      this.data.giveaways ??= [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Ayar dosyası okunamadı: ${String(error)}`);
      }
      this.data = { guilds: {}, owners: [], giveaways: [] };
      this.save();
    }
  }

  private save(): void {
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }

  guild(guildId: string): GuildConfig {
    if (!this.data.guilds[guildId]) {
      this.data.guilds[guildId] = createGuildConfig();
      this.save();
    }
    return this.data.guilds[guildId];
  }

  updateGuild(guildId: string, update: Partial<GuildConfig>): GuildConfig {
    const config = this.guild(guildId);
    Object.assign(config, update);
    this.save();
    return config;
  }

  setTicket(guildId: string, ticket: TicketSettings): void {
    this.guild(guildId).ticket = ticket;
    this.save();
  }

  owners(): string[] {
    return [...this.data.owners];
  }

  addOwner(userId: string): void {
    if (!this.data.owners.includes(userId)) {
      this.data.owners.push(userId);
      this.save();
    }
  }

  removeOwner(userId: string): void {
    this.data.owners = this.data.owners.filter((id) => id !== userId);
    this.save();
  }

  isOwner(userId: string): boolean {
    const envOwners = (process.env.OWNER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return envOwners.includes(userId) || this.data.owners.includes(userId);
  }

  addGiveaway(record: GiveawayRecord): void {
    this.data.giveaways.push(record);
    this.save();
  }

  removeGiveaway(id: string): void {
    this.data.giveaways = this.data.giveaways.filter((giveaway) => giveaway.id !== id);
    this.save();
  }

  giveaways(): GiveawayRecord[] {
    return [...this.data.giveaways];
  }
}