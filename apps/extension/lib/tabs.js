// Pestañas y marcadores en la forma que entiende el agente (docs/PLAN.md D90): de cada pestaña solo viaja el título y el sitio,
// nunca la dirección completa. Las ventanas de incógnito no se listan.

const MAX_TABS = 60;
const MAX_BOOKMARKS = 80;

/** El sitio sin "www." (o "" si no tiene). */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Una pestaña de Chrome → la del agente; `null` si no se debe mostrar. */
export function toTab(t) {
  if (!t || typeof t.id !== "number" || t.id < 0 || t.incognito === true) return null;
  const url = typeof t.url === "string" && t.url ? t.url : typeof t.pendingUrl === "string" ? t.pendingUrl : "";
  return {
    id: t.id,
    windowId: typeof t.windowId === "number" ? t.windowId : 0,
    title: String(t.title ?? "").slice(0, 120),
    host: /^(chrome|edge|brave|opera):\/\//.test(url) ? "navegador" : hostOf(url),
    active: t.active === true,
    audible: t.audible === true,
    pinned: t.pinned === true,
  };
}

/** Todas las pestañas, las que suenan primero no: se respeta el orden del navegador (ventana, posición). */
export function toTabs(list) {
  return (list ?? [])
    .slice()
    .sort((a, b) => (a.windowId ?? 0) - (b.windowId ?? 0) || (a.index ?? 0) - (b.index ?? 0))
    .map(toTab)
    .filter(Boolean)
    .slice(0, MAX_TABS);
}

/** El árbol de marcadores → una lista plana donde cada marcador lleva el nombre de su carpeta. Solo direcciones http(s). */
export function flattenBookmarks(tree) {
  const out = [];
  const walk = (node, folder) => {
    if (out.length >= MAX_BOOKMARKS || !node) return;
    if (Array.isArray(node.children)) {
      const name = node.title || folder;
      for (const child of node.children) walk(child, name);
      return;
    }
    if (typeof node.url === "string" && /^https?:\/\//i.test(node.url)) {
      out.push({ kind: "bookmark", id: String(node.id), title: String(node.title || hostOf(node.url)).slice(0, 120), subtitle: folder, url: node.url });
    }
  };
  for (const root of tree ?? []) walk(root, "");
  return out;
}
