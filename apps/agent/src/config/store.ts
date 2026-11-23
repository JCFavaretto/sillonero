import { join } from "node:path";
import { z } from "zod";
import { base64UrlToBytes, bytesToBase64Url } from "@proyecto-e/protocol";
import type { FileSystem, Logger, Secret } from "../ports";
import {
  CURRENT_CONFIG_VERSION,
  defaultConfig,
  migrate,
  parseConfig,
  type AgentConfig,
} from "./schema";

export type LoadStatus =
  | "ok" // archivo válido
  | "missing" // no había archivo: defaults
  | "recovered" // corrupto: copiado a .bak, defaults
  | "newer_version" // escrito por una versión futura: no se toca, remoto apagado
  | "identity_unreadable"; // la clave privada cifrada no se pudo abrir (otra cuenta de Windows): no se inventa otra, no se pisa el archivo

export interface LoadResult {
  config: AgentConfig;
  status: LoadStatus;
  /** Versión del archivo si hubo que migrarlo (se guarda una copia `.v1.bak`), o `null`. */
  migratedFrom: number | null;
}

export class ConfigReadOnlyError extends Error {
  constructor() {
    super("agent.json es de una versión más nueva o tiene una clave que no se pudo abrir: no se sobrescribe");
    this.name = "ConfigReadOnlyError";
  }
}

export interface ConfigStore {
  load(): Promise<LoadResult>;
  save(config: AgentConfig): Promise<void>;
  /**
   * Tras `identity_unreadable`, cuando Jay confirma que se genere una clave nueva: guarda una copia del archivo
   * (`agent.json.identity-lost.bak`) y vuelve a permitir escribir. Sin una pérdida real no hace nada.
   */
  acknowledgeLostIdentity(): Promise<void>;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function createConfigStore(deps: { fs: FileSystem; log: Logger; dataDir: string; secret?: Secret }): ConfigStore {
  const { fs, log, secret } = deps;
  const path = join(deps.dataDir, "agent.json");
  const backup = `${path}.bak`;
  const lostBackup = `${path}.identity-lost.bak`;
  const preMigrationBackup = (version: number) => `${path}.v${version}.bak`;
  let readOnly = false;
  let identityLost = false;
  let queue: Promise<void> = Promise.resolve();

  async function recover(reason: string): Promise<LoadResult> {
    log.warn("agent.json corrupto: se guarda copia en .bak y se usan los valores de fábrica", { reason });
    try {
      await fs.copyFile(path, backup);
    } catch (err) {
      log.error("no se pudo copiar agent.json a .bak", { error: String(err) });
    }
    return { config: defaultConfig(), status: "recovered", migratedFrom: null };
  }

  /** La clave privada (base64url, la que usa el agente) → cifrada con DPAPI (base64). Verifica que se pueda volver a abrir igual. */
  function protectKey(privateKey: string): string {
    if (!secret) throw new Error("no hay DPAPI");
    const plain = base64UrlToBytes(privateKey);
    if (plain === null) throw new Error("la clave privada no es base64url");
    const cipher = secret.protect(plain);
    const back = secret.unprotect(cipher);
    if (back.length !== plain.length || !back.every((b, i) => b === plain[i])) throw new Error("la clave cifrada no volvió igual al abrirla");
    return Buffer.from(cipher).toString("base64");
  }

  function revealKey(protectedKey: string): string {
    if (!secret) throw new Error("no hay DPAPI en esta PC");
    return bytesToBase64Url(secret.unprotect(Buffer.from(protectedKey, "base64")));
  }

  /**
   * Las copias de seguridad de fases anteriores (agent.json.bak, .v1 a .v5) guardan la MISMA clave privada en claro, y DPAPI no sirve
   * de nada si quedan ahí. Se reescriben con la clave cifrada (se conserva todo lo demás); lo que no se entiende no se toca.
   */
  async function redactBackup(file: string): Promise<void> {
    try {
      const text = await fs.readFile(file);
      if (text === null) return;
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed) || !isObject(parsed.identity) || typeof parsed.identity.privateKey !== "string") return;
      const id = parsed.identity;
      const redacted = { ...parsed, identity: { publicKey: id.publicKey, privateKeyProtected: protectKey(id.privateKey as string) } };
      await fs.writeFileAtomic(file, JSON.stringify(redacted, null, 2) + "\n");
    } catch (err) {
      log.warn("no se pudo cifrar la clave de una copia de seguridad", { file, error: String(err) });
    }
  }
  const backupNames = () => [backup, ...[1, 2, 3, 4, 5].map(preMigrationBackup)];

  /** El JSON tal como va a disco: con la clave cifrada. Sin DPAPI (solo desarrollo) queda como está. */
  function toDisk(config: AgentConfig): Json {
    const data = config as unknown as Json;
    if (!secret || !config.identity) return data;
    return { ...data, identity: { publicKey: config.identity.publicKey, privateKeyProtected: protectKey(config.identity.privateKey) } };
  }

  return {
    async load() {
      readOnly = false;
      identityLost = false;
      const text = await fs.readFile(path);
      if (text === null) return { config: defaultConfig(), status: "missing", migratedFrom: null };

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return recover("JSON inválido");
      }
      if (!isObject(raw)) {
        return recover("no es un objeto");
      }
      let doc: Json = raw;
      const version = doc.version;
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        return recover("version ausente o inválida");
      }

      if (version > CURRENT_CONFIG_VERSION) {
        readOnly = true;
        log.warn("agent.json es de una versión más nueva: no se toca y el remoto queda apagado", {
          fileVersion: version,
          knownVersion: CURRENT_CONFIG_VERSION,
        });
        return { config: defaultConfig(), status: "newer_version", migratedFrom: null };
      }

      // v6: la clave viene cifrada. Se abre acá, en el límite; hacia adentro el agente sigue viendo `identity.privateKey`.
      let lost = false;
      if (version >= 6 && isObject(doc.identity)) {
        const id = doc.identity;
        if (typeof id.privateKey === "string" && secret) {
          const r = await recover("la clave privada está en claro en un archivo v6");
          await redactBackup(backup);
          return r;
        }
        if (typeof id.privateKeyProtected === "string") {
          try {
            doc = { ...doc, identity: { publicKey: id.publicKey, privateKey: revealKey(id.privateKeyProtected) } };
          } catch (err) {
            // Otra cuenta de Windows o un perfil restaurado: no se inventa una clave nueva ni se pisa el archivo.
            log.error("no se pudo abrir la clave privada cifrada de agent.json", { error: String(err) });
            doc = { ...doc, identity: null };
            lost = true;
          }
        }
      }

      const migrating = version < CURRENT_CONFIG_VERSION;
      let parsed;
      try {
        parsed = parseConfig(migrate(doc));
      } catch (err) {
        return recover(String(err));
      }
      if (!parsed.success) return recover(z.prettifyError(parsed.error));

      if (lost) {
        readOnly = true;
        identityLost = true;
        return { config: parsed.data, status: "identity_unreadable", migratedFrom: null };
      }

      if (migrating) {
        const original = JSON.parse(text) as Json;
        const clearKey = isObject(original.identity) && typeof original.identity.privateKey === "string" ? original.identity.privateKey : null;
        if (secret && clearKey !== null) {
          // v5 → v6: se cifra la clave que ya existe (no se cambia, los celus siguen emparejados), se guarda una copia SIN la
          // clave en claro y recién ahí se reescribe el archivo. Si algo falla no se toca nada.
          try {
            const protectedKey = protectKey(clearKey);
            const id = original.identity as Json;
            const redacted = { ...original, identity: { publicKey: id.publicKey, privateKeyProtected: protectedKey } };
            await fs.writeFileAtomic(preMigrationBackup(version), JSON.stringify(redacted, null, 2) + "\n");
            await fs.writeFileAtomic(path, JSON.stringify(toDisk(parsed.data), null, 2) + "\n");
            for (const f of backupNames()) await redactBackup(f);
            log.warn("agent.json migrado: la clave privada ahora va cifrada con la cuenta de Windows", { from: version, to: CURRENT_CONFIG_VERSION });
          } catch (err) {
            readOnly = true; // el archivo original queda como estaba y no se pisa con nada
            log.error("no se pudo cifrar la clave privada: agent.json queda como estaba (solo lectura en esta corrida)", { error: String(err) });
          }
        } else {
          // Sin DPAPI, o sin clave que cifrar: copia del original por si hiciera falta volver atrás.
          try {
            await fs.copyFile(path, preMigrationBackup(version));
          } catch (err) {
            log.error("no se pudo copiar agent.json antes de migrarlo", { error: String(err) });
          }
          log.warn(version === 1 ? "agent.json migrado: hay que volver a emparejar los celus" : "agent.json migrado", { from: version, to: CURRENT_CONFIG_VERSION });
        }
      }
      return { config: parsed.data, status: "ok", migratedFrom: migrating ? version : null };
    },

    async save(config) {
      if (readOnly) throw new ConfigReadOnlyError();
      const parsed = parseConfig(config);
      if (!parsed.success) throw new Error(`Config inválida: ${z.prettifyError(parsed.error)}`);
      const data = JSON.stringify(toDisk(parsed.data), null, 2) + "\n";
      const run = queue.then(() => fs.writeFileAtomic(path, data));
      queue = run.catch(() => undefined); // un fallo no frena los saves siguientes
      return run;
    },

    async acknowledgeLostIdentity() {
      if (!identityLost) return;
      try {
        // Cada pérdida tiene su copia: la primera todavía se podría abrir volviendo a la cuenta original.
        let target = lostBackup;
        for (let n = 2; (await fs.size(target)) !== null && n < 50; n++) target = `${lostBackup}.${n}`;
        await fs.copyFile(path, target);
      } catch (err) {
        log.error("no se pudo copiar agent.json antes de generar una clave nueva", { error: String(err) });
        throw err;
      }
      identityLost = false;
      readOnly = false;
    },
  };
}
