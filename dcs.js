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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { statusBedrock } from "minecraft-server-util";
import { createServer } from "node:http";

// -----------------------------------------
// 1. STORE (Veri Yönetimi)
// -----------------------------------------
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

class ConfigStore {
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
        throw new Error(`Ayar dosyası okunamadı: ${String(error)}`);
      }
      this.data = { guilds: {}, owners: [], giveaways: [] };
      this.save();
    }
  }
  save() {
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
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
}

// -----------------------------------------
// 2. MINECRAFT BRIDGE
// -----------------------------------------
class MinecraftBridge {
  constructor(clientInstance, storeInstance) {
    this.client = clientInstance;
    this.store = storeInstance;
  }
  client;
  store;
  host = process.env.MC_HOST ?? "cubixorasmp.play.hosting";
  port = Number(process.env.MC_PORT ?? 19132);
  intervalMs = Number(process.env.MC_STATUS_INTERVAL_MS ?? 60000);
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
    const response = await statusBedrock(this.host, this.port, { timeout: 5000 });
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
        activities: [{ name: "Minecraft: Sunucu kapalı", type: 0 }],
        status: "idle"
      });
    }
  }
  summary() {
    if (this.lastError) return "Sunucu kapalı veya erişilemiyor";
    if (this.lastOnline === null) return "Durum kontrol ediliyor";
    return `${this.lastOnline} oyuncu çevrimici`;
  }
  async sendEvent(event) {
    const typeLabel = {
      join: "giriş yaptı",
      leave: "çıkış yaptı",
      chat: "sohbete yazdı",
      ban: "banlandı",
      kick: "atıldı",
      mute: "susturuldu"
    };
    for (const guild of this.client.guilds.cache.values()) {
      const config = this.store.guild(guild.id);
      const channelId = event.type === "chat" ? config.minecraftChatChannelId : config.minecraftLogChannelId;
      if (!channelId) continue;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const detail = event.message ? `: ${event.message}` : event.reason ? `: ${event.reason}` : "";
      await channel.send(`**Minecraft** • ${event.player ?? "Bilinmeyen oyuncu"} ${typeLabel[event.type]}${detail}`).catch(() => void 0);
    }
  }
  async serverStatusForGuild(guild) {
    const config = this.store.guild(guild.id);
    if (config.maintenanceMode) return "Bakım modu açık";
    return this.summary();
  }
}

// -----------------------------------------
// 3. HTTP SERVER
// -----------------------------------------
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
          sendJson(response, 400, { ok: false, error: "Geçersiz olay türü" });
          return;
        }
        await bridge.sendEvent(event);
        sendJson(response, 202, { ok: true });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error) });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: "Bulunamadı" });
  });
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, "0.0.0.0", () => {
    console.info(`HTTP sağlık/webhook sunucusu ${port} portunda hazır`);
  });
  return server;
}

// -----------------------------------------
// 4. UTILS & HELPERS
// -----------------------------------------
const unitMs = {
  saniye: 1000,
  dakika: 60000,
  saat: 3600000,
  gün: 86400000
};
function parseDuration(amount, unit) {
  const normalized = unit.toLocaleLowerCase("tr-TR").replace("ü", "u");
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
    gun: "gün",
    gün: "gün",
    day: "gün",
    days: "gün"
  };
  const resolved = map[normalized];
  return resolved && Number.isFinite(amount) && amount > 0 ? amount * unitMs[resolved] : null;
}
function durationText(amount, unit) {
  return `${amount}${unit}`;
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

// -----------------------------------------
// 5. BOT INITIALIZATION & COMMANDS
// -----------------------------------------
const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN eksik. Lütfen .env dosyasına veya Render Environment Variables içine ekleyin.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const store = new ConfigStore();
const minecraft = new MinecraftBridge(client, store);

const commands = [
  new SlashCommandBuilder().setName("ip").setDescription("Cubixora SMP sunucu bilgilerini gösterir"),
  new SlashCommandBuilder().setName("otorol-ayarla").setDescription("Sunucuya girenlere otomatik verilecek rolü ayarlar").addRoleOption((option) => option.setName("rol").setDescription("Otomatik rol").setRequired(true)),
  new SlashCommandBuilder().setName("otorol-kapat").setDescription("Otomatik rol sistemini kapatır"),
  new SlashCommandBuilder().setName("sil").setDescription("1 ile 1000 arasında mesaj siler").addIntegerOption(
    (option) => option.setName("miktar").setDescription("Silinecek mesaj sayısı").setMinValue(1).setMaxValue(1000).setRequired(true)
  ),
  new SlashCommandBuilder().setName("ban").setDescription("Üyeyi sunucudan yasaklar").addUserOption((option) => option.setName("üye").setDescription("Yasaklanacak üye").setRequired(true)).addStringOption((option) => option.setName("sebep").setDescription("Ban sebebi").setRequired(true)),
  new SlashCommandBuilder().setName("mute").setDescription("Üyeyi süreli susturur").addUserOption((option) => option.setName("üye").setDescription("Susturulacak üye").setRequired(true)).addIntegerOption((option) => option.setName("süre").setDescription("Süre").setMinValue(1).setRequired(true)).addStringOption(
    (option) => option.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
      { name: "Saniye", value: "saniye" },
      { name: "Dakika", value: "dakika" },
      { name: "Saat", value: "saat" },
      { name: "Gün", value: "gün" }
    )
  ).addStringOption((option) => option.setName("sebep").setDescription("Mute sebebi")),
  new SlashCommandBuilder().setName("hosgeldin-kanal").setDescription("Hoş geldin kanalını ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("gulegule-kanal").setDescription("Güle güle kanalını ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("koruma-rol").setDescription("Etiketlenen rolü koruma sistemine ekler").addRoleOption((option) => option.setName("rol").setDescription("Korunacak rol").setRequired(true)),
  new SlashCommandBuilder().setName("koruma-list").setDescription("Koruma rolünü gösterir"),
  new SlashCommandBuilder().setName("koruma-cikar").setDescription("Koruma rolünü kaldırır"),
  new SlashCommandBuilder().setName("cekilis").setDescription("Çekiliş başlatır").addStringOption((option) => option.setName("başlık").setDescription("Çekiliş başlığı").setRequired(true)).addStringOption((option) => option.setName("ödül").setDescription("Birinci ödül").setRequired(true)).addStringOption((option) => option.setName("ikinci-ödül").setDescription("İkinci ödül")).addIntegerOption((option) => option.setName("kazanan-sayısı").setDescription("Kazanan sayısı").setMinValue(1).setMaxValue(50).setRequired(true)).addIntegerOption((option) => option.setName("süre").setDescription("Süre").setMinValue(1).setRequired(true)).addStringOption(
    (option) => option.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
      { name: "Dakika", value: "dakika" },
      { name: "Saat", value: "saat" },
      { name: "Gün", value: "gün" }
    )
  ),
  new SlashCommandBuilder().setName("anket").setDescription("En az iki seçenekli anket başlatır").addStringOption((option) => option.setName("başlık").setDescription("Anket başlığı").setRequired(true)).addStringOption((option) => option.setName("seçenek-1").setDescription("Birinci seçenek").setRequired(true)).addStringOption((option) => option.setName("seçenek-2").setDescription("İkinci seçenek").setRequired(true)).addStringOption((option) => option.setName("seçenek-3").setDescription("Üçüncü seçenek")).addStringOption((option) => option.setName("seçenek-4").setDescription("Dördüncü seçenek")).addIntegerOption((option) => option.setName("süre").setDescription("Süre, 0 ise süresiz").setMinValue(0).setRequired(true)).addStringOption(
    (option) => option.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
      { name: "Dakika", value: "dakika" },
      { name: "Saat", value: "saat" },
      { name: "Gün", value: "gün" }
    )
  ),
  new SlashCommandBuilder().setName("ticket-kur").setDescription("Ticket sistemini kurar").addRoleOption((option) => option.setName("yetkili").setDescription("Ticket yetkili rolü").setRequired(true)).addStringOption((option) => option.setName("başlık").setDescription("Ticket başlığı").setRequired(true)).addStringOption((option) => option.setName("metin").setDescription("Ticket açıklaması").setRequired(true)),
  new SlashCommandBuilder().setName("kelime-kanal").setDescription("Kelime oyununu açar").addChannelOption((option) => option.setName("kanal").setDescription("Oyun kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption((option) => option.setName("kelime").setDescription("Başlangıç kelimesi").setRequired(true)),
  new SlashCommandBuilder().setName("sayisayma").setDescription("Sayı sayma oyununu açar").addChannelOption((option) => option.setName("kanal").setDescription("Oyun kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("dc-ceza").setDescription("Discord ceza log kanalını ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("mc-ceza").setDescription("Minecraft ceza log kanalını ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("mcsohbet").setDescription("Minecraft sohbet/giriş çıkış kanalını ayarlar").addChannelOption((option) => option.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName("owner-ekle").setDescription("Bot owner listesine üye ekler").addUserOption((option) => option.setName("üye").setDescription("Owner yapılacak üye").setRequired(true)),
  new SlashCommandBuilder().setName("owner-list").setDescription("Bot owner listesini gösterir"),
  new SlashCommandBuilder().setName("owner-cikar").setDescription("Bot owner listesinden üye çıkarır").addUserOption((option) => option.setName("üye").setDescription("Çıkarılacak üye").setRequired(true)),
  new SlashCommandBuilder().setName("likkoruma").setDescription("Link korumasını açar"),
  new SlashCommandBuilder().setName("likkormakapat").setDescription("Link korumasını kapatır"),
  new SlashCommandBuilder().setName("bakim").setDescription("Minecraft bakım modunu ayarlar").addStringOption(
    (option) => option.setName("durum").setDescription("Bakım durumu").setRequired(true).addChoices({ name: "Açık", value: "acik" }, { name: "Kapalı", value: "kapali" })
  ),
  new SlashCommandBuilder().setName("aktif").setDescription("Minecraft sunucu durumunu gösterir"),
  new SlashCommandBuilder().setName("site").setDescription("Cubixora web sitesini gösterir"),
  new SlashCommandBuilder().setName("site-ekle").setDescription("Site adresini ayarlar").addStringOption((option) => option.setName("adres").setDescription("HTTPS site adresi").setRequired(true)),
  new SlashCommandBuilder().setName("site-cikar").setDescription("Site adresini varsayılana döndürür"),
  new SlashCommandBuilder().setName("profil").setDescription("Oyuncunun Discord profil fotoğrafını gösterir").addUserOption((option) => option.setName("üye").setDescription("Üye")),
  new SlashCommandBuilder().setName("yardim").setDescription("Bot komutlarını gösterir")
].map((command) => command.toJSON());

function guildMember(interaction) {
  return interaction.guild?.members.cache.get(interaction.user.id) ?? null;
}
function canManage(member, permission) {
  return Boolean(member?.permissions.has(permission));
}
async function logDiscord(guildId, text) {
  const guild = client.guilds.cache.get(guildId);
  const channelId = store.guild(guildId).discordLogChannelId;
  if (!guild || !channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(`**Discord log** • ${text}`).catch(() => void 0);
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
  const maximum = 28 * 24 * 60 * 60 * 1000;
  await member.timeout(Math.min(durationMs, maximum), reason);
}
async function finishGiveaway(id) {
  const record = store.giveaways().find((giveaway) => giveaway.id === id);
  if (!record) return;
  const channel = await client.channels.fetch(record.channelId).catch(() => null);
  const message = channel?.isTextBased() ? await channel.messages.fetch(record.messageId).catch(() => null) : null;
  const reaction = message?.reactions.cache.get("🎉");
  const users = reaction ? [...(await reaction.users.fetch()).values()].filter((user) => !user.bot) : [];
  const winners = users.sort(() => Math.random() - 0.5).slice(0, record.winnerCount);
  const mention = winners.length ? winners.map((winner) => `<@${winner.id}>`).join(", ") : "Yeterli katılım olmadı.";
  await message?.edit({ content: `🎉 **Çekiliş bitti!**\nKazananlar: ${mention}\nÖdül: **${record.firstPrize}**${record.secondPrize ? `\nİkinci Ödül: **${record.secondPrize}**` : ""}` }).catch(() => void 0);
  if (message?.channel.isTextBased() && "send" in message.channel) {
    await message.channel.send(`🎉 Tebrikler ${mention}!`).catch(() => void 0);
  }
  store.removeGiveaway(id);
}
function scheduleGiveaway(id, delay) {
  if (delay <= 2147483647) {
    setTimeout(() => void finishGiveaway(id), Math.max(0, delay));
    return;
  }
  setTimeout(() => scheduleGiveaway(id, delay - 2147483647), 2147483647);
}

// Komut İşleyicileri
async function handleCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Bu komut yalnızca sunucuda kullanılabilir.", ephemeral: true });
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
    await interaction.reply(`**Cubixora SMP**\nJava: \`cubixorasmp.play.hosting\` • Sürüm: \`1.16.5\`\nBedrock: \`cubixorasmp.play.hosting\` • Port: \`19132\``);
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
    const user = interaction.options.getUser("üye") ?? interaction.user;
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${user.username} profili`).setImage(user.displayAvatarURL({ size: 1024 })).setColor(5793266)] });
    return;
  }
  if (command === "owner-list") {
    const owners = store.owners();
    await interaction.reply(owners.length ? `Owner listesi: ${owners.map((id) => `<@${id}>`).join(", ")}` : "Henüz eklenmiş owner yok.");
    return;
  }
  if (command === "owner-ekle" || command === "owner-cikar") {
    if (!store.isOwner(interaction.user.id)) {
      await interaction.reply({ content: "Bu işlem yalnızca bot owner için kullanılabilir.", ephemeral: true });
      return;
    }
    const user = interaction.options.getUser("üye", true);
    if (command === "owner-ekle") store.addOwner(user.id);
    else store.removeOwner(user.id);
    await interaction.reply(`${user} ${command === "owner-ekle" ? "owner listesine eklendi." : "owner listesinden çıkarıldı."}`);
    return;
  }
  if (command === "otorol-ayarla") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    const role = interaction.options.getRole("rol", true);
    store.updateGuild(interaction.guild.id, { autoRoleId: role.id });
    await interaction.reply(`Otomatik rol **${role.name}** olarak ayarlandı.`);
    return;
  }
  if (command === "otorol-kapat") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    store.updateGuild(interaction.guild.id, { autoRoleId: void 0 });
    await interaction.reply("Otomatik rol kapatıldı.");
    return;
  }
  if (command === "hosgeldin-kanal" || command === "gulegule-kanal") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    store.updateGuild(interaction.guild.id, command === "hosgeldin-kanal" ? { welcomeChannelId: channel.id } : { goodbyeChannelId: channel.id });
    await interaction.reply(`${channel} ${command === "hosgeldin-kanal" ? "hoş geldin" : "güle güle"} kanalı oldu.`);
    return;
  }
  if (command === "koruma-rol" || command === "koruma-list" || command === "koruma-cikar") {
    if (command !== "koruma-list" && !canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    if (command === "koruma-rol") {
      const role = interaction.options.getRole("rol", true);
      store.updateGuild(interaction.guild.id, { protectionRoleId: role.id, protectionEnabled: true });
      await interaction.reply(`Koruma rolü **${role.name}** olarak ayarlandı.`);
    } else if (command === "koruma-list") {
      const role = config.protectionRoleId ? await interaction.guild.roles.fetch(config.protectionRoleId).catch(() => null) : null;
      await interaction.reply(role ? `Korunan rol: ${role}` : "Koruma rolü ayarlı değil.");
    } else {
      store.updateGuild(interaction.guild.id, { protectionRoleId: void 0, protectionEnabled: false });
      await interaction.reply("Koruma rolü kaldırıldı.");
    }
    return;
  }
  if (command === "sil") {
    if (!canManage(member, PermissionFlagsBits.ManageMessages)) return void interaction.reply({ content: "Mesajları Yönet yetkisi gerekli.", ephemeral: true });
    const amount = interaction.options.getInteger("miktar", true);
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased()) return void interaction.reply({ content: "Bu kanalda kullanılamaz.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const deleted = await deleteMessages(channel, amount);
    await interaction.editReply(`${deleted} mesaj silindi.`);
    await logDiscord(interaction.guild.id, `${interaction.user} ${deleted} mesaj sildi.`);
    return;
  }
  if (command === "ban") {
    if (!canManage(member, PermissionFlagsBits.BanMembers)) return void interaction.reply({ content: "Üyeleri Yasakla yetkisi gerekli.", ephemeral: true });
    const user = interaction.options.getUser("üye", true);
    const reason = trimReason(interaction.options.getString("sebep") ?? void 0);
    await interaction.guild.members.ban(user, { reason });
    await interaction.reply(`${user.tag} yasaklandı. Sebep: ${reason}`);
    await logDiscord(interaction.guild.id, `${user.tag} ${interaction.user} tarafından banlandı. Sebep: ${reason}`);
    return;
  }
  if (command === "mute") {
    if (!canManage(member, PermissionFlagsBits.ModerateMembers)) return void interaction.reply({ content: "Üyelere Zaman Aşımı Uygula yetkisi gerekli.", ephemeral: true });
    const user = interaction.options.getUser("üye", true);
    const target = await interaction.guild.members.fetch(user.id);
    const amount = interaction.options.getInteger("süre", true);
    const unit = interaction.options.getString("birim", true);
    const milliseconds = parseDuration(amount, unit);
    if (!milliseconds) return void interaction.reply({ content: "Geçersiz süre.", ephemeral: true });
    const reason = trimReason(interaction.options.getString("sebep") ?? void 0);
    await applyMute(target, milliseconds, reason);
    await interaction.reply(`${user.tag} ${durationText(amount, unit)} susturuldu. Sebep: ${reason}`);
    await logDiscord(interaction.guild.id, `${user.tag} ${interaction.user} tarafından susturuldu. Sebep: ${reason}`);
    return;
  }
  if (command === "dc-ceza" || command === "mc-ceza" || command === "mcsohbet") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    const update = command === "dc-ceza" ? { discordLogChannelId: channel.id } : command === "mc-ceza" ? { minecraftLogChannelId: channel.id } : { minecraftChatChannelId: channel.id };
    store.updateGuild(interaction.guild.id, update);
    await interaction.reply(`${channel} kanalına ${command} ayarı yapıldı.`);
    return;
  }
  if (command === "likkoruma" || command === "likkormakapat") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    store.updateGuild(interaction.guild.id, { linkProtectionEnabled: command === "likkoruma" });
    await interaction.reply(`Link koruması ${command === "likkoruma" ? "açıldı" : "kapatıldı"}.`);
    return;
  }
  if (command === "bakim") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    const enabled = interaction.options.getString("durum", true) === "acik";
    store.updateGuild(interaction.guild.id, { maintenanceMode: enabled });
    await interaction.reply(`Bakım modu ${enabled ? "açıldı" : "kapatıldı"}.`);
    return;
  }
  if (command === "site-ekle" || command === "site-cikar") {
    if (!canManage(member, PermissionFlagsBits.ManageGuild)) return void interaction.reply({ content: "Sunucuyu Yönet yetkisi gerekli.", ephemeral: true });
    const url = command === "site-ekle" ? interaction.options.getString("adres", true) : "https://cubixoraweb.onrender.com";
    if (command === "site-ekle" && !/^https:\/\//i.test(url)) return void interaction.reply({ content: "Site adresi https:// ile başlamalı.", ephemeral: true });
    store.updateGuild(interaction.guild.id, { siteUrl: url });
    await interaction.reply(`Site adresi: ${url}`);
    return;
  }
  if (command === "kelime-kanal") {
    if (!canManage(member, PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Kanalları Yönet yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    const word = normalizeText(interaction.options.getString("kelime", true));
    config.wordGames[channel.id] = word;
    store.updateGuild(interaction.guild.id, { wordGames: config.wordGames });
    await interaction.reply(`${channel} kelime oyunu açıldı. İlk kelime: **${word}**. Aynı kişi üst üste yazamaz.`);
    return;
  }
  if (command === "sayisayma") {
    if (!canManage(member, PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Kanalları Yönet yetkisi gerekli.", ephemeral: true });
    const channel = interaction.options.getChannel("kanal", true);
    config.numberGames[channel.id] = 0;
    store.updateGuild(interaction.guild.id, { numberGames: config.numberGames });
    await interaction.reply(`${channel} sayı sayma oyunu açıldı. 1'den başlayın.`);
    return;
  }
  if (command === "ticket-kur") {
    if (!canManage(member, PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Kanalları Yönet yetkisi gerekli.", ephemeral: true });
    const role = interaction.options.getRole("yetkili", true);
    store.setTicket(interaction.guild.id, {
      staffRoleId: role.id,
      title: interaction.options.getString("başlık", true),
      text: interaction.options.getString("metin", true)
    });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket-open").setLabel("Ticket Aç").setStyle(ButtonStyle.Primary));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(config.ticket?.title ?? "Destek Talebi").setDescription(config.ticket?.text ?? "Destek almak için butona tıklayın.").setColor(5793266)], components: [row] });
    return;
  }
  if (command === "anket") {
    const choices = [1, 2, 3, 4].map((index) => interaction.options.getString(`seçenek-${index}`)).filter((choice) => Boolean(choice));
    const title = interaction.options.getString("başlık", true);
    const amount = interaction.options.getInteger("süre", true);
    const unit = interaction.options.getString("birim", true);
    const duration = amount === 0 ? null : parseDuration(amount, unit);
    const embed = new EmbedBuilder().setTitle(`📊 ${title}`).setDescription(choices.map((choice, index) => `${["1️⃣", "2️⃣", "3️⃣", "4️⃣"][index]} ${choice}`).join("\n")).setColor(5763719).setFooter({ text: duration ? `${amount} ${unit} sonra kapanır` : "Süresiz anket" });
    const message = await interaction.reply({ embeds: [embed], fetchReply: true });
    for (let index = 0; index < choices.length; index++) await message.react(["1️⃣", "2️⃣", "3️⃣", "4️⃣"][index]);
    if (duration) setTimeout(() => message.edit({ content: "Anket süresi doldu.", embeds: [embed] }).catch(() => void 0), duration);
    return;
  }
  if (command === "cekilis") {
    const amount = interaction.options.getInteger("süre", true);
    const unit = interaction.options.getString("birim", true);
    const duration = parseDuration(amount, unit);
    if (!duration) return void interaction.reply({ content: "Geçersiz çekiliş süresi.", ephemeral: true });
    const firstPrize = interaction.options.getString("ödül", true);
    const secondPrize = interaction.options.getString("ikinci-ödül") ?? void 0;
    const winnerCount = interaction.options.getInteger("kazanan-sayısı", true);
    const title = interaction.options.getString("başlık", true);
    const end = Date.now() + duration;
    const embed = new EmbedBuilder().setTitle(`🎉 ${title}`).setDescription(`Ödül: **${firstPrize}**${secondPrize ? `\nİkinci Ödül: **${secondPrize}**` : ""}\nKatılmak için 🎉 tepkisine basın.`).setColor(16762967).setFooter({ text: `${winnerCount} kazanan • ${amount} ${unit}` });
    const message = await interaction.reply({ embeds: [embed], fetchReply: true });
    await message.react("🎉");
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
    await message.reply("Aleyküm Selam Hoş Geldin!");
    return;
  }
  const config = store.guild(message.guild.id);
  if (!lower.startsWith(config.prefix.toLocaleLowerCase("tr-TR"))) return;
  const [rawCommand, ...args] = content.slice(config.prefix.length).trim().split(/\s+/);
  const command = rawCommand?.toLocaleLowerCase("tr-TR");

  if (command === "ip") await message.reply("Java: `cubixorasmp.play.hosting` sürüm `1.16.5` • Bedrock port `19132`");
  else if (command === "site") await message.reply(config.siteUrl);
  else if (command === "aktif") await message.reply(`Sunucu: ${await minecraft.serverStatusForGuild(message.guild)}`);
  else if (command === "owner") await message.reply(store.owners().length ? store.owners().map((id) => `<@${id}>`).join(", ") : "Owner yok.");
  else if (command === "profil") {
    const user = message.mentions.users.first() ?? message.author;
    await message.reply({ embeds: [new EmbedBuilder().setTitle(`${user.username} profili`).setImage(user.displayAvatarURL({ size: 1024 })) .setColor(5793266)] });
  } else if (command === "sil" && canManage(await message.guild.members.fetch(message.author.id), PermissionFlagsBits.ManageMessages)) {
    const amount = Math.min(1000, Math.max(1, Number(args[0] ?? 1)));
    if (message.channel.isTextBased() && !message.channel.isDMBased()) {
      const deleted = await deleteMessages(message.channel, amount);
      await message.channel.send(`${deleted} mesaj silindi.`).then((sent) => setTimeout(() => sent.delete().catch(() => void 0), 3000));
    }
  } else if (command === "ban" && canManage(await message.guild.members.fetch(message.author.id), PermissionFlagsBits.BanMembers)) {
    const target = message.mentions.users.first();
    if (target) await message.guild.members.ban(target, { reason: trimReason(args.slice(1).join(" ")) });
  }
}

async function registerCommands() {
  if (!client.user) return;
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

client.once(Events.ClientReady, async (readyClient) => {
  await registerCommands();
  minecraft.start();
  for (const giveaway of store.giveaways()) scheduleGiveaway(giveaway.id, giveaway.endsAt - Date.now());
  readyClient.user.setActivity("Cubixora SMP", { type: ActivityType.Playing });
  console.info(`Discord bot hazır: ${readyClient.user.tag}`);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const config = store.guild(member.guild.id);
  if (config.autoRoleId) await member.roles.add(config.autoRoleId).catch(() => void 0);
  if (config.welcomeChannelId) {
    const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send(`S.A ${member}, sunucumuza hoş geldin!`).catch(() => void 0);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  const channelId = store.guild(member.guild.id).goodbyeChannelId;
  if (!channelId) return;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(`${member.user.tag} sunucudan ayrıldı. Güle güle!`).catch(() => void 0);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const config = store.guild(message.guild.id);
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);

  if (config.protectionEnabled && config.protectionRoleId && message.mentions.roles.has(config.protectionRoleId) && !canManage(member, PermissionFlagsBits.ManageGuild)) {
    await message.delete().catch(() => void 0);
    if (member) await applyMute(member, 3600000, "Korunan rolü etiketleme").catch(() => void 0);
    await logDiscord(message.guild.id, `${message.author.tag} korunan rolü etiketledi ve 1 saat susturuldu.`);
    return;
  }
  if (config.linkProtectionEnabled && isUrl(message.content) && !canManage(member, PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => void 0);
    if (member) await applyMute(member, 86400000, "Link koruması").catch(() => void 0);
    await logDiscord(message.guild.id, `${message.author.tag} link koruması nedeniyle 1 gün susturuldu.`);
    return;
  }

  const word = config.wordGames[message.channel.id];
  if (word && !message.content.startsWith(config.prefix)) {
    const recent = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
    const previous = recent?.find((candidate) => candidate.id !== message.id && !candidate.author.bot);
    if (previous?.author.id === message.author.id || normalizeText(message.content) !== word) {
      await message.delete().catch(() => void0);
      return;
    }
    await message.react("✅").catch(() => void 0);
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
    await message.react("🔴").catch(() => void 0);
    return;
  }

  await handlePrefix(message).catch((error) => console.error("Prefix komutu hatası", error));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction).catch(async (error) => {
      console.error("Slash komutu hatası", error);
      const reply = { content: "Komut çalıştırılırken bir hata oluştu.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => void 0);
      else await interaction.reply(reply).catch(() => void 0);
    });
    return;
  }
  if (!interaction.isButton() || !interaction.guild) return;
  if (interaction.customId === "ticket-open") {
    const config = store.guild(interaction.guild.id);
    if (!config.ticket) return void interaction.reply({ content: "Ticket sistemi henüz kurulmamış.", ephemeral: true });
    const existing = interaction.guild.channels.cache.find((channel2) => channel2.name === `ticket-${interaction.user.username.toLocaleLowerCase("tr-TR")}`);
    if (existing) return void interaction.reply({ content: `Zaten açık ticketın var: ${existing}`, ephemeral: true });
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
    await channel.send({ content: `${interaction.user} ticket açtı. Yetkililerden biri ilgilenecek.`, embeds: [new EmbedBuilder().setTitle(config.ticket.title).setDescription(config.ticket.text).setColor(5793266)], components: [closeRow] });
    await interaction.reply({ content: `Ticketın açıldı: ${channel}`, ephemeral: true });
  } else if (interaction.customId === "ticket-close") {
    if (!canManage(await interaction.guild.members.fetch(interaction.user.id), PermissionFlagsBits.ManageChannels)) return void interaction.reply({ content: "Bu ticketı kapatmak için yetki gerekli.", ephemeral: true });
    await interaction.reply("Ticket kapatılıyor.");
    setTimeout(() => interaction.channel?.delete().catch(() => void 0), 1000);
  }
});

startHttpServer(minecraft);
process.on("unhandledRejection", (error) => console.error("İşlenmeyen promise hatası", error));
process.on("uncaughtException", (error) => console.error("Yakalanmamış hata", error));
await client.login(token);
