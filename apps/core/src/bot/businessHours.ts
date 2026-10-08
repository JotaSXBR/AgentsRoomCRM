import type { BusinessHours } from "../stores/store.js";

// Índices de dia (getDay, 0 = domingo) → chave do mapa de horários.
// Formato do mapa: { "1": [["09:00", "12:00"], ["13:00", "18:00"]], ... }.
// Faixas nulas/ausentes = dia fechado. Mapa vazio = sempre aberto.

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function partsInTz(
  timezone: string,
  date: Date,
): { weekdayIndex: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string | undefined =>
    parts.find((p) => p.type === type)?.value;
  const weekdayIndex = WD_SHORT.indexOf(get("weekday") ?? "");
  let hour = get("hour") ?? "00";
  if (hour === "24") hour = "00";
  return { weekdayIndex, hhmm: `${hour}:${get("minute") ?? "00"}` };
}

export function isWithinBusinessHours(
  businessHours: BusinessHours,
  timezone: string,
  date: Date = new Date(),
): boolean {
  if (!businessHours || Object.keys(businessHours).length === 0) return true;
  const { weekdayIndex, hhmm } = partsInTz(timezone || "UTC", date);
  if (weekdayIndex < 0) return true;
  const ranges = businessHours[String(weekdayIndex)];
  if (!ranges) return false;
  return ranges.some(([start, end]) => hhmm >= start && hhmm < end);
}
