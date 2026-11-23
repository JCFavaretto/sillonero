import * as fs from "node:fs";
import * as path from "node:path";
import es from "@/i18n/es.json";

/** Todas las claves de es.json en forma "a.b.c". */
function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
// Los plurales de i18next viven como `clave_one` / `clave_other`: la clave base (`t("a.b", { count })`) también vale.
const KEYS = new Set(flatten(es).flatMap((k) => (/_(one|other|zero|few|many)$/.test(k) ? [k, k.replace(/_(one|other|zero|few|many)$/, "")] : [k])));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}
const root = path.resolve(__dirname, "..");
const files = sourceFiles(path.join(root, "src"));

/** Claves usadas: t("a.b") y literales "errors.xxx" (las de la máquina de conexión). */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/\bt\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g)) used.set(m[1] as string, f);
    for (const m of text.matchAll(/["'`](errors\.[A-Za-z0-9_.]+)["'`]/g)) used.set(m[1] as string, f);
  }
  return used;
}

describe("i18n", () => {
  it("toda clave usada en el código existe en es.json", () => {
    const missing = [...usedKeys()].filter(([key]) => !KEYS.has(key)).map(([key, file]) => `${key}  (${path.relative(root, file)})`);
    expect(missing).toEqual([]);
  });

  it("existe el texto de cada error que puede producir la máquina de conexión", () => {
    const qr = ["not_ours", "old_version", "bad_format", "host_not_private", "expired"].map((r) => `errors.qr.${r}`);
    const pair = ["rejected", "timeout", "invalid_code", "busy"].map((r) => `errors.pair.${r}`);
    const fixed = ["revoked", "authFailed", "incompatible", "rateLimited", "notPrivate", "unreachable", "protocol", "securityUpgrade", "storage"].map(
      (r) => `errors.${r}`,
    );
    expect([...qr, ...pair, ...fixed].filter((k) => !KEYS.has(k))).toEqual([]);
  });

  it("no hay textos vacíos", () => {
    const empty = flatten(es).filter((k) => {
      const value = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], es);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(empty).toEqual([]);
  });

  it("avisa de claves que no se usan (informativo, no falla)", () => {
    const used = new Set(usedKeys().keys());
    const unused = [...KEYS].filter((k) => !used.has(k) && !k.startsWith("errors."));
    if (unused.length > 0) console.info(`Claves de es.json sin usar todavía: ${unused.length}`);
    expect(Array.isArray(unused)).toBe(true);
  });
});
