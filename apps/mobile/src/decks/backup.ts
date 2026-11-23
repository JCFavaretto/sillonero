import { buildArchive, parseArchive, planImport, type ImageMap, type ImportPlan } from "./archive";
import type { DecksData } from "./model";
import { decksActions, getDecksStorage, newDeckId, newKeyId, useDecks } from "./store";

// Exportar e importar los decks (D106). La E/S (compartir, elegir un archivo) entra por parámetro: la real vive en `backupIo.ts`.

const stamp = (d: Date) => d.toISOString().slice(0, 10);

export async function exportDecks(io: { share: (fileName: string, text: string) => Promise<void>; now: () => Date }): Promise<{ ok: true } | { ok: false }> {
  const data = useDecks.getState().data;
  const storage = getDecksStorage();
  if (!data || !storage) return { ok: false };
  try {
    const now = io.now();
    await io.share(`decks-${stamp(now)}.json`, await buildArchive(data, storage, now));
    decksActions.markExported(now.toISOString());
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type ReadResult = { ok: true; data: DecksData; images: ImageMap } | { ok: false; reason: "canceled" | "invalid" | "too_big" | "unreadable" };

/** Lee el archivo que eligió el usuario (`null` = canceló) y lo valida entero. */
export async function readImportFile(read: () => Promise<string | null>): Promise<ReadResult> {
  let text: string | null;
  try {
    text = await read();
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.constructor.name === "TooBigError" ? "too_big" : "unreadable" };
  }
  if (text === null) return { ok: false, reason: "canceled" };
  const p = parseArchive(text);
  return p.ok ? p : { ok: false, reason: p.reason };
}

/** Qué quedaría al importar, sin tocar nada (para mostrar "entran N, quedan afuera M"). */
export const previewImport = (data: DecksData, mode: "add" | "replace"): Pick<ImportPlan, "added" | "dropped"> => {
  const cur = useDecks.getState().data;
  if (!cur) return { added: 0, dropped: 0 };
  const p = planImport(cur, data, {}, mode, (x) => (x === "d" ? "d_p" : "k_p"));
  return { added: p.added, dropped: p.dropped };
};

/** Aplica la importación: primero las imágenes al disco, después los decks (así nunca hay una tecla con una imagen que falta). */
export async function importDecks(data: DecksData, images: ImageMap, mode: "add" | "replace"): Promise<Pick<ImportPlan, "added" | "dropped"> & { failed?: true }> {
  const cur = useDecks.getState().data;
  const storage = getDecksStorage();
  if (!cur || !storage) return { added: 0, dropped: 0, failed: true };
  const plan = planImport(cur, data, images, mode, (p) => (p === "d" ? newDeckId() : newKeyId()));
  const written: string[] = [];
  try {
    for (const [name, b64] of Object.entries(plan.images)) {
      await storage.writeImage(name, b64);
      written.push(name);
    }
  } catch {
    // Disco lleno o imagen rota: se deshace lo que ya se escribió y no se importa nada (nunca a medias).
    await Promise.all(written.map((n) => storage.removeImage(n).catch(() => undefined)));
    return { added: 0, dropped: 0, failed: true };
  }
  decksActions.mutate(() => plan.data);
  return { added: plan.added, dropped: plan.dropped };
}
