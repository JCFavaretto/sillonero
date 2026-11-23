import type { Monitor } from "@proyecto-e/protocol";

// Dónde queda cada pantalla al elegir un orden de izquierda a derecha. Puro: no toca Windows.

export type Position = { x: number; y: number };

/**
 * Las pantallas prendidas van una al lado de la otra, en el orden pedido, sin huecos ni solapes (cada una
 * empieza donde termina la anterior). El desnivel vertical de cada una respecto de las demás se conserva, y
 * todo se corre para que la principal quede en (0,0): Windows siempre la tiene ahí.
 * `null` si el orden no es exactamente el de las pantallas prendidas o no hay principal entre ellas.
 */
export function planOrder(
  monitors: Pick<Monitor, "id" | "primary" | "enabled" | "bounds">[],
  order: string[],
): Map<string, Position> | null {
  const on = monitors.filter((m) => m.enabled && m.bounds);
  if (order.length === 0 || order.length !== on.length || new Set(order).size !== order.length) return null;
  const byId = new Map(on.map((m) => [m.id, m]));
  if (!order.every((id) => byId.has(id))) return null;
  const primary = on.find((m) => m.primary);
  if (!primary) return null;

  const raw = new Map<string, Position>();
  let x = 0;
  for (const id of order) {
    const m = byId.get(id)!;
    raw.set(id, { x, y: m.bounds!.y });
    x += m.bounds!.w;
  }
  const shift = raw.get(primary.id)!;
  const out = new Map<string, Position>();
  for (const [id, p] of raw) out.set(id, { x: p.x - shift.x, y: p.y - primary.bounds!.y });
  return out;
}
