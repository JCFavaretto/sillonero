import { SEARCH_MAX, type CatalogApp } from "@proyecto-e/protocol";
import type { AppCatalog, Clock } from "../ports";
import { iconKeyFor } from "./windowsModel";

// Catálogo de apps instaladas (docs/PLAN.md D18): lo que lista Windows en el menú Inicio, sin el ruido.
// El celu busca; nunca recibe la lista entera (175 apps no entran cómodas en un mensaje).

export interface Catalog {
  search(query: string): Promise<{ items: CatalogApp[]; total: number }>;
  /** ¿Está este AppID en el catálogo? Es la única forma de que un AppID del celu se acepte (D20). */
  has(appId: string): Promise<boolean>;
  nameOf(appId: string): Promise<string | null>;
}

const TTL_MS = 10 * 60_000;
const NOISE_NAME = /^(uninstall|desinstalar|unins)/i;
const DOCUMENT = /\.(html?|chm|txt|url|pdf)$/i;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function createCatalog(deps: { source: AppCatalog; clock: Clock; ttlMs?: number }): Catalog {
  const ttl = deps.ttlMs ?? TTL_MS;
  let cache: { at: number; apps: { appId: string; name: string; key: string }[] } | null = null;
  let loading: Promise<{ appId: string; name: string; key: string }[]> | null = null;

  async function load() {
    if (cache && deps.clock.now() - cache.at < ttl) return cache.apps;
    loading ??= deps.source
      .list()
      .then((rows) => {
        const seen = new Set<string>();
        const apps = rows
          .filter((r) => !NOISE_NAME.test(r.name.trim()) && !DOCUMENT.test(r.appId) && r.name.trim() !== "" && r.appId.length <= 260)
          .filter((r) => (seen.has(r.appId) ? false : (seen.add(r.appId), true)))
          .map((r) => ({ appId: r.appId, name: r.name.trim().slice(0, 80), key: fold(r.name) }))
          .sort((a, b) => a.key.localeCompare(b.key));
        cache = { at: deps.clock.now(), apps };
        return apps;
      })
      .catch((err: unknown) => {
        if (cache) return cache.apps; // lectura fallida: se sigue con la lista vieja
        throw err;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  return {
    async search(query) {
      const apps = await load();
      const q = fold(query.trim());
      const starts = apps.filter((a) => a.key.startsWith(q));
      const contains = q ? apps.filter((a) => !a.key.startsWith(q) && a.key.includes(q)) : [];
      const all = [...starts, ...contains];
      return {
        items: all.slice(0, SEARCH_MAX).map((a) => ({ appId: a.appId, name: a.name, iconKey: iconKeyFor(a.appId) })),
        total: all.length,
      };
    },
    async has(appId) {
      return (await load()).some((a) => a.appId === appId);
    },
    async nameOf(appId) {
      return (await load()).find((a) => a.appId === appId)?.name ?? null;
    },
  };
}
