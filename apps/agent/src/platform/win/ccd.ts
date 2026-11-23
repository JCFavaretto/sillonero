import type { RawDisplay, RawRect } from "../../ports";

// Parseo puro de las estructuras de la API CCD de Windows (QueryDisplayConfig / DisplayConfigGetDeviceInfo).
// Los tamaños y offsets se midieron en la PC de Jay el 07/11/2026 (Windows 10, spike de R2); no hay koffi acá,
// así que todo se prueba con buffers armados a mano.

/** sizeof(DISPLAYCONFIG_PATH_INFO) en x64. */
export const PATH_SIZE = 72;
/** sizeof(DISPLAYCONFIG_MODE_INFO) en x64. */
export const MODE_SIZE = 64;
/** sizeof(DISPLAYCONFIG_TARGET_DEVICE_NAME): cabecera 20 + flags 4 + tecnología 4 + EDID 4 + conector 4 + WCHAR[64] + WCHAR[128]. */
export const TARGET_NAME_SIZE = 420;

const PATH_ACTIVE = 0x1;
const INFO_TYPE_SOURCE_MODE = 1;
const GET_TARGET_NAME = 2;
const INVALID_MODE_IDX = 0xffffffff;

export interface CcdPath {
  sourceId: number;
  sourceModeIdx: number;
  adapterLow: number;
  adapterHigh: number;
  targetId: number;
  outputTechnology: number;
  available: boolean;
  active: boolean;
}

export interface TargetName {
  friendlyName: string;
  devicePath: string;
  outputTechnology: number;
}

export function parsePaths(buf: Buffer, count: number): CcdPath[] {
  const n = Math.min(count, Math.floor(buf.length / PATH_SIZE));
  const out: CcdPath[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * PATH_SIZE;
    out.push({
      sourceId: buf.readUInt32LE(o + 8),
      sourceModeIdx: buf.readUInt32LE(o + 12),
      adapterLow: buf.readUInt32LE(o + 20),
      adapterHigh: buf.readInt32LE(o + 24),
      targetId: buf.readUInt32LE(o + 28),
      outputTechnology: buf.readInt32LE(o + 36),
      available: buf.readUInt32LE(o + 60) !== 0,
      active: (buf.readUInt32LE(o + 68) & PATH_ACTIVE) !== 0,
    });
  }
  return out;
}

/** Posición y tamaño de una pantalla prendida, desde su modo de origen. `null` si el índice no sirve. */
export function parseSourceBounds(modes: Buffer, idx: number): RawRect | null {
  if (idx === INVALID_MODE_IDX || idx * MODE_SIZE + MODE_SIZE > modes.length) return null;
  const o = idx * MODE_SIZE;
  if (modes.readUInt32LE(o) !== INFO_TYPE_SOURCE_MODE) return null;
  return { x: modes.readInt32LE(o + 28), y: modes.readInt32LE(o + 32), w: modes.readUInt32LE(o + 16), h: modes.readUInt32LE(o + 20) };
}

/** Pedido para `DisplayConfigGetDeviceInfo(DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME)`. */
export function encodeTargetNameRequest(p: Pick<CcdPath, "adapterLow" | "adapterHigh" | "targetId">): Buffer {
  const b = Buffer.alloc(TARGET_NAME_SIZE);
  b.writeUInt32LE(GET_TARGET_NAME, 0);
  b.writeUInt32LE(TARGET_NAME_SIZE, 4);
  b.writeUInt32LE(p.adapterLow, 8);
  b.writeInt32LE(p.adapterHigh, 12);
  b.writeUInt32LE(p.targetId, 16);
  return b;
}

const wide = (b: Buffer, from: number, bytes: number) => b.toString("utf16le", from, from + bytes).split("\0")[0] ?? "";

export function parseTargetName(b: Buffer): TargetName {
  return { outputTechnology: b.readInt32LE(24), friendlyName: wide(b, 36, 128), devicePath: wide(b, 164, 256) };
}

export interface CcdSnapshot {
  /** `QDC_ALL_PATHS`: todo lo conectado, prendido o no. */
  all: CcdPath[];
  /** `QDC_ONLY_ACTIVE_PATHS`: lo prendido, con la posición en `modes`. */
  active: CcdPath[];
  modes: Buffer;
}

const keyOf = (p: Pick<CcdPath, "adapterLow" | "adapterHigh" | "targetId">) => `${p.adapterLow}:${p.adapterHigh}:${p.targetId}`;

/**
 * Junta lo prendido (con posición) y lo conectado pero apagado (sin posición) en una lista de pantallas.
 * `nameOf` lee el nombre y la ruta del monitor; puede devolver `null` si Windows no lo da.
 * La principal es la que está en (0,0): Windows siempre pone ahí la pantalla principal.
 */
export function buildRawDisplays(snapshot: CcdSnapshot, nameOf: (p: CcdPath) => TargetName | null): RawDisplay[] {
  const out: RawDisplay[] = [];
  const seen = new Set<string>();

  const push = (p: CcdPath, active: boolean) => {
    const key = keyOf(p);
    if (seen.has(key)) return;
    seen.add(key);
    const name = nameOf(p);
    const bounds = active ? parseSourceBounds(snapshot.modes, p.sourceModeIdx) : null;
    out.push({
      devicePath: name?.devicePath || `ccd:${key}`,
      friendlyName: name?.friendlyName ?? "",
      // El camino inactivo trae valores por defecto: la tecnología fiable es la de TARGET_NAME.
      outputTechnology: name?.outputTechnology ?? p.outputTechnology,
      active,
      primary: active && bounds !== null && bounds.x === 0 && bounds.y === 0,
      gdiName: null,
      bounds,
      workArea: null,
    });
  };

  for (const p of snapshot.active) push(p, true);
  for (const p of snapshot.all) if (p.available) push(p, false);
  return out;
}

// ── Prender y apagar una pantalla (R5) ───────────────────────────────────────
// Se trabaja sobre los buffers crudos de QueryDisplayConfig: se arma la lista de caminos y modos que
// se le pide a SetDisplayConfig, sin tocar los buffers originales. Nada de esto llama a Windows.

/** Lo que recibe SetDisplayConfig: caminos y modos (con su cantidad). */
export interface CcdConfig {
  paths: Buffer;
  pathCount: number;
  modes: Buffer;
  modeCount: number;
}

export interface CcdTarget {
  adapterLow: number;
  adapterHigh: number;
  targetId: number;
}

const OFF = { srcLow: 0, srcHigh: 4, srcId: 8, srcMode: 12, tgtLow: 20, tgtHigh: 24, tgtId: 28, tgtMode: 32, available: 60, flags: 68 } as const;

const pathAt = (b: Buffer, i: number) => b.subarray(i * PATH_SIZE, (i + 1) * PATH_SIZE);
const countOf = (b: Buffer, count: number) => Math.min(count, Math.floor(b.length / PATH_SIZE));
const targetKeyAt = (b: Buffer, i: number) =>
  keyOf({ adapterLow: b.readUInt32LE(i * PATH_SIZE + OFF.tgtLow), adapterHigh: b.readInt32LE(i * PATH_SIZE + OFF.tgtHigh), targetId: b.readUInt32LE(i * PATH_SIZE + OFF.tgtId) });
const sourceKeyAt = (b: Buffer, i: number) =>
  `${b.readUInt32LE(i * PATH_SIZE + OFF.srcLow)}:${b.readInt32LE(i * PATH_SIZE + OFF.srcHigh)}:${b.readUInt32LE(i * PATH_SIZE + OFF.srcId)}`;

/**
 * La configuración activa SIN la pantalla `target`: los demás caminos igual, y solo los modos que siguen
 * usándose (con los índices corregidos). `null` si esa pantalla no está prendida o si no quedaría ninguna.
 */
export function buildDisableConfig(active: CcdConfig, target: CcdTarget): CcdConfig | null {
  const n = countOf(active.paths, active.pathCount);
  const key = keyOf(target);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (targetKeyAt(active.paths, i) !== key) keep.push(i);
  if (keep.length === n || keep.length === 0) return null;

  const modeTotal = Math.min(active.modeCount, Math.floor(active.modes.length / MODE_SIZE));
  const remap = new Map<number, number>();
  const used: number[] = [];
  const paths = Buffer.alloc(keep.length * PATH_SIZE);
  keep.forEach((from, to) => {
    const rec = paths.subarray(to * PATH_SIZE, (to + 1) * PATH_SIZE);
    pathAt(active.paths, from).copy(rec);
    for (const off of [OFF.srcMode, OFF.tgtMode]) {
      const old = rec.readUInt32LE(off);
      if (old === INVALID_MODE_IDX || old >= modeTotal) continue;
      let next = remap.get(old);
      if (next === undefined) {
        next = used.length;
        remap.set(old, next);
        used.push(old);
      }
      rec.writeUInt32LE(next, off);
    }
  });
  const modes = Buffer.alloc(used.length * MODE_SIZE);
  used.forEach((old, i) => active.modes.copy(modes, i * MODE_SIZE, old * MODE_SIZE, (old + 1) * MODE_SIZE));
  return { paths, pathCount: keep.length, modes, modeCount: used.length };
}

/**
 * La configuración activa MÁS la pantalla `target`: se toma de la lista de todos los caminos posibles
 * el que va a un origen libre de la misma placa, se marca activo y se le dejan los modos sin asignar para
 * que Windows elija el mejor. Con `restoreAt` se le agrega además un modo de origen con esa posición y tamaño,
 * para que vuelva a su lugar. `null` si la pantalla ya está prendida, no está conectada o no hay origen libre.
 */
export function buildEnableConfig(
  active: CcdConfig,
  all: { paths: Buffer; pathCount: number },
  target: CcdTarget,
  /** Dónde estaba y de qué tamaño: se le pide a Windows que la devuelva ahí (si no, la pone al final de todo). */
  restoreAt?: RawRect,
): CcdConfig | null {
  const n = countOf(active.paths, active.pathCount);
  const key = keyOf(target);
  const usedSources = new Set<string>();
  for (let i = 0; i < n; i++) {
    if (targetKeyAt(active.paths, i) === key) return null; // ya está prendida
    usedSources.add(sourceKeyAt(active.paths, i));
  }
  const total = countOf(all.paths, all.pathCount);
  for (let i = 0; i < total; i++) {
    if (targetKeyAt(all.paths, i) !== key) continue;
    if (all.paths.readUInt32LE(i * PATH_SIZE + OFF.available) === 0) continue;
    if (usedSources.has(sourceKeyAt(all.paths, i))) continue;
    const rec = Buffer.from(pathAt(all.paths, i));
    rec.writeUInt32LE(INVALID_MODE_IDX, OFF.srcMode);
    rec.writeUInt32LE(INVALID_MODE_IDX, OFF.tgtMode);
    rec.writeUInt32LE(rec.readUInt32LE(OFF.flags) | PATH_ACTIVE, OFF.flags);
    let modes = Buffer.from(active.modes);
    let modeCount = Math.min(active.modeCount, Math.floor(active.modes.length / MODE_SIZE));
    modes = modes.subarray(0, modeCount * MODE_SIZE);
    if (restoreAt) {
      // Mismo formato de píxel que las demás pantallas (si ninguna lo informa, 32 bits).
      let pixelFormat = 4;
      for (let m = 0; m < modeCount; m++) {
        if (modes.readUInt32LE(m * MODE_SIZE) === INFO_TYPE_SOURCE_MODE && modes.readUInt32LE(m * MODE_SIZE + 24) !== 0) {
          pixelFormat = modes.readUInt32LE(m * MODE_SIZE + 24);
          break;
        }
      }
      const mode = Buffer.alloc(MODE_SIZE);
      mode.writeUInt32LE(INFO_TYPE_SOURCE_MODE, 0);
      mode.writeUInt32LE(rec.readUInt32LE(OFF.srcId), 4);
      mode.writeUInt32LE(rec.readUInt32LE(OFF.srcLow), 8);
      mode.writeInt32LE(rec.readInt32LE(OFF.srcHigh), 12);
      mode.writeUInt32LE(restoreAt.w, 16);
      mode.writeUInt32LE(restoreAt.h, 20);
      mode.writeUInt32LE(pixelFormat, 24);
      mode.writeInt32LE(restoreAt.x, 28);
      mode.writeInt32LE(restoreAt.y, 32);
      rec.writeUInt32LE(modeCount, OFF.srcMode);
      modes = Buffer.concat([modes, mode]);
      modeCount++;
    }
    return {
      paths: Buffer.concat([active.paths.subarray(0, n * PATH_SIZE), rec]),
      pathCount: n + 1,
      modes,
      modeCount,
    };
  }
  return null;
}

/**
 * Los mismos caminos con todos los modos sin asignar y sin lista de modos: así, con `SDC_TOPOLOGY_SUPPLIED`,
 * Windows busca en su base de datos las posiciones que recordaba para esa combinación de pantallas.
 */
export function invalidateModes(cfg: CcdConfig): CcdConfig {
  const n = countOf(cfg.paths, cfg.pathCount);
  const paths = Buffer.from(cfg.paths.subarray(0, n * PATH_SIZE));
  for (let i = 0; i < n; i++) {
    paths.writeUInt32LE(INVALID_MODE_IDX, i * PATH_SIZE + OFF.srcMode);
    paths.writeUInt32LE(INVALID_MODE_IDX, i * PATH_SIZE + OFF.tgtMode);
  }
  return { paths, pathCount: n, modes: Buffer.alloc(0), modeCount: 0 };
}

/**
 * La misma configuración con otras posiciones para las pantallas prendidas (clave: `adaptador:destino`, la de
 * `keyOf`). Solo cambia dónde está cada una en el escritorio: ni caminos, ni tamaños, ni cantidad de modos.
 * `null` si no hay nada que mover, si alguna no está prendida o si le falta su modo de origen.
 */
export function buildArrangeConfig(active: CcdConfig, positions: ReadonlyMap<string, { x: number; y: number }>): CcdConfig | null {
  if (positions.size === 0) return null;
  const n = countOf(active.paths, active.pathCount);
  const modeTotal = Math.min(active.modeCount, Math.floor(active.modes.length / MODE_SIZE));
  const modes = Buffer.from(active.modes);
  const moved = new Set<string>();
  for (let i = 0; i < n; i++) {
    const key = targetKeyAt(active.paths, i);
    const to = positions.get(key);
    if (!to) continue;
    const idx = active.paths.readUInt32LE(i * PATH_SIZE + OFF.srcMode);
    if (idx === INVALID_MODE_IDX || idx >= modeTotal || modes.readUInt32LE(idx * MODE_SIZE) !== INFO_TYPE_SOURCE_MODE) return null;
    modes.writeInt32LE(to.x, idx * MODE_SIZE + 28);
    modes.writeInt32LE(to.y, idx * MODE_SIZE + 32);
    moved.add(key);
  }
  for (const key of positions.keys()) if (!moved.has(key)) return null; // pidió mover una que no está prendida
  return { paths: Buffer.from(active.paths), pathCount: active.pathCount, modes, modeCount: active.modeCount };
}
