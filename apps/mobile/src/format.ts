export interface UptimeUnits {
  day: string;
  hour: string;
  minute: string;
  lessThanMinute: string;
}

const ES_UNITS: UptimeUnits = { day: "d", hour: "h", minute: "min", lessThanMinute: "menos de 1 min" };

/** "2 h 15 min", "1 d 3 h", "menos de 1 min". Hecho a mano: no depende de Intl (que en Hermes puede faltar). Las unidades vienen de i18n. */
export function formatUptime(totalSeconds: number, u: UptimeUnits = ES_UNITS): string {
  const sec = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days} ${u.day} ${hours} ${u.hour}` : `${days} ${u.day}`;
  if (hours > 0) return minutes > 0 ? `${hours} ${u.hour} ${minutes} ${u.minute}` : `${hours} ${u.hour}`;
  if (minutes > 0) return `${minutes} ${u.minute}`;
  return u.lessThanMinute;
}

/** Bytes → GB (base 1024) con una decimal y coma: 10500000000 → "9,8". */
export function formatGB(bytes: number): string {
  const gb = Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 ** 3 : 0;
  return gb.toFixed(1).replace(".", ",");
}

/** "2026-11-06T12:00:00.000Z" → "06/11/2026" (fecha local, día/mes/año). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
