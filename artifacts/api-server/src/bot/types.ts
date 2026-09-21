export type DurationUnit = "saniye" | "dakika" | "saat" | "gün";

export type GameMode = "kelime" | "sayma";

export interface GuildSettings {
  guildId: string;
  prefix: string;
  autoRoleId?: string;
  welcomeChannelId?: string;
  goodbyeChannelId?: string;
  protectionRoleId?: string;
  wordChannelId?: string;
  word?: string;
  countingChannelId?: string;
  countingNumber: number;
  lastGameUserId?: string;
  punishmentLogChannelId?: string;
  minecraftChatChannelId?: string;
  minecraftModerationChannelId?: string;
  linkProtection: boolean;
  maintenance: boolean;
  siteUrl?: string;
  ownerIds: string[];
  ticket?: {
    supportRoleId: string;
    title: string;
    text: string;
  };
}

export interface MinecraftEvent {
  type: "chat" | "join" | "leave" | "ban" | "kick" | "mute";
  player?: string;
  message?: string;
  reason?: string;
  server?: string;
}