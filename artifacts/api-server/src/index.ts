import app from "./app";
import { logger } from "./lib/logger";
import { DiscordBot } from "./bot/discord";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const discordBot = new DiscordBot();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

void discordBot.start().catch((error) => {
  logger.error({ err: error }, "Discord bot failed to start");
  process.exitCode = 1;
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down");
  await discordBot.stop();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export { discordBot };
