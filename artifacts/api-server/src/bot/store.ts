import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GuildSettings } from "./types";

const dataPath = path.resolve(
  process.env.DATA_DIR ?? path.join(process.cwd(), "artifacts", "api-server", "data"),
  "guild-settings.json",
);

const defaultSettings = (guildId: string): GuildSettings => ({
  guildId,
  prefix: "e!",
  countingNumber: 1,
  linkProtection: false,
  maintenance: false,
  ownerIds: [],
});

export class GuildStore {
  private settings = new Map<string, GuildSettings>();
  private loaded = false;
  private saveQueue = Promise.resolve();

  async load() {
    if (this.loaded) return;

    try {
      const raw = await readFile(dataPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, GuildSettings>;
      for (const [guildId, value] of Object.entries(parsed)) {
        this.settings.set(guildId, {
          ...defaultSettings(guildId),
          ...value,
          ownerIds: value.ownerIds ?? [],
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    this.loaded = true;
  }

  get(guildId: string) {
    const current = this.settings.get(guildId);
    if (current) return current;

    const created = defaultSettings(guildId);
    this.settings.set(guildId, created);
    return created;
  }

  update(guildId: string, patch: Partial<GuildSettings>) {
    const next = { ...this.get(guildId), ...patch };
    this.settings.set(guildId, next);
    this.queueSave();
    return next;
  }

  private queueSave() {
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(dataPath), { recursive: true });
        const data = Object.fromEntries(this.settings.entries());
        await writeFile(dataPath, JSON.stringify(data, null, 2), "utf8");
      });
  }
}