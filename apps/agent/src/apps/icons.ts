import type { FileSystem, IconExtractor } from "../ports";

// Íconos (docs/PLAN.md D19): se sacan de a tandas con PowerShell, se guardan en disco como PNG en base64 y se piden de a 10.
// Solo se sacan íconos de claves que el propio agente ofreció (`register`): el celu no puede pedir un ícono de una ruta cualquiera.

export interface Icons {
  /** Anota de dónde sale el ícono de una clave (AppID del catálogo o ruta de un .exe). */
  register(key: string, parsing: string): void;
  /** El PNG (base64) de cada clave, o `null` si no hay. Saca los que faltan en una sola tanda. */
  get(keys: string[]): Promise<{ key: string; png: string | null }[]>;
}

/** ~16 KB de binario en base64. */
const MAX_B64 = 21_900;
const MAX_REGISTERED = 400;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function createIcons(deps: { extractor?: IconExtractor; fs: FileSystem; dir: string }): Icons {
  const parsingOf = new Map<string, string>();
  const memory = new Map<string, string | null>();
  /** Las tandas se hacen de a una: dos pedidos a la vez no lanzan dos PowerShell. */
  let queue: Promise<unknown> = Promise.resolve();

  const path = (key: string) => `${deps.dir}/${key}.b64`;

  async function fromDisk(key: string): Promise<string | null> {
    const text = (await deps.fs.readFile(path(key)))?.trim() ?? null;
    if (text && text.length <= MAX_B64 && BASE64.test(text)) return text;
    return null;
  }

  async function resolve(keys: string[]): Promise<{ key: string; png: string | null }[]> {
    const known = keys.filter((k) => parsingOf.has(k));
    const missing: string[] = [];
    for (const k of known) {
      if (memory.has(k)) continue;
      const disk = await fromDisk(k);
      if (disk) memory.set(k, disk);
      else missing.push(k);
    }
    if (missing.length > 0 && deps.extractor) {
      try {
        await deps.extractor.extract(missing.map((key) => ({ key, parsing: parsingOf.get(key)! })), deps.dir);
      } catch {
        // sin PowerShell o con un error: esos íconos quedan en null
      }
      for (const k of missing) memory.set(k, await fromDisk(k)); // null si no salió: no se reintenta en cada pedido
    } else {
      for (const k of missing) memory.set(k, null);
    }
    return keys.map((key) => ({ key, png: parsingOf.has(key) ? (memory.get(key) ?? null) : null }));
  }

  return {
    register(key, parsing) {
      if (!parsingOf.has(key) && parsingOf.size >= MAX_REGISTERED) {
        const oldest = parsingOf.keys().next().value as string;
        parsingOf.delete(oldest);
        memory.delete(oldest);
      }
      parsingOf.delete(key); // se re-inserta al final: así el orden es LRU y no se expulsan primero los íconos de la biblioteca
      parsingOf.set(key, parsing);
    },
    get(keys) {
      const run = queue.then(() => resolve(keys));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
