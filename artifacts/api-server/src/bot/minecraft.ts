import { status, statusBedrock } from "minecraft-server-util";
import type { Client } from "discord.js";
import { ActivityType } from "discord.js";
import { logger } from "../lib/logger";

export const MINECRAFT_HOST = "cubixorasmp.play.hosting";
export const JAVA_PORT = 25565;
export const BEDROCK_PORT = 19132;

export async function getMinecraftStatus() {
  try {
    const [java, bedrock] = await Promise.allSettled([
      status(MINECRAFT_HOST, JAVA_PORT, { timeout: 4000 }),
      statusBedrock(MINECRAFT_HOST, BEDROCK_PORT, { timeout: 4000 }),
    ]);

    const javaStatus = java.status === "fulfilled" ? java.value : undefined;
    const bedrockStatus = bedrock.status === "fulfilled" ? bedrock.value : undefined;
    const onlinePlayers =
      javaStatus?.players.online ?? bedrockStatus?.players.online ?? 0;

    return {
      online: Boolean(javaStatus || bedrockStatus),
      onlinePlayers,
      javaVersion: javaStatus?.version.name ?? "Java 1.16.5",
      javaPlayers: javaStatus?.players.online ?? 0,
      bedrockPlayers: bedrockStatus?.players.online ?? 0,
    };
  } catch (error) {
    logger.warn({ err: error }, "Minecraft status check failed");
    return {
      online: false,
      onlinePlayers: 0,
      javaVersion: "Java 1.16.5",
      javaPlayers: 0,
      bedrockPlayers: 0,
    };
  }
}

export function startMinecraftPresence(client: Client, isMaintenance: () => boolean) {
  let running = true;

  const update = async () => {
    if (!running || !client.user) return;

    const status = await getMinecraftStatus();
    const maintenance = isMaintenance();
    const label = maintenance
      ? "Minecraft sunucusu bakımda"
      : `${status.onlinePlayers} oyuncu | ${MINECRAFT_HOST}`;

    await client.user.setPresence({
      status: maintenance ? "dnd" : status.online ? "online" : "idle",
      activities: [{ name: label, type: ActivityType.Watching }],
    });
  };

  void update();
  const timer = setInterval(() => void update(), 60_000);
  timer.unref();

  return () => {
    running = false;
    clearInterval(timer);
  };
}