import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Lo que está dentro de `useAnimatedStyle(() => …)` corre en el hilo de UI, y ahí solo se pueden llamar "worklets" (las funciones de
 * Reanimated y `Math`). Llamar a una función común (por ejemplo `dotAngle()`) rompe la app EN EL CELU con un error de worklets, y en
 * Jest no se nota porque no hay dos hilos. Este test lo atrapa mirando el código: lo que haga falta calcular se calcula afuera.
 */
const ALLOWED = new Set(["useAnimatedStyle", "useDerivedValue", "Math.min", "Math.max", "Math.round", "Math.floor", "Math.abs", "interpolate", "interpolateColor"]);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

/** El texto de cada llamada `useAnimatedStyle(…)` / `useDerivedValue(…)`, con los paréntesis balanceados. */
function workletBlocks(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:useAnimatedStyle|useDerivedValue)\s*\(/g)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i;
    for (; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")" && --depth === 0) break;
    }
    out.push(code.slice(start + 1, i));
  }
  return out;
}

const root = path.resolve(__dirname, "..", "src");

describe("las funciones de animación solo llaman a worklets", () => {
  const files = sources(root);

  it("hay animaciones que revisar (el test no está vacío)", () => {
    const total = files.flatMap((f) => workletBlocks(fs.readFileSync(f, "utf8"))).length;
    expect(total).toBeGreaterThan(5);
  });

  it("dentro de useAnimatedStyle / useDerivedValue no se llama a funciones comunes", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const block of workletBlocks(fs.readFileSync(f, "utf8"))) {
        const body = block.replace(/\/\/.*$/gm, "").replace(/`[^`]*`/g, (s) => s.replace(/\$\{/g, "${ ")); // sin comentarios
        for (const call of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
          const name = call[1]!;
          if (!ALLOWED.has(name) && !["if", "for", "while", "switch", "return", "function"].includes(name)) bad.push(`${path.relative(root, f)}: ${name}()`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("el detector sí atrapa el caso que rompió la app (una función común dentro de la animación)", () => {
    const sample = "const s = useAnimatedStyle(() => ({ transform: [{ rotate: `${dotAngle(i, n)}deg` }] }));";
    const found = [...workletBlocks(sample)[0]!.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)].map((m) => m[1]!);
    expect(found.filter((n) => !ALLOWED.has(n))).toContain("dotAngle");
  });
});
