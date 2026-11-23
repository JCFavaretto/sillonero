import { useEffect } from "react";
import { queryApps } from "@/apps/commands";
import { useAudio } from "./store";

// Carátulas de lo que suena: se piden aparte (como los íconos de B3), de a 3, con una pausa corta para juntarlas (D34).

const BATCH = 3;
const DELAY_MS = 150;

/** Lo pedido que todavía no llegó. Vence a los 5 s: si la PC no contestó (límite de ritmo, conexión cortada), se puede volver a pedir. */
const RETRY_MS = 5_000;
const asked = new Set<string>();
const expiries = new Set<ReturnType<typeof setTimeout>>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Manda lo que se juntó, de a 3 por pedido. */
export function flushArt(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length > 0) {
    const keys = queue.splice(0, BATCH);
    if (queryApps("media.art", { keys }) === null) {
      // sin conexión: se vuelve a intentar cuando alguien las pida de nuevo
      for (const k of keys) asked.delete(k);
      for (const k of queue) asked.delete(k);
      break;
    }
  }
  queue = [];
}

export function requestArt(key: string): void {
  if (asked.has(key) || key in useAudio.getState().art) return;
  asked.add(key);
  const expiry = setTimeout(() => {
    expiries.delete(expiry);
    asked.delete(key);
  }, RETRY_MS);
  expiries.add(expiry);
  queue.push(key);
  timer ??= setTimeout(flushArt, DELAY_MS);
}

/** Una conexión caída pierde los pedidos en vuelo: lo que no llegó se vuelve a pedir al reconectar. */
export function forgetUnresolvedArt(): void {
  const have = useAudio.getState().art;
  for (const k of [...asked]) if (!(k in have)) asked.delete(k);
}

/** Para los tests y al olvidar la PC. */
export function resetArt(): void {
  for (const e of expiries) clearTimeout(e);
  expiries.clear();
  asked.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** La carátula (data URI) de un tema, o `null` si no hay o todavía no llegó (la tarjeta muestra la inicial o la ruedita). */
export function useArt(key: string | null): { uri: string | null; loading: boolean } {
  const has = useAudio((s) => (key ? key in s.art : true));
  const uri = useAudio((s) => (key ? s.art[key] : null)) ?? null;
  const loading = key !== null && !has;
  useEffect(() => {
    if (!key) return;
    requestArt(key);
    if (!loading) return;
    // Mientras no llega, se reintenta cada 5 s (el pedido anterior ya venció).
    const id = setInterval(() => requestArt(key), RETRY_MS + 100);
    return () => clearInterval(id);
  }, [key, loading]);
  return { uri, loading };
}
