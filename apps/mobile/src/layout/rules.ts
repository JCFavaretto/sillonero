/** Reglas de layout para vertical y apaisado. Puras, para poder testearlas sin pantalla. */

export type ColumnsKind = "deck" | "list";

/** Cuántas columnas entran según el ancho (en dp). Valores iniciales: se ajustan probando en el celu. */
export function columnsFor(width: number, kind: ColumnsKind): number {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  if (kind === "deck") return w < 480 ? 3 : w < 700 ? 4 : 5;
  return w < 600 ? 1 : 2;
}

export function isLandscape(width: number, height: number): boolean {
  return width > height;
}

/**
 * Menú de navegación: barra abajo en vertical; en apaisado la barra ocuparía demasiado,
 * así que se esconde y se abre con un botón (panel por encima del contenido).
 */
export function menuModeFor(landscape: boolean): "bottom-bar" | "drawer" {
  return landscape ? "drawer" : "bottom-bar";
}
