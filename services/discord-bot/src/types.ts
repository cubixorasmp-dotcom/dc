export type GameUnit = "saniye" | "dakika" | "saat" | "gün";

export type TicketSettings = {
  staffRoleId: string;
  title: string;
  text: string;
};

export type GuildConfig = {
  prefix: string;
  siteUrl: string;
  maintenanceMode: boolean;
  autoRoleId?: string;
  welcomeChannelId?: string;
  goodbyeChannelId?: string;
  discordLogChannelId?: string;
  minecraftLogChannelId?: string;
  minecraftChatChannelId?: string;
  protectionRoleId?: string;
  protectionEnabled: boolean;
  linkProtectionEnabled: boolean;
  ticket?: TicketSettings;
  wordGames: Record<string, string>;
  numberGames: Record<string, number>;
};

export type GiveawayRecord = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  firstPrize: string;
  secondPrize?: string;
  winnerCount: number;
  endsAt: number;
};

export type StoreData = {
  guilds: Record<string, GuildConfig>;
  owners: string[];
  giveaways: GiveawayRecord[];
};