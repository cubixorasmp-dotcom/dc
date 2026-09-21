import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type PartialGuildMember,
  type Role,
} from "discord.js";
import { logger } from "../lib/logger";
import { startMinecraftPresence, BEDROCK_PORT, JAVA_PORT, MINECRAFT_HOST } from "./minecraft";
import { GuildStore } from "./store";
import type { DurationUnit, GameMode, MinecraftEvent } from "./types";

const LINK_PATTERN = /(?:https?:\/\/|www\.)\S+/i;
const GREETING_PATTERN = /^(s\.?a\.?|selamünaleyküm|selam)$/i;
const GAME_EMOJIS = { correct: "✅", wrong: "🔴" } as const;

const durationMs = (amount: number, unit: DurationUnit) => {
  const multiplier: Record<DurationUnit, number> = {
    saniye: 1_000,
    dakika: 60_000,
    saat: 3_600_000,
    gün: 86_400_000,
  };
  return Math.max(1_000, amount * multiplier[unit]);
};

const durationLabel = (amount: number, unit: DurationUnit) =>
  `${amount} ${unit}`;

const memberHas = (member: GuildMember, permission: bigint) =>
  member.permissions.has(permission);

const getMember = async (interaction: ChatInputCommandInteraction, name: string) => {
  const user = interaction.options.getUser(name, true);
  return interaction.guild?.members.fetch(user.id);
};

const roleFromOption = (
  interaction: ChatInputCommandInteraction,
  name = "rol",
): Pick<Role, "id"> | null => {
  const role = interaction.options.getRole(name);
  return role ? { id: role.id } : null;
};

const safeReply = async (
  interaction: ChatInputCommandInteraction,
  content: string,
) => {
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(content);
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
};

const botInvite = (client: Client) =>
  client.user
    ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`
    : "Bot hazır değil.";

function commandDefinitions() {
  const duration = (builder: any) =>
    builder
      .addIntegerOption((option: any) =>
        option.setName("sure").setDescription("Süre").setMinValue(1).setRequired(true),
      )
      .addStringOption((option: any) =>
        option
          .setName("birim")
          .setDescription("Süre birimi")
          .setRequired(true)
          .addChoices(
            { name: "Saniye", value: "saniye" },
            { name: "Dakika", value: "dakika" },
            { name: "Saat", value: "saat" },
            { name: "Gün", value: "gün" },
          ),
      );

  return [
    new SlashCommandBuilder()
      .setName("ip")
      .setDescription("Minecraft sunucu bağlantı bilgilerini gösterir"),
    new SlashCommandBuilder()
      .setName("yardim")
      .setDescription("Bot komutlarını gösterir"),
    new SlashCommandBuilder()
      .setName("otorol-ayarla")
      .setDescription("Sunucuya girenlere otomatik verilecek rolü ayarlar")
      .addRoleOption((option) =>
        option.setName("rol").setDescription("Verilecek rol").setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("otorol-kapat")
      .setDescription("Otorol sistemini kapatır")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("hosgeldin-kanal")
      .setDescription("Hoş geldin mesajı kanalını ayarlar")
      .addChannelOption((option) =>
        option
          .setName("kanal")
          .setDescription("Mesaj kanalı")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("gulegule-kanal")
      .setDescription("Güle güle mesajı kanalını ayarlar")
      .addChannelOption((option) =>
        option
          .setName("kanal")
          .setDescription("Mesaj kanalı")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("koruma-rol")
      .setDescription("Korumalı rolü ayarlar; rol etiketleyen 1 saat susturulur")
      .addRoleOption((option) =>
        option.setName("rol").setDescription("Korunacak rol").setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("koruma-list")
      .setDescription("Korumalı rol ayarını gösterir"),
    new SlashCommandBuilder()
      .setName("koruma-cikar")
      .setDescription("Korumalı rolü kaldırır")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("sil")
      .setDescription("Mesaj siler")
      .addIntegerOption((option) =>
        option.setName("sayi").setDescription("1-1000 arası mesaj").setMinValue(1).setMaxValue(1000).setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Üyeyi yasaklar")
      .addUserOption((option) => option.setName("uye").setDescription("Yasaklanacak üye").setRequired(true))
      .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    (() => {
      const builder = new SlashCommandBuilder()
        .setName("mute")
        .setDescription("Üyeyi süreli susturur")
        .addUserOption((option) => option.setName("uye").setDescription("Susturulacak üye").setRequired(true))
        .addStringOption((option) => option.setName("sebep").setDescription("Sebep").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
      return duration(builder);
    })(),
    new SlashCommandBuilder()
      .setName("cekilis")
      .setDescription("Süreli çekiliş başlatır")
      .addStringOption((option) => option.setName("baslik").setDescription("Çekiliş başlığı").setRequired(true))
      .addStringOption((option) => option.setName("odul").setDescription("Birinci ödül").setRequired(true))
      .addIntegerOption((option) => option.setName("kazanan").setDescription("Kazanan sayısı").setMinValue(1).setMaxValue(20).setRequired(true))
      .addIntegerOption((option) => option.setName("sure").setDescription("Süre").setMinValue(1).setRequired(true))
      .addStringOption((option) =>
        option.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
          { name: "Dakika", value: "dakika" },
          { name: "Saat", value: "saat" },
          { name: "Gün", value: "gün" },
        ),
      )
      .addStringOption((option) => option.setName("ikinci_odul").setDescription("İkinci ödül").setRequired(false)),
    new SlashCommandBuilder()
      .setName("anket")
      .setDescription("En az iki seçenekli anket başlatır")
      .addStringOption((option) => option.setName("baslik").setDescription("Anket başlığı").setRequired(true))
      .addStringOption((option) => option.setName("secenekler").setDescription("Seçenekleri | ile ayır").setRequired(true))
      .addIntegerOption((option) => option.setName("sure").setDescription("Süre").setMinValue(1).setRequired(true))
      .addStringOption((option) =>
        option.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
          { name: "Dakika", value: "dakika" },
          { name: "Saat", value: "saat" },
          { name: "Gün", value: "gün" },
        ),
      ),
    new SlashCommandBuilder()
      .setName("ticket-kur")
      .setDescription("Butonlu ticket sistemi kurar")
      .addRoleOption((option) => option.setName("yetkili").setDescription("Ticket yetkili rolü").setRequired(true))
      .addStringOption((option) => option.setName("baslik").setDescription("Panel başlığı").setRequired(true))
      .addStringOption((option) => option.setName("metin").setDescription("Panel metni").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName("kelime-kanal")
      .setDescription("Kelime oyun kanalını ayarlar")
      .addChannelOption((option) => option.setName("kanal").setDescription("Oyun kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((option) => option.setName("baslangic").setDescription("İlk harf").setMinLength(1).setMaxLength(1).setRequired(true)),
    new SlashCommandBuilder()
      .setName("sayisayma")
      .setDescription("Sayı sayma kanalını ayarlar")
      .addChannelOption((option) => option.setName("kanal").setDescription("Oyun kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder()
      .setName("dc-ceza")
      .setDescription("Discord ceza log kanalını ayarlar")
      .addChannelOption((option) => option.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("mc-ceza")
      .setDescription("Minecraft ceza log kanalını ayarlar")
      .addChannelOption((option) => option.setName("kanal").setDescription("Log kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("mcsohbet")
      .setDescription("Minecraft sohbet kanalını ayarlar")
      .addChannelOption((option) => option.setName("kanal").setDescription("Sohbet kanalı").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("owner-ekle")
      .setDescription("Bot owner listesine üye ekler")
      .addUserOption((option) => option.setName("uye").setDescription("Eklenecek üye").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName("owner-list").setDescription("Bot owner listesini gösterir"),
    new SlashCommandBuilder()
      .setName("owner-cikar")
      .setDescription("Bot owner listesinden üye çıkarır")
      .addUserOption((option) => option.setName("uye").setDescription("Çıkarılacak üye").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("linkkoruma")
      .setDescription("Link korumayı açar")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("linkkoruma-kapat")
      .setDescription("Link korumayı kapatır")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("aktif")
      .setDescription("Bot durumunu gösterir"),
    new SlashCommandBuilder()
      .setName("bakim")
      .setDescription("Sunucu bakım modunu açar veya kapatır")
      .addBooleanOption((option) => option.setName("acik").setDescription("Bakım modu açık mı?").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("site")
      .setDescription("Site bilgisini gösterir veya yönetir")
      .addStringOption((option) =>
        option
          .setName("islem")
          .setDescription("Yapılacak işlem")
          .setRequired(true)
          .addChoices(
            { name: "Göster", value: "goster" },
            { name: "Ekle", value: "ekle" },
            { name: "Çıkar", value: "cikar" },
          ),
      )
      .addStringOption((option) => option.setName("url").setDescription("Eklenecek site adresi").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("site-ekle")
      .setDescription("Durum komutlarında gösterilecek siteyi ayarlar")
      .addStringOption((option) => option.setName("url").setDescription("Site adresi").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("site-cikar")
      .setDescription("Site bilgisini kaldırır")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("profl")
      .setDescription("Üyenin profil fotoğrafını gösterir")
      .addUserOption((option) => option.setName("uye").setDescription("Üye").setRequired(false)),
  ].map((command) => command.toJSON());
}

export class DiscordBot {
  readonly client: Client;
  readonly store = new GuildStore();
  private stopPresence?: () => void;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });
  }

  async start() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error("DISCORD_BOT_TOKEN secret is required to start the Discord bot.");
    }

    await this.store.load();
    this.registerEvents();
    await this.client.login(token);
  }

  async stop() {
    this.stopPresence?.();
    this.client.destroy();
  }

  private registerEvents() {
    this.client.once(Events.ClientReady, (client) => {
      logger.info({ tag: client.user.tag, guilds: client.guilds.cache.size }, "Discord bot connected");
      this.stopPresence = startMinecraftPresence(
        this.client,
        () => [...this.client.guilds.cache.values()].some((guild) => this.store.get(guild.id).maintenance),
      );
      for (const guild of client.guilds.cache.values()) void this.registerGuildCommands(guild);
    });

    this.client.on(Events.GuildCreate, (guild) => void this.registerGuildCommands(guild));
    this.client.on(Events.InteractionCreate, (interaction) => void this.handleInteraction(interaction));
    this.client.on(Events.MessageCreate, (message) => void this.handleMessage(message));
    this.client.on(Events.GuildMemberAdd, (member) => void this.handleJoin(member));
    this.client.on(Events.GuildMemberRemove, (member) => void this.handleLeave(member));
    this.client.on(Events.Error, (error) => logger.error({ err: error }, "Discord client error"));
    this.client.on(Events.Warn, (message) => logger.warn({ message }, "Discord client warning"));
  }

  private async registerGuildCommands(guild: Guild) {
    try {
      await guild.commands.set(commandDefinitions());
      logger.info({ guildId: guild.id, guildName: guild.name }, "Guild commands registered");
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Guild command registration failed");
    }
  }

  private async handleJoin(member: GuildMember) {
    const settings = this.store.get(member.guild.id);
    if (settings.autoRoleId) {
      const role = member.guild.roles.cache.get(settings.autoRoleId);
      if (role) await member.roles.add(role, "Cubixora otomatik rol").catch((error) =>
        logger.warn({ err: error, guildId: member.guild.id }, "Auto role could not be added"),
      );
    }

    if (settings.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
      if (channel?.isTextBased()) {
        await channel.send(`Aleyküm Selam ${member} Hoş Geldin!`).catch(() => undefined);
      }
    }
  }

  private async handleLeave(member: GuildMember | PartialGuildMember) {
    const settings = this.store.get(member.guild.id);
    if (!settings.goodbyeChannelId) return;
    const channel = member.guild.channels.cache.get(settings.goodbyeChannelId);
    if (channel?.isTextBased()) {
      await channel.send(`${member.user.username} sunucudan ayrıldı. Güle güle!`).catch(() => undefined);
    }
  }

  private async handleMessage(message: Message) {
    if (message.author.bot || !message.guild) return;
    const settings = this.store.get(message.guild.id);
    const member = message.member;
    if (!member) return;

    if (GREETING_PATTERN.test(message.content.trim())) {
      await message.reply("Aleyküm Selam Hoş Geldin!").catch(() => undefined);
    }

    if (settings.protectionRoleId && message.mentions.roles.has(settings.protectionRoleId)) {
      if (!memberHas(member, PermissionFlagsBits.ManageGuild)) {
        await message.delete().catch(() => undefined);
        await member.timeout(60 * 60 * 1000, "Korumalı rol etiketlendi").catch(() => undefined);
        await this.sendPunishmentLog(message.guild, `Korumalı rol etiketi: ${member.user.tag}`);
        return;
      }
    }

    if (settings.linkProtection && LINK_PATTERN.test(message.content)) {
      if (!memberHas(member, PermissionFlagsBits.ManageGuild)) {
        await message.delete().catch(() => undefined);
        await member.timeout(24 * 60 * 60 * 1000, "Link koruma").catch(() => undefined);
        await this.sendPunishmentLog(message.guild, `Link koruma: ${member.user.tag}`);
        return;
      }
    }

    await this.handleGameMessage(message, settings);

    const activePrefix = message.content.startsWith(settings.prefix)
      ? settings.prefix
      : message.content.startsWith("!")
        ? "!"
        : undefined;
    if (activePrefix) {
      await this.handlePrefixCommand(message, message.content.slice(activePrefix.length).trim());
    }
  }

  private async handleGameMessage(message: Message, settings: ReturnType<GuildStore["get"]>) {
    if (settings.countingChannelId === message.channelId) {
      const expected = settings.countingNumber;
      const number = Number(message.content.trim());
      const canPlay = message.author.id !== settings.lastGameUserId;
      if (canPlay && number === expected) {
        await message.react(GAME_EMOJIS.correct).catch(() => undefined);
        this.store.update(message.guild!.id, { countingNumber: expected + 1, lastGameUserId: message.author.id });
      } else {
        await message.react(GAME_EMOJIS.wrong).catch(() => undefined);
        setTimeout(() => void message.delete().catch(() => undefined), 800);
        if (!message.channel.isSendable()) return;
        await message.channel.send(`${message.author}, sıradaki sayı ${expected}.`).then((sent) => {
          setTimeout(() => void sent.delete().catch(() => undefined), 3_000);
        }).catch(() => undefined);
      }
    }

    if (settings.wordChannelId === message.channelId) {
      const required = (settings.word ?? "").toLocaleLowerCase("tr-TR");
      const word = message.content.trim().toLocaleLowerCase("tr-TR");
      const canPlay = message.author.id !== settings.lastGameUserId;
      if (canPlay && word.length > 0 && (!required || word.startsWith(required))) {
        const nextLetter = word.at(-1) ?? required;
        await message.react(GAME_EMOJIS.correct).catch(() => undefined);
        this.store.update(message.guild!.id, { word: nextLetter, lastGameUserId: message.author.id });
      } else {
        await message.react(GAME_EMOJIS.wrong).catch(() => undefined);
        setTimeout(() => void message.delete().catch(() => undefined), 800);
      }
    }
  }

  private async handlePrefixCommand(message: Message, raw: string) {
    const [command, ...args] = raw.split(/\s+/);
    const member = message.member;
    const guild = message.guild;
    if (!member || !guild) return;
    const normalized = command.toLocaleLowerCase("tr-TR");

    if (normalized === "ip") {
      await message.reply(this.ipText());
      return;
    }
    if (normalized === "aktif") {
      await message.reply(this.activeText(guild.id));
      return;
    }
    if (normalized === "site") {
      const settings = this.store.get(guild.id);
      if (args[0]?.toLocaleLowerCase("tr-TR") === "cikar" && memberHas(member, PermissionFlagsBits.ManageGuild)) {
        this.store.update(guild.id, { siteUrl: undefined });
        await message.reply("Site ayarı kaldırıldı.");
      } else if (args[0] && memberHas(member, PermissionFlagsBits.ManageGuild)) {
        this.store.update(guild.id, { siteUrl: args[0] });
        await message.reply(`Site ${args[0]} olarak ayarlandı.`);
      } else {
        await message.reply(settings.siteUrl ?? "Site ayarlanmamış. Yetkili: `e!site <url>`");
      }
      return;
    }
    if (normalized === "bakim") {
      if (!memberHas(member, PermissionFlagsBits.ManageGuild)) return;
      const enabled = ["aç", "ac", "on", "aktif"].includes((args[0] ?? "").toLocaleLowerCase("tr-TR"));
      this.store.update(guild.id, { maintenance: enabled });
      await message.reply(enabled ? "Bakım modu açıldı. Bot durumu bakım olarak görünecek." : "Bakım modu kapatıldı. Bot durumu online olarak görünecek.");
      return;
    }
    if (normalized === "profl") {
      const user = message.mentions.users.first() ?? message.author;
      await message.reply({ content: `${user.username} profil fotoğrafı`, files: [user.displayAvatarURL({ size: 1024 })] });
      return;
    }
    if (normalized === "owner") {
      const settings = this.store.get(guild.id);
      const owners = settings.ownerIds.length ? settings.ownerIds.map((id) => `<@${id}>`).join(", ") : "Owner listesi boş.";
      await message.reply(`Bot owner listesi: ${owners}`);
      return;
    }

    if (normalized === "sil") {
      const count = Number(args[0]);
      if (!memberHas(member, PermissionFlagsBits.ManageMessages) || !Number.isInteger(count) || count < 1 || count > 1000) {
        await message.reply("Bu işlem için mesaj yönetme izni ve 1-1000 arası sayı gerekir.");
        return;
      }
      await message.delete().catch(() => undefined);
      let left = count;
      while (left > 0 && message.channel.isTextBased() && "bulkDelete" in message.channel) {
        const batch = await message.channel.bulkDelete(Math.min(left, 100), true);
        if (!batch.size) break;
        left -= batch.size;
      }
      return;
    }

    if (normalized === "ban") {
      const target = message.mentions.members?.first();
      if (!memberHas(member, PermissionFlagsBits.BanMembers) || !target) {
        await message.reply("Ban iznin yok veya üye etiketlemedin.");
        return;
      }
      await target.ban({ reason: args.slice(1).join(" ") || "Sebep belirtilmedi" });
      await message.reply(`${target.user.tag} banlandı.`);
      await this.sendPunishmentLog(guild, `${target.user.tag} banlandı. Yetkili: ${member.user.tag}`);
      return;
    }

    if (normalized === "mute") {
      const target = message.mentions.members?.first();
      const amount = Number(args[1]);
      const unit = args[2] as DurationUnit;
      if (!memberHas(member, PermissionFlagsBits.ModerateMembers) || !target || !Number.isFinite(amount) || !["saniye", "dakika", "saat", "gün"].includes(unit)) {
        await message.reply("Kullanım: `e!mute @üye sebep süre birim`");
        return;
      }
      const ms = Math.min(durationMs(amount, unit), 28 * 24 * 60 * 60 * 1000);
      await target.timeout(ms, args.slice(3).join(" ") || "Sebep belirtilmedi");
      await message.reply(`${target.user.tag}, ${durationLabel(amount, unit)} susturuldu.`);
      await this.sendPunishmentLog(guild, `${target.user.tag} mute. Yetkili: ${member.user.tag}`);
      return;
    }

    if (normalized === "linkkoruma") {
      if (memberHas(member, PermissionFlagsBits.ManageGuild)) this.store.update(guild.id, { linkProtection: true });
      await message.reply("Link koruma açıldı.");
      return;
    }
    if (normalized === "linkkorumakapat") {
      if (memberHas(member, PermissionFlagsBits.ManageGuild)) this.store.update(guild.id, { linkProtection: false });
      await message.reply("Link koruma kapatıldı.");
      return;
    }
    if (normalized === "siteekle") {
      if (memberHas(member, PermissionFlagsBits.ManageGuild) && args[0]) this.store.update(guild.id, { siteUrl: args[0] });
      await message.reply("Site ayarı güncellendi.");
      return;
    }
    if (normalized === "sitecikar") {
      if (memberHas(member, PermissionFlagsBits.ManageGuild)) this.store.update(guild.id, { siteUrl: undefined });
      await message.reply("Site ayarı kaldırıldı.");
      return;
    }

    if (normalized === "otorol-ayarla") {
      const role = message.mentions.roles.first();
      if (role && memberHas(member, PermissionFlagsBits.ManageGuild)) {
        this.store.update(guild.id, { autoRoleId: role.id });
        await message.reply(`Otorol ${role} olarak ayarlandı.`);
      }
      return;
    }
    if (normalized === "gulegule-kanal" || normalized === "gulegulekanal") {
      const channel = message.mentions.channels.first();
      if (channel?.isTextBased() && memberHas(member, PermissionFlagsBits.ManageGuild)) {
        this.store.update(guild.id, { goodbyeChannelId: channel.id });
        await message.reply(`Güle güle kanalı ${channel} olarak ayarlandı.`);
      }
      return;
    }
    if (normalized === "hosgeldin-kanal" || normalized === "hosgeldinkanal") {
      const channel = message.mentions.channels.first();
      if (channel?.isTextBased() && memberHas(member, PermissionFlagsBits.ManageGuild)) {
        this.store.update(guild.id, { welcomeChannelId: channel.id });
        await message.reply(`Hoş geldin kanalı ${channel} olarak ayarlandı.`);
      }
      return;
    }
    if (normalized === "korma-rol" || normalized === "koruma-rol") {
      const role = message.mentions.roles.first();
      if (role && memberHas(member, PermissionFlagsBits.ManageGuild)) {
        this.store.update(guild.id, { protectionRoleId: role.id });
        await message.reply(`Koruma rolü ${role} olarak ayarlandı.`);
      }
      return;
    }
    if (normalized === "korma-list" || normalized === "koruma-list") {
      const roleId = this.store.get(guild.id).protectionRoleId;
      await message.reply(roleId ? `Koruma rolü: <@&${roleId}>` : "Koruma rolü ayarlanmamış.");
      return;
    }
    if (normalized === "korma-cikar" || normalized === "koruma-cikar") {
      if (memberHas(member, PermissionFlagsBits.ManageGuild)) this.store.update(guild.id, { protectionRoleId: undefined });
      await message.reply("Koruma rolü kaldırıldı.");
      return;
    }

    if (normalized === "owner-ekle" || normalized === "owner-cikar") {
      const user = message.mentions.users.first();
      if (!user || !memberHas(member, PermissionFlagsBits.ManageGuild)) return;
      const owners = this.store.get(guild.id).ownerIds;
      const next = normalized === "owner-ekle"
        ? [...new Set([...owners, user.id])]
        : owners.filter((id) => id !== user.id);
      this.store.update(guild.id, { ownerIds: next });
      await message.reply("Owner listesi güncellendi.");
      return;
    }
  }

  private async handleInteraction(interaction: Interaction) {
    if (interaction.isButton()) {
      await this.handleButton(interaction);
      return;
    }
    if (!interaction.isChatInputCommand() || !interaction.guild) return;

    try {
      const guild = interaction.guild;
      const settings = this.store.get(guild.id);
      const member = await guild.members.fetch(interaction.user.id);
      const command = interaction.commandName;

      if (command === "ip") {
        await interaction.reply(this.ipText());
      } else if (command === "yardim") {
        await interaction.reply(this.helpText());
      } else if (command === "otorol-ayarla") {
        const role = roleFromOption(interaction);
        this.store.update(guild.id, { autoRoleId: role?.id });
        await interaction.reply(`Otorol ${role} olarak ayarlandı.`);
      } else if (command === "otorol-kapat") {
        this.store.update(guild.id, { autoRoleId: undefined });
        await interaction.reply("Otorol kapatıldı.");
      } else if (command === "hosgeldin-kanal") {
        const channel = interaction.options.getChannel("kanal", true);
        this.store.update(guild.id, { welcomeChannelId: channel.id });
        await interaction.reply(`Hoş geldin kanalı <#${channel.id}> olarak ayarlandı.`);
      } else if (command === "gulegule-kanal") {
        const channel = interaction.options.getChannel("kanal", true);
        this.store.update(guild.id, { goodbyeChannelId: channel.id });
        await interaction.reply(`Güle güle kanalı <#${channel.id}> olarak ayarlandı.`);
      } else if (command === "koruma-rol") {
        const role = roleFromOption(interaction);
        this.store.update(guild.id, { protectionRoleId: role?.id });
        await interaction.reply(`Koruma rolü ${role} olarak ayarlandı.`);
      } else if (command === "koruma-list") {
        await interaction.reply(settings.protectionRoleId ? `Koruma rolü: <@&${settings.protectionRoleId}>` : "Koruma rolü ayarlanmamış.");
      } else if (command === "koruma-cikar") {
        this.store.update(guild.id, { protectionRoleId: undefined });
        await interaction.reply("Koruma rolü kaldırıldı.");
      } else if (command === "sil") {
        await this.deleteMessages(interaction, member);
      } else if (command === "ban") {
        await this.banMember(interaction, member);
      } else if (command === "mute") {
        await this.muteMember(interaction, member);
      } else if (command === "cekilis") {
        await this.startGiveaway(interaction);
      } else if (command === "anket") {
        await this.startPoll(interaction);
      } else if (command === "ticket-kur") {
        await this.setupTicket(interaction);
      } else if (command === "kelime-kanal") {
        const channel = interaction.options.getChannel("kanal", true);
        const start = interaction.options.getString("baslangic", true).toLocaleLowerCase("tr-TR");
        this.store.update(guild.id, { wordChannelId: channel.id, word: start, lastGameUserId: undefined });
        await interaction.reply(`Kelime oyun kanalı <#${channel.id}> olarak ayarlandı. Başlangıç harfi: **${start}**`);
      } else if (command === "sayisayma") {
        const channel = interaction.options.getChannel("kanal", true);
        this.store.update(guild.id, { countingChannelId: channel.id, countingNumber: 1, lastGameUserId: undefined });
        await interaction.reply(`Sayı sayma kanalı <#${channel.id}> olarak ayarlandı. Oyun 1 ile başlıyor.`);
      } else if (command === "dc-ceza") {
        const channel = interaction.options.getChannel("kanal", true);
        this.store.update(guild.id, { punishmentLogChannelId: channel.id });
        await interaction.reply(`Discord ceza log kanalı <#${channel.id}> olarak ayarlandı.`);
      } else if (command === "mc-ceza") {
        const channel = interaction.options.getChannel("kanal", true);
        this.store.update(guild.id, { minecraftModerationChannelId: channel.id });
        await interaction.reply(`Minecraft ceza log kanalı <#${channel.id}> olarak ayarlandı.`);
      } else if (command === "mcsohbet") {
        const channel = interaction.options.getChannel("kanal", true);
        this.store.update(guild.id, { minecraftChatChannelId: channel.id });
        await interaction.reply(`Minecraft sohbet kanalı <#${channel.id}> olarak ayarlandı.`);
      } else if (command === "owner-ekle") {
        const target = interaction.options.getUser("uye", true);
        const next = [...new Set([...settings.ownerIds, target.id])];
        this.store.update(guild.id, { ownerIds: next });
        await interaction.reply(`${target} owner listesine eklendi.`);
      } else if (command === "owner-list") {
        await interaction.reply(settings.ownerIds.length ? `Owner listesi: ${settings.ownerIds.map((id) => `<@${id}>`).join(", ")}` : "Owner listesi boş.");
      } else if (command === "owner-cikar") {
        const target = interaction.options.getUser("uye", true);
        this.store.update(guild.id, { ownerIds: settings.ownerIds.filter((id) => id !== target.id) });
        await interaction.reply(`${target} owner listesinden çıkarıldı.`);
      } else if (command === "linkkoruma") {
        this.store.update(guild.id, { linkProtection: true });
        await interaction.reply("Link koruma açıldı. Yetkisiz link paylaşanlar 1 gün susturulur.");
      } else if (command === "linkkoruma-kapat") {
        this.store.update(guild.id, { linkProtection: false });
        await interaction.reply("Link koruma kapatıldı.");
      } else if (command === "aktif") {
        await interaction.reply(this.activeText(guild.id));
      } else if (command === "bakim") {
        const enabled = interaction.options.getBoolean("acik", true);
        this.store.update(guild.id, { maintenance: enabled });
        await interaction.reply(enabled ? "Bakım modu açıldı. Bot durumu bakım olarak görünecek." : "Bakım modu kapatıldı. Bot durumu online olarak görünecek.");
      } else if (command === "site") {
        const action = interaction.options.getString("islem", true);
        if (action === "ekle") {
          const url = interaction.options.getString("url");
          if (!url) return safeReply(interaction, "Ekleme işleminde URL gerekli.");
          this.store.update(guild.id, { siteUrl: url });
          await interaction.reply("Site ayarı güncellendi.");
        } else if (action === "cikar") {
          this.store.update(guild.id, { siteUrl: undefined });
          await interaction.reply("Site ayarı kaldırıldı.");
        } else {
          await interaction.reply(settings.siteUrl ?? "Site ayarlanmamış.");
        }
      } else if (command === "site-ekle") {
        this.store.update(guild.id, { siteUrl: interaction.options.getString("url", true) });
        await interaction.reply("Site ayarı güncellendi.");
      } else if (command === "site-cikar") {
        this.store.update(guild.id, { siteUrl: undefined });
        await interaction.reply("Site ayarı kaldırıldı.");
      } else if (command === "profl") {
        const user = interaction.options.getUser("uye") ?? interaction.user;
        await interaction.reply({ content: `${user.username} profil fotoğrafı`, files: [user.displayAvatarURL({ size: 1024 })] });
      }
    } catch (error) {
      logger.error({ err: error, command: interaction.commandName }, "Command failed");
      await safeReply(interaction, "Komut çalıştırılırken bir hata oluştu. Bot izinlerini kontrol et.");
    }
  }

  private async deleteMessages(interaction: ChatInputCommandInteraction, member: GuildMember) {
    const count = interaction.options.getInteger("sayi", true);
    if (!memberHas(member, PermissionFlagsBits.ManageMessages) || !interaction.channel || !("bulkDelete" in interaction.channel)) {
      await safeReply(interaction, "Bu işlem için mesaj yönetme izni gerekir.");
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const deleted = await interaction.channel.bulkDelete(count, true);
    await interaction.editReply(`${deleted.size} mesaj silindi.`);
  }

  private async banMember(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!memberHas(member, PermissionFlagsBits.BanMembers)) {
      await safeReply(interaction, "Ban iznin yok.");
      return;
    }
    const target = await getMember(interaction, "uye");
    if (!target) return safeReply(interaction, "Üye bulunamadı.");
    const reason = interaction.options.getString("sebep", true);
    await target.ban({ reason });
    await interaction.reply(`${target.user.tag} banlandı. Sebep: ${reason}`);
    await this.sendPunishmentLog(interaction.guild!, `${target.user.tag} banlandı. Sebep: ${reason}`);
  }

  private async muteMember(interaction: ChatInputCommandInteraction, member: GuildMember) {
    if (!memberHas(member, PermissionFlagsBits.ModerateMembers)) {
      await safeReply(interaction, "Mute iznin yok.");
      return;
    }
    const target = await getMember(interaction, "uye");
    if (!target) return safeReply(interaction, "Üye bulunamadı.");
    const amount = interaction.options.getInteger("sure", true);
    const unit = interaction.options.getString("birim", true) as DurationUnit;
    const reason = interaction.options.getString("sebep", true);
    const ms = Math.min(durationMs(amount, unit), 28 * 24 * 60 * 60 * 1000);
    await target.timeout(ms, reason);
    await interaction.reply(`${target.user.tag}, ${durationLabel(amount, unit)} susturuldu. Sebep: ${reason}`);
    await this.sendPunishmentLog(interaction.guild!, `${target.user.tag} mute. Süre: ${durationLabel(amount, unit)}. Sebep: ${reason}`);
  }

  private async startGiveaway(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel;
    if (!channel?.isSendable()) return safeReply(interaction, "Bu komut yazı kanalında kullanılmalı.");
    const title = interaction.options.getString("baslik", true);
    const prize = interaction.options.getString("odul", true);
    const secondPrize = interaction.options.getString("ikinci_odul");
    const winnerCount = interaction.options.getInteger("kazanan", true);
    const amount = interaction.options.getInteger("sure", true);
    const unit = interaction.options.getString("birim", true) as DurationUnit;
    const endAt = Date.now() + durationMs(amount, unit);
    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`🎉 ${title}`)
      .setDescription(`Ödül: **${prize}**${secondPrize ? `\n2. ödül: **${secondPrize}**` : ""}\nKatılmak için 🎉 emojisine bas.\nKazanan sayısı: **${winnerCount}**`)
      .setFooter({ text: `Bitiş: ${new Date(endAt).toLocaleString("tr-TR")}` });
    const message = await channel.send({ embeds: [embed] });
    await message.react("🎉");
    setTimeout(() => void this.finishGiveaway(message, winnerCount, prize), durationMs(amount, unit));
    await interaction.reply({ content: "Çekiliş başlatıldı.", ephemeral: true });
  }

  private async finishGiveaway(message: Message, winnerCount: number, prize: string) {
    const reaction = message.reactions.cache.get("🎉");
    if (!reaction) {
      if (message.channel.isSendable()) await message.channel.send("Çekilişe kimse katılmadı.");
      return;
    }
    const users = [...(await reaction.users.fetch()).filter((user) => !user.bot).values()];
    const winners = users.sort(() => Math.random() - 0.5).slice(0, winnerCount);
    if (message.channel.isSendable()) {
      await message.channel.send(winners.length ? `🎉 **${prize}** çekiliş kazananları: ${winners.map((user) => `<@${user.id}>`).join(", ")}` : "Çekilişe kimse katılmadı.");
    }
  }

  private async startPoll(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel;
    if (!channel?.isSendable()) return safeReply(interaction, "Bu komut yazı kanalında kullanılmalı.");
    const title = interaction.options.getString("baslik", true);
    const options = interaction.options.getString("secenekler", true).split("|").map((value) => value.trim()).filter(Boolean).slice(0, 10);
    if (options.length < 2) return safeReply(interaction, "Anket için en az iki seçenek gerekir. Seçenekleri `|` ile ayır.");
    const amount = interaction.options.getInteger("sure", true);
    const unit = interaction.options.getString("birim", true) as DurationUnit;
    const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const text = options.map((option, index) => `${emojis[index]} ${option}`).join("\n");
    const poll = await channel.send({ embeds: [new EmbedBuilder().setColor(0x0ea5e9).setTitle(`📊 ${title}`).setDescription(`${text}\n\nAnket süresi: ${amount} ${unit}`)] });
    for (let index = 0; index < options.length; index += 1) await poll.react(emojis[index]);
    setTimeout(() => void this.finishPoll(poll, options, emojis), durationMs(amount, unit));
    await interaction.reply({ content: "Anket başlatıldı.", ephemeral: true });
  }

  private async finishPoll(message: Message, options: string[], emojis: string[]) {
    const totals = options.map((option, index) => {
      const reaction = message.reactions.cache.get(emojis[index]);
      return `${emojis[index]} ${option}: **${Math.max(0, (reaction?.count ?? 0) - 1)}**`;
    });
    if (message.channel.isSendable()) {
      await message.channel.send(`📊 **Anket sona erdi**\n${totals.join("\n")}`);
    }
  }

  private async setupTicket(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel;
    const role = roleFromOption(interaction, "yetkili");
    if (!channel?.isSendable() || !role) return safeReply(interaction, "Yetkili rolü ve yazı kanalı gerekli.");
    const title = interaction.options.getString("baslik", true);
    const text = interaction.options.getString("metin", true);
    const embed = new EmbedBuilder().setColor(0x14b8a6).setTitle(title).setDescription(text);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ticket:open").setLabel("Ticket Aç").setStyle(ButtonStyle.Success),
    );
    await channel.send({ embeds: [embed], components: [row] });
    this.store.update(interaction.guild!.id, { ticket: { supportRoleId: role.id, title, text } });
    await interaction.reply({ content: "Ticket paneli kuruldu.", ephemeral: true });
  }

  private async handleButton(interaction: any) {
    if (!interaction.guild) return;
    const settings = this.store.get(interaction.guild.id);
    if (interaction.customId === "ticket:open") {
      if (!settings.ticket) return safeReply(interaction, "Ticket sistemi ayarlanmamış.");
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90),
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: settings.ticket.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ],
      });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket:claim:${ticketChannel.id}`).setLabel("Üstlen").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ticket:close:${ticketChannel.id}`).setLabel("Kapat").setStyle(ButtonStyle.Danger),
      );
      await ticketChannel.send({ content: `${interaction.user} ticket açtı. Yetkili desteği bekleniyor.`, components: [row] });
      await interaction.reply({ content: `Ticket açıldı: ${ticketChannel}`, ephemeral: true });
    } else if (interaction.customId.startsWith("ticket:claim:")) {
      if (!settings.ticket || !interaction.member.roles.cache.has(settings.ticket.supportRoleId)) return safeReply(interaction, "Bu ticketı üstlenmek için yetkili rolün gerekli.");
      await interaction.reply(`Ticket ${interaction.user} tarafından üstlenildi.`);
    } else if (interaction.customId.startsWith("ticket:close:")) {
      if (!settings.ticket || !interaction.member.roles.cache.has(settings.ticket.supportRoleId)) return safeReply(interaction, "Ticket kapatmak için yetkili rolün gerekli.");
      await interaction.reply("Ticket 5 saniye içinde kapatılıyor.");
      setTimeout(() => void interaction.channel?.delete().catch(() => undefined), 5_000);
    }
  }

  private ipText() {
    return `**CubixoraSMP bağlantı bilgileri**\nJava: \`${MINECRAFT_HOST}\`\nJava sürümü: \`1.16.5\`\nJava portu: \`${JAVA_PORT}\`\nBedrock adresi: \`${MINECRAFT_HOST}\`\nBedrock portu: \`${BEDROCK_PORT}\``;
  }

  private activeText(guildId: string) {
    const settings = this.store.get(guildId);
    return `Bot aktif ve 7/24 çalışacak şekilde bağlı.\nMinecraft: \`${MINECRAFT_HOST}\`\nDurum: ${settings.maintenance ? "Bakım modu" : "Online"}${settings.siteUrl ? `\nSite: ${settings.siteUrl}` : ""}`;
  }

  private helpText() {
    return [
      "**Cubixora Bot komutları**",
      "`/ip` veya `e!ip` — Minecraft bilgileri",
      "`/otorol-ayarla`, `/hosgeldin-kanal`, `/gulegule-kanal` — sunucu ayarları",
      "`/sil`, `/ban`, `/mute` — moderasyon",
      "`/koruma-rol`, `/koruma-list`, `/koruma-cikar` — rol koruma",
      "`/cekilis`, `/anket`, `/ticket-kur` — topluluk araçları",
      "`/kelime-kanal`, `/sayisayma` — oyun kanalları",
      "`/dc-ceza`, `/mc-ceza`, `/mcsohbet` — log kanalları",
      "`/owner-ekle`, `/owner-list`, `/owner-cikar`, `/linkkoruma`, `/bakim` — yönetim",
      `Bot davet: ${botInvite(this.client)}`,
    ].join("\n");
  }

  private async sendPunishmentLog(guild: Guild, text: string) {
    const channelId = this.store.get(guild.id).punishmentLogChannelId;
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isSendable()) await channel.send(`🛡️ ${text}`).catch(() => undefined);
  }

  async relayMinecraftEvent(guildId: string, event: MinecraftEvent) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const settings = this.store.get(guildId);
    const channelId = event.type === "chat" || event.type === "join" || event.type === "leave"
      ? settings.minecraftChatChannelId
      : settings.minecraftModerationChannelId;
    if (!channelId) return false;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return false;
    const labels = { chat: "MC Sohbet", join: "MC Giriş", leave: "MC Çıkış", ban: "MC Ban", kick: "MC Kick", mute: "MC Mute" };
    await channel.send(`**${labels[event.type]}** ${event.player ? `\`${event.player}\`` : ""}${event.message ? `: ${event.message}` : ""}${event.reason ? ` — ${event.reason}` : ""}`);
    return true;
  }
}