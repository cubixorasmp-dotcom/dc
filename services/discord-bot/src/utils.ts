import type { GameUnit } from "./types.js";

const unitMs: Record<GameUnit, number> = {
  saniye: 1_000,
  dakika: 60_000,
  saat: 3_600_000,
  gün: 86_400_000,
};

export function parseDuration(amount: number, unit: string): number | null {
  const normalized = unit.toLocaleLowerCase("tr-TR").replace("ü", "u");
  const map: Record<string, GameUnit> = {
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
    days: "gün",
  };
  const resolved = map[normalized];
  return resolved && Number.isFinite(amount) && amount > 0 ? amount * unitMs[resolved] : null;
}

export function durationText(amount: number, unit: string): string {
  return `${amount} ${unit}`;
}

export function trimReason(reason: string | undefined, fallback = "Belirtilmedi"): string {
  return reason?.trim() || fallback;
}

export function safeChannelName(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90) || "ticket";
}

export function isUrl(text: string): boolean {
  return /(https?:\/\/|discord\.gg\/|www\.)\S+/i.test(text);
}

export function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase("tr-TR");
}