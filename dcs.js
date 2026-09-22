// services/discord-bot/src/index.ts
import "dotenv/config";
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

// services/discord-bot/src/store.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
function createGuildConfig() {
  return {
    prefix: process.env.PREFIX ?? "e!",
    siteUrl: process.env.SITE_URL ?? "https://cubixoraweb.onrender.com",
    maintenanceMode: false,
    protectionEnabled: false,
    linkProtectionEnabled: false,
    wordGames: {},
    numberGames: {}
  };
}
var ConfigStore = class {
  filePath;
  data;
  constructor() {
    const directory = process.env.DATA_DIR ?? "data";
    this.filePath = join(directory, "config.json");
    mkdirSync(dirname(this.filePath), { recursive: true });
    try {
      this.data = JSON.parse(readFileSync(this.filePath, "utf8"));
      this.data.guilds ??= {};
      this.data.owners ??= [];
      this.data.giveaways ??= [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Ayar dosyas\u0131 okunamad\u0131: ${String(error)}`);
      }
      this.data = { guilds: {}, owners: [], giveaways: [] };
      this.save();
    }
  }
  save() {
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}
`, "utf8");
  }
  guild(guildId) {
    if (!this.data.guilds[guildId]) {
      this.data.guilds[guildId] = createGuildConfig();
      this.save();
    }
    return this.data.guilds[guildId];
  }
  updateGuild(guildId, update) {
    const config = this.guild(guildId);
    Object.assign(config, update);
    this.save();
    return config;
  }
  setTicket(guildId, ticket) {
    this.guild(guildId).ticket = ticket;
    this.save();
  }
  owners() {
    return [...this.data.owners];
  }
  addOwner(userId) {
    if (!this.data.owners.includes(userId)) {
      this.data.owners.push(userId);
      this.save();
    }
  }
  removeOwner(userId) {
    this.data.owners = this.data.owners.filter((id) => id !== userId);
    this.save();
  }
  isOwner(userId) {
    const envOwners = (process.env.OWNER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    return envOwners.includes(userId) || this.data.owners.includes(userId);
  }
  addGiveaway(record) {
    this.data.giveaways.push(record);
    this.save();
  }
  removeGiveaway(id) {
    this.data.giveaways = this.data.giveaways.filter((giveaway) => giveaway.id !== id);
    this.save();
  }
  giveaways() {
    return [...this.data.giveaways];
  }
};

// services/discord-bot/src/minecraft.ts
import { statusBedrock } from "minecraft-server-util";
var MinecraftBridge = class {
  constructor(client2, store2) {
    this.client = client2;
    this.store = store2;
  }
  client;
  store;
  host = process.env.MC_HOST ?? "cubixorasmp.play.hosting";
  port = Number(process.env.MC_PORT ?? 19132);
  intervalMs = Number(process.env.MC_STATUS_INTERVAL_MS ?? 6e4);
  timer;
  lastOnline = null;
  lastError = false;
  start() {
    void this.updatePresence();
    this.timer = setInterval(() => void this.updatePresence(), this.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  async status() {
    const response = await statusBedrock(this.host, this.port, { timeout: 5e3 });
    return {
      online: true,
      players: response.players.online,
      maxPlayers: response.players.max,
      version: response.version.name
    };
  }
  async updatePresence() {
    try {
      const current = await this.status();
      this.lastOnline = current.players;
      this.lastError = false;
      this.client.user?.setPresence({
        activities: [{ name: `Minecraft: ${current.players}/${current.maxPlayers}`, type: 0 }],
        status: "online"
      });
    } catch {
      this.lastError = true;
      this.client.user?.setPresence({
        activities: [{ name: "Minecraft: Sunucu kapal\u0131", type: 0 }],
        status: "idle"
      });
    }
  }
  summary() {
    if (this.lastError) return "Sunucu kapal\u0131 veya eri\u015Filemiyor";
    if (this.lastOnline === null) return "Durum kontrol ediliyor";
    return `${this.lastOnline} oyuncu \xE7evrimi\xE7i`;
  }
  async sendEvent(event) {
    const typeLabel = {
      join: "giri\u015F yapt\u0131",
      leave: "\xE7\u0131k\u0131\u015F yapt\u0131",
      chat: "sohbete yazd\u0131",
      ban: "banland\u0131",
      kick: "at\u0131ld\u0131",
      mute: "susturuldu"
    };
    for (const guild of this.client.guilds.cache.values()) {
      const config = this.store.guild(guild.id);
      const channelId = event.type === "chat" ? config.minecraftChatChannelId : config.minecraftLogChannelId;
      if (!channelId) continue;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const detail = event.message ? `: ${event.message}` : event.reason ? `: ${event.reason}` : "";
      await channel.send(`**Minecraft** \u2022 ${event.player ?? "Bilinmeyen oyuncu"} ${typeLabel[event.type]}${detail}`).catch(() => void 0);
    }
  }
  async serverStatusForGuild(guild) {
    const config = this.store.guild(guild.id);
    if (config.maintenanceMode) return "Bak\u0131m modu a\xE7\u0131k";
    return this.summary();
  }
};

// services/discord-bot/src/http.ts
import { createServer } from "node:http";
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
function startHttpServer(bridge) {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { ok: true, service: "cubixora-discord-bot" });
      return;
    }
    if (request.method === "POST" && request.url === "/mc/events") {
      const secret = process.env.MC_WEBHOOK_SECRET;
      if (!secret || request.headers["x-mc-webhook-secret"] !== secret) {
        sendJson(response, 401, { ok: false, error: "Yetkisiz webhook" });
        return;
      }
      try {
        const event = JSON.parse(await readBody(request));
        if (!["join", "leave", "chat", "ban", "kick", "mute"].includes(event.type)) {
          sendJson(response, 400, { ok: false, error: "Ge\xE7ersiz olay t\xFCr\xFC" });
          return;
        }
        await bridge.sendEvent(event);
        sendJson(response, 202, { ok: true });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error) });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: "Bulunamad\u0131" });
  });
  const port = Number(process.env.PORT ?? 3e3);
  server.listen(port, "0.0.0.0", () => {
    console.info(`HTTP sa\u011Fl\u0131k/webhook sunucusu ${port} portunda haz\u0131r`);
  });
  return server;
}

// services/discord-bot/src/utils.ts
var unitMs = {
  saniye: 1e3,
  dakika: 6e4,
  saat: 36e5,
  g\u00FCn: 864e5
};
function parseDuration(amount, unit) {
  const normalized = unit.toLocaleLowerCase("tr-TR").replace("\xFC", "u");
  const map = {
    saniye: "saniye",
    second: "saniye",
    seconds: "saniye",
    dakika: "dakika",
    minute: "dakika",
    minutes: "dakika",
    saat: "saat",
    hour: "saat",
    hours: "saat",
    gun: "g\xFCn",
    g\u00FCn: "g\xFCn",
    day: "g\xFCn",
    days: "g\xFCn"
  };
  const resolved = map[normalized];
  return resolved && Number.isFinite(amount) && amount > 0 ? amount * unitMs[resolved] : null;
}
function durationText(amount, unit) {
  return `${amount} ${unit}`;
}
function trimReason(reason, fallback = "Belirtilmedi") {
  return reason?.trim() || fallback;
}
function safeChannelName(input) {
  return input.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 90) || "ticket";
}
function isUrl(text) {
  return /(https?:\/\/|discord\.gg\/|www\.)\S+/i.test(text);
}
function normalizeText(text) {
  return text.trim().toLocaleLowerCase("tr-TR");
}

// services/discord-bot/src/index.ts
var rawToken = process.env.DISCORD_TOKEN?.trim();
var normalizedToken = rawToken?.replace(/^Bot\s+/i, "");
if (!normalizedToken) {
  throw new Error("DISCORD_TOKEN eksik. Replit Secrets veya Render Environment Variables i\xE7ine ekleyin.");
}
var discordToken = normalizedToken;
var client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});
var store = new ConfigStore();
var minecraft = new MinecraftBridge(client, store);
var commands = [
  new SlashCommandBuilder().setName("ip").setDescription("Cubixora SMP sunucu bilgilerini g\xF6sterir"),
  new SlashCommandBuilder().setName("otorol-ayarla").setDescription("Sunucuya girenlere otomatik verilecek rol\xFC ayarlar").addRoleOption((option) => option.setName("rol").setDescription("Otomatik rol").setRequired(true)),
  new SlashCommandBuilder().setName("otorol-kapat").setDescription("Otomatik rol sistemini kapat\u0131r"),
  new SlashCommandBuilder().setName("sil").setDescription("1 ile 1000 aras\u0131nda mesaj siler").addIntegerOption(
    (option) => option.setName("miktar").setDescription("Silinecek mesaj say\u0131s\u0131").setMinValue(1).setMaxValue(1e3).setRequired(true)
  ),
  new SlashCommandBuilder().setName("ban").setDescription("\xDCyeyi sunucudan yasaklar").addUserOption((option) => option.setName("\xFCye").setDescription("Yasaklanacak \xFCye").setRequired(true)).addStringOption((option) => option.setName("sebep").setDescription("Ban sebebi").setRequired(true)),
  new SlashCommandBuilder().setName("mute").setDescription("\xDCyeyi s\xFCreli susturur").addUserOption((option) => option.setName("\xFCye").setDescription("Susturulacak \xFCye").setRequired(true)).addIntegerOption((option) => option.setName("s\xFCre").setDescription("S\xFCre").setMinValue(1).setRequired(true)).addStringOption(
    (option) => option.setName("birim").setDescription("S\xFCre birimi").setRequired(true).addChoices(
      { name: "Saniye", value: "saniye" },
      { name: "Dakika", value: "dakika" },
      { name: "Saat", value: "saat" },
      { name: "G\xFCn", value: "g\xFCn" }
    )
  ).addStringOption((option) => option.setName("sebep").setDescription("Mute sebebi")),
  new SlashCommandBuilder().setName("hosgeldin-kanal").setDescription("Ho\u015F geldin kanal\u0131n\u0131 ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("gulegule-kanal").setDescription("G\xFCle g\xFCle kanal\u0131n\u0131 ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("koruma-rol").setDescription("Etiketlenen rol\xFC koruma sistemine ekler").addRoleOption((option) => option.setName("rol").setDescription("Korunacak rol").setRequired(true)),
  new SlashCommandBuilder().setName("koruma-list").setDescription("Koruma rol\xFCn\xFC g\xF6sterir"),
  new SlashCommandBuilder().setName("koruma-cikar").setDescription("Koruma rol\xFCn\xFC kald\u0131r\u0131r"),
  new SlashCommandBuilder().setName("cekilis").setDescription("\xC7ekili\u015F ba\u015Flat\u0131r").addStringOption((option) => option.setName("ba\u015Fl\u0131k").setDescription("\xC7ekili\u015F ba\u015Fl\u0131\u011F\u0131").setRequired(true)).addStringOption((option) => option.setName("\xF6d\xFCl").setDescription("Birinci \xF6d\xFCl").setRequired(true)).addStringOption((option) => option.setName("ikinci-\xF6d\xFCl").setDescription("\u0130kinci \xF6d\xFCl")).addIntegerOption((option) => option.setName("kazanan-say\u0131s\u0131").setDescription("Kazanan say\u0131s\u0131").setMinValue(1).setMaxValue(50).setRequired(true)).addIntegerOption((option) => option.setName("s\xFCre").setDescription("S\xFCre").setMinValue(1).setRequired(true)).addStringOption(
    (option) => option.setName("birim").setDescription("S\xFCre birimi").setRequired(true).addChoices(
      { name: "Dakika", value: "dakika" },
      { name: "Saat", value: "saat" },
      { name: "G\xFCn", value: "g\xFCn" }
    )
  ),
  new SlashCommandBuilder().setName("anket").setDescription("En az iki se\xE7enekli anket ba\u015Flat\u0131r").addStringOption((option) => option.setName("ba\u015Fl\u0131k").setDescription("Anket ba\u015Fl\u0131\u011F\u0131").setRequired(true)).addStringOption((option) => option.setName("se\xE7enek-1").setDescription("Birinci se\xE7enek").setRequired(true)).addStringOption((option) => option.setName("se\xE7enek-2").setDescription("\u0130kinci se\xE7enek").setRequired(true)).addStringOption((option) => option.setName("se\xE7enek-3").setDescription("\xDC\xE7\xFCnc\xFC se\xE7enek")).addStringOption((option) => option.setName("se\xE7enek-4").setDescription("D\xF6rd\xFCnc\xFC se\xE7enek")).addIntegerOption((option) => option.setName("s\xFCre").setDescription("S\xFCre, 0 ise s\xFCresiz").setMinValue(0).setRequired(true)).addStringOption(
    (option) => option.setName("birim").setDescription("S\xFCre birimi").setRequired(true).addChoices(
      { name: "Dakika", value: "dakika" },
      { name: "Saat", value: "saat" },
      { name: "G\xFCn", value: "g\xFCn" }
    )
  ),
  new SlashCommandBuilder().setName("ticket-kur").setDescription("Ticket sistemini kurar").addRoleOption((option) => option.setName("yetkili").setDescription("Ticket yetkili rol\xFC").setRequired(true)).addStringOption((option) => option.setName("ba\u015Fl\u0131k").setDescription("Ticket ba\u015Fl\u0131\u011F\u0131").setRequired(true)).addStringOption((option) => option.setName("metin").setDescription("Ticket a\xE7\u0131klamas\u0131").setRequired(true)),
  new SlashCommandBuilder().setName("kelime-kanal").setDescription("Kelime oyununu a\xE7ar").addChannelOption((option) => option.setName("kanal").setDescription("Oyun kanal\u0131").addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption((option) => option.setName("kelime").setDescription("Ba\u015Flang\u0131\xE7 kelimesi").setRequired(true)),
  new SlashCommandBuilder().setName("sayisayma").setDescription("Say\u0131 sayma oyununu a\xE7ar").addChannelOption((option) => option.setName("kanal").setDescription("Oyun kanal\u0131").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("dc-ceza").setDescription("Discord ceza log kanal\u0131n\u0131 ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Log kanal\u0131").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("mc-ceza").setDescription("Minecraft ceza log kanal\u0131n\u0131 ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Log kanal\u0131").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("mcsohbet").setDescription("Minecraft sohbet/giri\u015F \xE7\u0131k\u0131\u015F kanal\u0131n\u0131 ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("owner-ekle").setDescription("Bot owner listesine \xFCye ekler").addUserOption((option) => option.setName("\xFCye").setDescription("Owner yap\u0131lacak \xFCye").setRequired(true)),
  new SlashCommandBuilder().setName("owner-list").setDescription("Bot owner listesini g\xF6sterir"),
  new SlashCommandBuilder().setName("owner-cikar").setDescription("Bot owner listesinden \xFCye \xE7\u0131kar\u0131r").addUserOption((option) => option.setName("\xFCye").setDescription("\xC7\u0131kar\u0131lacak \xFCye").setRequired(true)),
  new SlashCommandBuilder().setName("likkoruma").setDescription("Link korumas\u0131n\u0131 a\xE7ar"),
  new SlashCommandBuilder().setName("likkormakapat").setDescription("Link korumas\u0131n\u0131 kapat\u0131r"),
  new SlashCommandBuilder().setName("bakim").setDescription("Minecraft bak\u0131m modunu ayarlar").addStringOption(
    (option) => option.setName("durum").setDescription("Bak\u0131m durumu").setRequired(true).addChoices({ name: "A\xE7\u0131k", value: "acik" }, { name: "Kapal\u0131", value: "kapali" })
  ),
  new SlashCommandBuilder().setName("aktif").setDescription("Minecraft sunucu durumunu g\xF6sterir"),
  new SlashCommandBuilder().setName("site").setDescription("Cubixora web sitesini g\xF6sterir"),
  new SlashCommandBuilder().setName("site-ekle").setDescription("Site adresini ayarlar").addStringOption((option) => option.setName("adres").setDescription("HTTPS site adresi").setRequired(true)),
  new SlashCommandBuilder().setName("site-cikar").setDescription("Site adresini varsay\u0131lana d\xF6nd\xFCr\xFCr"),
  new SlashCommandBuilder().setName("profil").setDescription("Oyuncunun Discord profil foto\u011Fraf\u0131n\u0131 g\xF6sterir").addUserOption((option) => option.setName("\xFCye").setDescription("\xDCye")),
  new SlashCommandBuilder().setName("yardim").setDescription("Bot komutlar\u0131n\u0131 g\xF6sterir")
].map((command) => command.toJSON());
function guildMember(interaction) {
  return interaction.guild?.members.cache.get(interaction.user.id) ?? null;
}
function canManage(member, permission) {
  return Boolean(member?.permissions.has(permission));
}
function isBotOwner(userId) {
  return store.isOwner(userId);
}
async function logDiscord(guildId, text) {
  const guild = client.guilds.cache.get(guildId);
  const channelId = store.guild(guildId).discordLogChannelId;
  if (!guild || !channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(`**Discord log** \u2022 ${text}`).catch(() => void 0);
}
async function deleteMessages(channel, amount) {
  let remaining = amount;
  let deleted = 0;
  while (remaining > 0) {
    const chunk = Math.min(100, remaining);
    const messages = await channel.bulkDelete(chunk, true);
    deleted += messages.size;
    remaining -= chunk;
    if (messages.size < chunk) break;
  }
  return deleted;
}
async function applyMute(member, durationMs, reason) {
  const maximum = 28 * 24 * 60 * 60 * 1e3;
  await member.timeout(Math.min(durationMs, maximum), reason);
}
async function finishGiveaway(id) {
  const record = store.giveaways().find((giveaway) => giveaway.id === id);
  if (!record) return;
  const channel = await client.channels.fetch(record.channelId).catch(() => null);
  const message = channel?.isTextBased() ? await channel.messages.fetch(record.messageId).catch(() => null) : null;
  const reaction = message?.reactions.cache.get("\u{1F389}");
  const users = reaction ? [...(await reaction.users.fetch()).values()].filter((user) => !user.bot) : [];
  const winners = users.sort(() => Math.random() - 0.5).slice(0, record.winnerCount);
  const mention = winners.length ? winners.map((winner) => `<@${winner.id}>`).join(", ") : "Yeterli kat\u0131l\u0131m olmad\u0131.";
  await message?.edit({ content: `\u{1F389} **\xC7ekili\u015F bitti!**
Kazananlar: ${mention}
\xD6d\xFCl: **${record.firstPrize}**${record.secondPrize ? `
\u0130kinci \xF6d\xFCl: **${record.secondPrize}**` : ""}` }).catch(() => void 0);
  if (message?.channel.isTextBased() && "send" in message.channel) {
    await message.channel.send(`\u{1F389} Tebrikler ${mention}!`).catch(() => void 0);
  }
  store.removeGiveaway(id);
}
function scheduleGiveaway(id, delay) {
  if (delay <= 2147e6) {
    setTimeout(() => void finishGiveaway(id), Math.max(0, delay));
    return;
  }
  setTimeout(() => scheduleGiveaway(id, delay - 2147e6), 2147e6);
}
async function handleCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Bu komut yaln\u0131zca sunucuda kullan\u0131labilir.", ephemeral: true });
    return;
  }
  const config = store.guild(interaction.guild.id);
  const member = guildMember(interaction);
  const command = interaction.commandName;
  if (command === "yardim") {
    await interaction.reply("Komutlar: `/ip`, `/aktif`, `/site`, `/profil`, `/sil`, `/ban`, `/mute`, `/cekilis`, `/anket`, `/ticket-kur`, `/kelime-kanal`, `/sayisayma`, `/koruma-rol`, `/likkoruma` ve `/bakim`.");
    return;
  }
  if (command === "ip") {
    await interaction.reply(`**Cubixora SMP**
Java: \`cubixorasmp.play.hosting\` \u2022 S\xFCr\xFCm: \`1.16.5\`
Bedrock: \`cubixorasmp.play.hosting\` \u2022 Port: \`19132\``);
    return;
  }
  if (command === "aktif") {
    await interaction.reply(`**Sunucu durumu:** ${await minecraft.serverStatusForGuild(interaction.guild)}`);
    return;
  }
  if (command === "site") {
    await interaction.reply(config.siteUrl);
    return;
  }
  if (command === "profil") {
    const user = interaction.options.getUser("\xFCye") ?? interaction.user;
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${user.username} profili`).setImage(user.displayAvatarURL({ size: 1024 })).setColor(5793266)] });
    return;
  }
  if (command === "owner-list") {
    const owners = store.owners();
    await interaction.reply(owners.length ? `Owner listesi: ${owners.map((id) => `<@${id}>`).join(", ")}` : "Hen\xFCz eklenmi\u015F owner yok.");
    return;
  }
  if (command === "owner-ekle" || command === "owner-cikar") {
    if (!isBotOwner(interaction.user.id)) {
      await interaction.reply({ content: "Bu i\u015Flem yaln\u0131zca bot owner i\xE7in kullan\u0131labilir.", ephemeral: true });
      return;
    }
    const user = interaction.options.getUser("\xFCye", true);
    if (command === "owner-ekle") store.addOwner(user.id);
    else store.removeOwner(user.id);
    await interaction.reply(`${user} ${command === "owner-ekle" ? "owner listesine eklendi." : "owner listesinden \xE7\u0131kar\u0131ld\u0131."}`);
    return;
  }
  if (command === "otorol-ayarla") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    const role = interaction.options.getRole("rol", true);
    store.updateGuild(interaction.guild.id, { autoRoleId: role.id });
    await interaction.reply(`Otomatik rol **${role.name}** olarak ayarland\u0131.`);
    return;
  }
  if (command === "otorol-kapat") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    store.updateGuild(interaction.guild.id, { autoRoleId: void 0 });
    await interaction.reply("Otomatik rol kapat\u0131ld\u0131.");
    return;
  }
  if (command === "hosgeldin-kanal" || command === "gulegule-kanal") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    store.updateGuild(interaction.guild.id, command === "hosgeldin-kanal" ? { welcomeChannelId: channel.id } : { goodbyeChannelId: channel.id });
    await interaction.reply(`${channel} ${command === "hosgeldin-kanal" ? "ho\u015F geldin" : "g\xFCle g\xFCle"} kanal\u0131 oldu.`);
    return;
  }
  if (command === "koruma-rol" || command === "koruma-list" || command === "koruma-cikar") {
    if (command !== "koruma-list" && !canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    if (command === "koruma-rol") {
      const role = interaction.options.getRole("rol", true);
      store.updateGuild(interaction.guild.id, { protectionRoleId: role.id, protectionEnabled: true });
      await interaction.reply(`Koruma rol\xFC **${role.name}** olarak ayarland\u0131.`);
    } else if (command === "koruma-list") {
      const role = config.protectionRoleId ? await interaction.guild.roles.fetch(config.protectionRoleId).catch(() => null) : null;
      await interaction.reply(role ? `Korunan rol: ${role}` : "Koruma rol\xFC ayarl\u0131 de\u011Fil.");
    } else {
      store.updateGuild(interaction.guild.id, { protectionRoleId: void 0, protectionEnabled: false });
      await interaction.reply("Koruma rol\xFC kald\u0131r\u0131ld\u0131.");
    }
    return;
  }
  if (command === "sil") {
    if (!canManage(member, PermissionFlagsBits.ManageMessages)) return void interaction.reply({ content: "Mesajlar\u0131 Y\xF6net yetkisi gerekli.", ephemeral: true });
    const amount = interaction.options.getInteger("miktar", true);
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased()) return void interaction.reply({ content: "Bu kanalda kullan\u0131lamaz.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const deleted = await deleteMessages(channel, amount);
    await interaction.editReply(`${deleted} mesaj silindi.`);
    await logDiscord(interaction.guild.id, `${interaction.user} ${deleted} mesaj sildi.`);
    return;
  }
  if (command === "ban") {
    if (!canManage(member, PermissionFlagsBits.BanMembers)) return void interaction.reply({ content: "\xDCyeleri Yasakla yetkisi gerekli.", ephemeral: true });
    const user = interaction.options.getUser("\xFCye", true);
    const reason = trimReason(interaction.options.getString("sebep") ?? void 0);
    await interaction.guild.members.ban(user, { reason });
    await interaction.reply(`${user.tag} yasakland\u0131. Sebep: ${reason}`);
    await logDiscord(interaction.guild.id, `${user.tag} ${interaction.user} taraf\u0131ndan banland\u0131. Sebep: ${reason}`);
    return;
  }
  if (command === "mute") {
    if (!canManage(member, PermissionFlagsBits.ModerateMembers)) return void interaction.reply({ content: "\xDCyelere Zaman A\u015F\u0131m\u0131 Uygula yetkisi gerekli.", ephemeral: true });
    const user = interaction.options.getUser("\xFCye", true);
    const target = await interaction.guild.members.fetch(user.id);
    const amount = interaction.options.getInteger("s\xFCre", true);
    const unit = interaction.options.getString("birim", true);
    const milliseconds = parseDuration(amount, unit);
    if (!milliseconds) return void interaction.reply({ content: "Ge\xE7ersiz s\xFCre.", ephemeral: true });
    const reason = trimReason(interaction.options.getString("sebep") ?? void 0);
    await applyMute(target, milliseconds, reason);
    await interaction.reply(`${user.tag} ${durationText(amount, unit)} susturuldu. Sebep: ${reason}`);
    await logDiscord(interaction.guild.id, `${user.tag} ${interaction.user} taraf\u0131ndan susturuldu. Sebep: ${reason}`);
    return;
  }
  if (command === "dc-ceza" || command === "mc-ceza" || command === "mcsohbet") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    const update = command === "dc-ceza" ? { discordLogChannelId: channel.id } : command === "mc-ceza" ? { minecraftLogChannelId: channel.id } : { minecraftChatChannelId: channel.id };
    store.updateGuild(interaction.guild.id, update);
    await interaction.reply(`${channel} kanal\u0131na ${command} ayar\u0131 yap\u0131ld\u0131.`);
    return;
  }
  if (command === "likkoruma" || command === "likkormakapat") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    store.updateGuild(interaction.guild.id, { linkProtectionEnabled: command === "likkoruma" });
    await interaction.reply(`Link korumas\u0131 ${command === "likkoruma" ? "a\xE7\u0131ld\u0131" : "kapat\u0131ld\u0131"}.`);
    return;
  }
  if (command === "bakim") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    const enabled = interaction.options.getString("durum", true) === "acik";
    store.updateGuild(interaction.guild.id, { maintenanceMode: enabled });
    await interaction.reply(`Bak\u0131m modu ${enabled ? "a\xE7\u0131ld\u0131" : "kapat\u0131ld\u0131"}.`);
    return;
  }
  if (command === "site-ekle" || command === "site-cikar") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Y\xF6net yetkisi gerekli.", ephemeral: true });
    const url = command === "site-ekle" ? interaction.options.getString("adres", true) : "https://cubixoraweb.onrender.com";
    if (command === "site-ekle" && !/^https:\/\//i.test(url)) return void interaction.reply({ content: "Site adresi https:// ile ba\u015Flamal\u0131.", ephemeral: true });
    store.updateGuild(interaction.guild.id, { siteUrl: url });
    await interaction.reply(`Site adresi: ${url}`);
    return;
  }
  if (command === "kelime-kanal") {
    if (!canManage(member, PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Kanallar\u0131 Y\xF6net yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    const word = normalizeText(interaction.options.getString("kelime", true));
    config.wordGames[channel.id] = word;
    store.updateGuild(interaction.guild.id, { wordGames: config.wordGames });
    await interaction.reply(`${channel} kelime oyunu a\xE7\u0131ld\u0131. \u0130lk kelime: **${word}**. Ayn\u0131 ki\u015Fi \xFCst \xFCste yazamaz.`);
    return;
  }
  if (command === "sayisayma") {
    if (!canManage(member, PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Kanallar\u0131 Y\xF6net yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    config.numberGames[channel.id] = 0;
    store.updateGuild(interaction.guild.id, { numberGames: config.numberGames });
    await interaction.reply(`${channel} say\u0131 sayma oyunu a\xE7\u0131ld\u0131. 1'den ba\u015Flay\u0131n.`);
    return;
  }
  if (command === "ticket-kur") {
    if (!canManage(member, PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Kanallar\u0131 Y\xF6net yetkisi gerekli.", ephemeral: true });
    const role = interaction.options.getRole("yetkili", true);
    store.setTicket(interaction.guild.id, {
      staffRoleId: role.id,
      title: interaction.options.getString("ba\u015Fl\u0131k", true),
      text: interaction.options.getString("metin", true)
    });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket-open").setLabel("Ticket A\xE7").setStyle(ButtonStyle.Primary));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(config.ticket?.title ?? "Destek Talebi").setDescription(config.ticket?.text ?? "Destek almak i\xE7in butona t\u0131klay\u0131n.").setColor(5793266)], components: [row] });
    return;
  }
  if (command === "anket") {
    const choices = [1, 2, 3, 4].map((index) => interaction.options.getString(`se\xE7enek-${index}`)).filter((choice) => Boolean(choice));
    const title = interaction.options.getString("ba\u015Fl\u0131k", true);
    const amount = interaction.options.getInteger("s\xFCre", true);
    const unit = interaction.options.getString("birim", true);
    const duration = amount === 0 ? null : parseDuration(amount, unit);
    const embed = new EmbedBuilder().setTitle(`\u{1F4CA} ${title}`).setDescription(choices.map((choice, index) => `${["1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3", "4\uFE0F\u20E3"][index]} ${choice}`).join("\n")).setColor(5763719).setFooter({ text: duration ? `${amount} ${unit} sonra kapan\u0131r` : "S\xFCresiz anket" });
    const message = await interaction.reply({ embeds: [embed], fetchReply: true });
    for (let index = 0; index < choices.length; index++) await message.react(["1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3", "4\uFE0F\u20E3"][index]);
    if (duration) setTimeout(() => message.edit({ content: "Anket s\xFCresi doldu.", embeds: [embed] }).catch(() => void 0), duration);
    return;
  }
  if (command === "cekilis") {
    const amount = interaction.options.getInteger("s\xFCre", true);
    const unit = interaction.options.getString("birim", true);
    const duration = parseDuration(amount, unit);
    if (!duration) return void interaction.reply({ content: "Ge\xE7ersiz \xE7ekili\u015F s\xFCresi.", ephemeral: true });
    const firstPrize = interaction.options.getString("\xF6d\xFCl", true);
    const secondPrize = interaction.options.getString("ikinci-\xF6d\xFCl") ?? void 0;
    const winnerCount = interaction.options.getInteger("kazanan-say\u0131s\u0131", true);
    const title = interaction.options.getString("ba\u015Fl\u0131k", true);
    const end = Date.now() + duration;
    const embed = new EmbedBuilder().setTitle(`\u{1F389} ${title}`).setDescription(`\xD6d\xFCl: **${firstPrize}**${secondPrize ? `
\u0130kinci \xF6d\xFCl: **${secondPrize}**` : ""}
Kat\u0131lmak i\xE7in \u{1F389} tepkisine bas\u0131n.`).setColor(16762967).setFooter({ text: `${winnerCount} kazanan \u2022 ${amount} ${unit}` });
    const message = await interaction.reply({ embeds: [embed], fetchReply: true });
    await message.react("\u{1F389}");
    const id = `${interaction.guild.id}-${message.id}`;
    store.addGiveaway({ id, guildId: interaction.guild.id, channelId: message.channel.id, messageId: message.id, firstPrize, secondPrize, winnerCount, endsAt: end });
    scheduleGiveaway(id, duration);
    return;
  }
}
async function handlePrefix(message) {
  const content = message.content.trim();
  const lower = content.toLocaleLowerCase("tr-TR");
  if (["sa", "s.a"].includes(lower)) {
    await message.reply("Aleyk\xFCm Selam Ho\u015F Geldin!");
    return;
  }
  const config = store.guild(message.guild.id);
  if (!lower.startsWith(config.prefix.toLocaleLowerCase("tr-TR"))) return;
  const [rawCommand, ...args] = content.slice(config.prefix.length).trim().split(/\s+/);
  const command = rawCommand?.toLocaleLowerCase("tr-TR");
  if (command === "ip") await message.reply("Java: `cubixorasmp.play.hosting` s\xFCr\xFCm `1.16.5` \u2022 Bedrock port `19132`");
  else if (command === "site") await message.reply(config.siteUrl);
  else if (command === "aktif") await message.reply(`Sunucu: ${await minecraft.serverStatusForGuild(message.guild)}`);
  else if (command === "owner") await message.reply(store.owners().length ? store.owners().map((id) => `<@${id}>`).join(", ") : "Owner yok.");
  else if (command === "profil") {
    const user = message.mentions.users.first() ?? message.author;
    await message.reply({ embeds: [new EmbedBuilder().setTitle(`${user.username} profili`).setImage(user.displayAvatarURL({ size: 1024 })).setColor(5793266)] });
  } else if (command === "sil" && canManage(await message.guild.members.fetch(message.author.id), PermissionFlagsBits.ManageMessages)) {
    const amount = Math.min(1e3, Math.max(1, Number(args[0] ?? 1)));
    if (message.channel.isTextBased() && !message.channel.isDMBased()) {
      const deleted = await deleteMessages(message.channel, amount);
      await message.channel.send(`${deleted} mesaj silindi.`).then((sent) => setTimeout(() => sent.delete().catch(() => void 0), 3e3));
    }
  } else if (command === "ban" && canManage(await message.guild.members.fetch(message.author.id), PermissionFlagsBits.BanMembers)) {
    const target = message.mentions.users.first();
    if (target) await message.guild.members.ban(target, { reason: trimReason(args.slice(1).join(" ")) });
  }
}
async function registerCommands() {
  if (!client.user) return;
  const rest = new REST({ version: "10" }).setToken(discordToken);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}
client.once(Events.ClientReady, async (readyClient) => {
  await registerCommands();
  minecraft.start();
  for (const giveaway of store.giveaways()) scheduleGiveaway(giveaway.id, giveaway.endsAt - Date.now());
  readyClient.user.setActivity("Cubixora SMP", { type: ActivityType.Playing });
  console.info(`Discord bot haz\u0131r: ${readyClient.user.tag}`);
});
client.on(Events.GuildMemberAdd, async (member) => {
  const config = store.guild(member.guild.id);
  if (config.autoRoleId) await member.roles.add(config.autoRoleId).catch(() => void 0);
  if (config.welcomeChannelId) {
    const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send(`S.A ${member}, sunucumuza ho\u015F geldin!`).catch(() => void 0);
  }
});
client.on(Events.GuildMemberRemove, async (member) => {
  const channelId = store.guild(member.guild.id).goodbyeChannelId;
  if (!channelId) return;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(`${member.user.tag} sunucudan ayr\u0131ld\u0131. G\xFCle g\xFCle!`).catch(() => void 0);
});
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const config = store.guild(message.guild.id);
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (config.protectionEnabled && config.protectionRoleId && message.mentions.roles.has(config.protectionRoleId) && !canManage(member, PermissionFlagsBits.ManageGuild)) {
    await message.delete().catch(() => void 0);
    if (member) await applyMute(member, 60 * 60 * 1e3, "Korunan rol\xFC etiketleme").catch(() => void 0);
    await logDiscord(message.guild.id, `${message.author.tag} korunan rol\xFC etiketledi ve 1 saat susturuldu.`);
    return;
  }
  if (config.linkProtectionEnabled && isUrl(message.content) && !canManage(member, PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => void 0);
    if (member) await applyMute(member, 24 * 60 * 60 * 1e3, "Link korumas\u0131").catch(() => void 0);
    await logDiscord(message.guild.id, `${message.author.tag} link korumas\u0131 nedeniyle 1 g\xFCn susturuldu.`);
    return;
  }
  const word = config.wordGames[message.channel.id];
  if (word && !message.content.startsWith(config.prefix)) {
    const recent = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
    const previous = recent?.find((candidate) => candidate.id !== message.id && !candidate.author.bot);
    if (previous?.author.id === message.author.id || normalizeText(message.content) !== word) {
      await message.delete().catch(() => void 0);
      return;
    }
    await message.react("\u2705").catch(() => void 0);
    return;
  }
  if (Object.hasOwn(config.numberGames, message.channel.id) && !message.content.startsWith(config.prefix)) {
    const expected = (config.numberGames[message.channel.id] ?? 0) + 1;
    const number = Number(message.content.trim());
    const recent = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
    const previous = recent?.find((candidate) => candidate.id !== message.id && !candidate.author.bot);
    if (previous?.author.id === message.author.id || number !== expected) {
      await message.delete().catch(() => void 0);
      return;
    }
    config.numberGames[message.channel.id] = number;
    store.updateGuild(message.guild.id, { numberGames: config.numberGames });
    await message.react("\u{1F534}").catch(() => void 0);
    return;
  }
  await handlePrefix(message).catch((error) => console.error("Prefix komutu hatas\u0131", error));
});
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction).catch(async (error) => {
      console.error("Slash komutu hatas\u0131", error);
      const reply = { content: "Komut \xE7al\u0131\u015Ft\u0131r\u0131l\u0131rken bir hata olu\u015Ftu.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => void 0);
      else await interaction.reply(reply).catch(() => void 0);
    });
    return;
  }
  if (!interaction.isButton() || !interaction.guild) return;
  if (interaction.customId === "ticket-open") {
    const config = store.guild(interaction.guild.id);
    if (!config.ticket) return void interaction.reply({ content: "Ticket sistemi hen\xFCz kurulmam\u0131\u015F.", ephemeral: true });
    const existing = interaction.guild.channels.cache.find((channel2) => channel2.name === `ticket-${interaction.user.username.toLocaleLowerCase("tr-TR")}`);
    if (existing) return void interaction.reply({ content: `Zaten a\xE7\u0131k ticket\u0131n var: ${existing}`, ephemeral: true });
    const channel = await interaction.guild.channels.create({
      name: safeChannelName(`ticket-${interaction.user.username}`),
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: config.ticket.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ]
    });
    const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket-close").setLabel("Ticket Kapat").setStyle(ButtonStyle.Danger));
    await channel.send({ content: `${interaction.user} ticket a\xE7t\u0131. Yetkililerden biri ilgilenecek.`, embeds: [new EmbedBuilder().setTitle(config.ticket.title).setDescription(config.ticket.text).setColor(5793266)], components: [closeRow] });
    await interaction.reply({ content: `Ticket\u0131n a\xE7\u0131ld\u0131: ${channel}`, ephemeral: true });
  } else if (interaction.customId === "ticket-close") {
    if (!canManage(await interaction.guild.members.fetch(interaction.user.id), PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Bu ticket\u0131 kapatmak i\xE7in yetki gerekli.", ephemeral: true });
    await interaction.reply("Ticket kapat\u0131l\u0131yor.");
    setTimeout(() => interaction.channel?.delete().catch(() => void 0), 1e3);
  }
});
startHttpServer(minecraft);
process.on("unhandledRejection", (error) => console.error("\u0130\u015Flenmeyen promise hatas\u0131", error));
process.on("uncaughtException", (error) => console.error("Yakalanmam\u0131\u015F hata", error));
await client.login(discordToken);
