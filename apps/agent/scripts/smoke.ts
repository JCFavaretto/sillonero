import { fork, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_OUT } from "./build";

// `pnpm smoke:agent` (docs/PLAN.md 8.6.3, B6.5): prueba de humo de la carpeta portable YA armada, con el proyecto-e.exe de verdad
// y los cuatro procesos hijo. Solo lecturas: no registra atajos, no toca el registro, no mueve el mouse ni cambia pantallas.

const dir = resolve(process.argv[2] ?? DEFAULT_OUT);
const exe = join(dir, "proyecto-e.exe");
const app = join(dir, "app");
let failures = 0;
const ok = (name: string, detail = "") => console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
const bad = (name: string, why: string) => {
  failures++;
  console.log(`  FALLA ${name} — ${why}`);
};

/** Lanza un hijo con el exe portable, le manda un pedido por IPC y espera la respuesta. */
function ask(file: string, req: Record<string, unknown>, ms = 15_000): Promise<unknown> {
  return new Promise((resolveReply, reject) => {
    const cp = fork(join(app, file), [], { execPath: exe, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    let err = "";
    cp.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => {
      cp.kill();
      reject(new Error(`sin respuesta en ${ms} ms. ${err.trim()}`));
    }, ms);
    cp.once("message", (m) => {
      clearTimeout(timer);
      cp.kill();
      resolveReply(m);
    });
    cp.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`el hijo terminó (${code}) sin responder. ${err.trim()}`));
    });
    cp.send(req);
  });
}

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    ok(name, await run());
  } catch (e) {
    bad(name, e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<void> {
  console.log(`Prueba de humo de ${dir}`);
  if (!existsSync(exe)) {
    console.log("  Falta proyecto-e.exe: corré primero `pnpm build:agent`.");
    process.exit(1);
  }

  await check("el agente arranca con el exe portable (--smoke)", async () => {
    const r = spawnSync(exe, [join(app, "agent.mjs"), "--smoke"], { encoding: "utf8", cwd: process.env.TEMP ?? dir, timeout: 60_000 });
    if (r.status !== 0) throw new Error(`salió con ${r.status}. ${r.stderr.trim()}`);
    return r.stdout.trim();
  });

  await check("hijo de atajos (koffi): set vacío", async () => {
    const r = (await ask("hotkeyHost.mjs", { id: 1, op: "set", args: { keys: [] } })) as { ok?: boolean; result?: unknown[] };
    if (r.ok !== true) throw new Error(JSON.stringify(r));
    return "responde";
  });

  await check("hijo de entrada (koffi): cursor y pantallas", async () => {
    const c = (await ask("inputHost.mjs", { id: 1, op: "cursor" })) as { ok?: boolean; result?: { x: number; y: number } };
    if (c.ok !== true || typeof c.result?.x !== "number") throw new Error(JSON.stringify(c));
    const m = (await ask("inputHost.mjs", { id: 2, op: "monitors" })) as { ok?: boolean; result?: { list: unknown[] } };
    if (m.ok !== true || !Array.isArray(m.result?.list)) throw new Error(JSON.stringify(m));
    return `${m.result.list.length} pantalla(s)`;
  });

  await check("hijo de ventanas y pantallas (koffi): ventana al frente y lista de pantallas", async () => {
    const f = (await ask("host.mjs", { id: 1, op: "windows.foreground" })) as { ok?: boolean };
    if (f.ok !== true) throw new Error(JSON.stringify(f));
    const d = (await ask("host.mjs", { id: 2, op: "displays.list" })) as { ok?: boolean; result?: unknown[] };
    if (d.ok !== true || !Array.isArray(d.result)) throw new Error(JSON.stringify(d));
    return `${d.result.length} pantalla(s) vistas por Windows`;
  });

  await check("hijo de audio (PowerShell + C#): salidas", async () => {
    const script = join(app, "audioHost.ps1");
    const out = await new Promise<string>((resolveOut, reject) => {
      const cp = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let buf = "";
      let sent = false;
      const timer = setTimeout(() => {
        cp.kill();
        reject(new Error("sin respuesta en 60 s"));
      }, 60_000);
      cp.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        if (!sent && buf.includes('"ready"')) {
          sent = true;
          cp.stdin.write(JSON.stringify({ id: 1, op: "snapshot" }) + "\n");
        }
        const line = buf.split("\n").find((l) => l.includes('"id":1'));
        if (line) {
          clearTimeout(timer);
          cp.kill();
          resolveOut(line);
        }
      });
      cp.once("exit", () => reject(new Error(`terminó sin responder. ${buf.slice(0, 200)}`)));
    });
    const reply = JSON.parse(out) as { ok?: boolean; result?: { outputs?: unknown[] } };
    if (reply.ok !== true) throw new Error(out.slice(0, 200));
    return `${reply.result?.outputs?.length ?? 0} salida(s) de audio`;
  });

  console.log(failures === 0 ? "\nTodo bien." : `\n${failures} prueba(s) con problemas.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
