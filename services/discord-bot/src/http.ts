import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { MinecraftBridge, MinecraftEvent } from "./minecraft.js";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function startHttpServer(bridge: MinecraftBridge): ReturnType<typeof createServer> {
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
        const event = JSON.parse(await readBody(request)) as MinecraftEvent;
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