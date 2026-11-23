import { useEffect } from "react";
import { queryApps } from "./commands";
import { useApps } from "./store";

// Íconos de la PC: se piden de a 10, con una pausa corta para juntar los de una pantalla entera (docs/PLAN.md D19).

const BATCH = 10;
const DELAY_MS = 150;

const asked = new Set<string>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Manda lo que se juntó, de a 10 por pedido. */
export function flushIcons(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length > 0) {
    const keys = queue.splice(0, BATCH);
    if (queryApps("icon.get", { keys }) === null) {
      // sin conexión: se vuelve a intentar cuando alguien los pida de nuevo (también los que quedaban en la cola)
      for (const k of keys) asked.delete(k);
      for (const k of queue) asked.delete(k);
      break;
    }
  }
  queue = [];
}

export function requestIcon(key: string): void {
  if (asked.has(key) || key in useApps.getState().icons) return;
  asked.add(key);
  queue.push(key);
  timer ??= setTimeout(flushIcons, DELAY_MS);
}

/** Olvida lo que se pidió y no llegó (una conexión caída pierde los pedidos en vuelo): se vuelve a pedir al reconectar. */
export function forgetUnresolved(): void {
  const have = useApps.getState().icons;
  for (const k of [...asked]) if (!(k in have)) asked.delete(k);
}

/** Para los tests y al olvidar la PC: olvida lo ya pedido. */
export function resetIcons(): void {
  asked.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** El PNG (base64) de un ícono, o `null` si no hay (o todavía no llegó: la pantalla muestra la inicial). */
export function useIcon(key: string | null): string | null {
  const png = useApps((s) => (key ? s.icons[key] : null)) ?? null;
  useEffect(() => {
    if (key) requestIcon(key);
  }, [key]);
  return png;
}
