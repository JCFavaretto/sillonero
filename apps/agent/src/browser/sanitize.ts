import { BrowserItem, BrowserTab, ListId, MAX_BROWSER_ITEMS, MAX_BROWSER_TABS, TabMedia, VideoId, type BrowserItem as Item, type BrowserTab as Tab, type TabMedia as Media } from "@proyecto-e/protocol";

// Todo lo que llega de la extensión es un dato no confiable (docs/PLAN.md D90): se limpia, se recorta y se valida antes de
// llegar al celu. Lo que no pasa la validación se descarta; nunca se manda "casi bien".

/** Texto de una línea: sin caracteres de control, con los espacios juntos y recortado. */
const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** El reproductor de una pestaña (D99): solo los campos conocidos, validados. Cualquier cosa rara = sin reproductor. */
function sanitizeMedia(raw: unknown): Media | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  const parsed = TabMedia.safeParse({ paused: m.paused, positionMs: m.positionMs, durationMs: m.durationMs, rate: m.rate, muted: m.muted, volume: m.volume, canSeek: m.canSeek });
  return parsed.success ? parsed.data : undefined;
}

export function sanitizeTabs(raw: unknown): Tab[] {
  if (!Array.isArray(raw)) return [];
  const out: Tab[] = [];
  for (const t of raw) {
    if (out.length >= MAX_BROWSER_TABS) break;
    if (typeof t !== "object" || t === null) continue;
    const r = t as Record<string, unknown>;
    const parsed = BrowserTab.safeParse({
      id: r.id,
      windowId: r.windowId,
      title: clean(r.title, 120),
      host: clean(r.host, 100).toLowerCase().replace(/^www\./, ""),
      active: r.active === true,
      audible: r.audible === true,
      pinned: r.pinned === true,
    });
    if (!parsed.success) continue;
    const media = sanitizeMedia(r.media);
    out.push(media ? { ...parsed.data, media } : parsed.data);
  }
  return out;
}

export function sanitizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const out: Item[] = [];
  for (const it of raw) {
    if (out.length >= MAX_BROWSER_ITEMS) break;
    if (typeof it !== "object" || it === null) continue;
    const r = it as Record<string, unknown>;
    const candidate: Record<string, unknown> = {
      kind: r.kind,
      id: clean(r.id, 80),
      title: clean(r.title, 120),
    };
    const subtitle = clean(r.subtitle, 80);
    const meta = clean(r.meta, 24);
    if (subtitle) candidate.subtitle = subtitle;
    if (meta) candidate.meta = meta;
    if (typeof r.url === "string") candidate.url = r.url.trim();
    if (r.current === true) candidate.current = true;
    if (typeof r.index === "number") candidate.index = r.index;
    if (typeof r.listId === "string") candidate.listId = r.listId;
    const parsed = BrowserItem.safeParse(candidate);
    if (!parsed.success) continue;
    if (!parsed.data.title) continue; // un elemento sin nombre no se puede mostrar
    if (parsed.data.kind === "bookmark" && !parsed.data.url) continue;
    // Un video o una lista tiene que tener un id que la extensión pueda tocar después (el celu lo manda de vuelta).
    if (parsed.data.kind === "video" && !VideoId.safeParse(parsed.data.id).success) continue;
    if (parsed.data.kind === "list" && !ListId.safeParse(parsed.data.id).success) continue;
    out.push(parsed.data);
  }
  return out;
}

/** Cuánto puede diferir la posición de lo esperado sin que cuente como un salto (igual que en el audio, D97). */
const POSITION_TOLERANCE_MS = 2_000;

/**
 * Las pestañas tal como se comparan para decidir si hay que avisar al celu (D99). La posición de un video avanza sola, así que
 * no se compara tal cual: reproduciendo se compara el "momento en que empezó" (ahora − posición ÷ velocidad); en pausa o al
 * final, la posición; en un vivo, nada (no hay barra). Si difiere menos que la tolerancia del último valor avisado, se da por
 * igual. `keys` (id de pestaña → ese valor) es lo que hay que pasar en la próxima comparación.
 */
export function comparableTabs(tabs: readonly Tab[], now: number, prev: ReadonlyMap<number, number>): { json: string; keys: Map<number, number> } {
  const keys = new Map<number, number>();
  const view = tabs.map((t) => {
    if (!t.media) return t;
    const { positionMs, ...rest } = t.media;
    if (rest.durationMs === null) return { ...t, media: rest };
    const moving = !rest.paused && positionMs < rest.durationMs;
    const fresh = moving ? Math.round(now - positionMs / rest.rate) : positionMs;
    const last = prev.get(t.id);
    const key = last !== undefined && Math.abs(fresh - last) <= POSITION_TOLERANCE_MS ? last : fresh;
    keys.set(t.id, key);
    return { ...t, media: { ...rest, key } };
  });
  return { json: JSON.stringify(view), keys };
}
