import { Router, type IRouter } from "express";
import { discordBot } from "../index";
import type { MinecraftEvent } from "../bot/types";

const router: IRouter = Router();

router.post("/minecraft/event", async (req, res) => {
  const configuredSecret = process.env.MC_WEBHOOK_SECRET;
  if (!configuredSecret || req.header("x-mc-secret") !== configuredSecret) {
    res.status(401).json({ error: "Minecraft webhook is not configured or secret is invalid." });
    return;
  }

  const body = req.body as { guildId?: string; event?: MinecraftEvent };
  if (!body.guildId || !body.event?.type) {
    res.status(400).json({ error: "guildId and event.type are required." });
    return;
  }

  const sent = await discordBot.relayMinecraftEvent(body.guildId, body.event);
  res.json({ ok: sent });
});

export default router;