import { describe, expect, it } from "vitest";
import {
  MODE_SIZE,
  PATH_SIZE,
  buildDisableConfig,
  buildEnableConfig,
  invalidateModes,
  type CcdConfig,
} from "../src/platform/win/ccd";

// Estructuras de Windows armadas a mano. Mismas posiciones que en ccd.test.ts (medidas en la PC de Jay).

const INVALID = 0xffffffff;

interface P {
  srcId: number;
  srcModeIdx?: number;
  tgtId: number;
  tgtModeIdx?: number;
  adapterLow?: number;
  available?: boolean;
  active?: boolean;
  /** Para distinguir caminos en los tests: va en un campo que no toca el código (refreshRate). */
  tag?: number;
}

function paths(specs: P[]): Buffer {
  const b = Buffer.alloc(specs.length * PATH_SIZE);
  specs.forEach((s, i) => {
    const o = i * PATH_SIZE;
    b.writeUInt32LE(s.adapterLow ?? 89037, o);
    b.writeUInt32LE(s.srcId, o + 8);
    b.writeUInt32LE(s.srcModeIdx ?? INVALID, o + 12);
    b.writeUInt32LE(s.adapterLow ?? 89037, o + 20);
    b.writeUInt32LE(s.tgtId, o + 28);
    b.writeUInt32LE(s.tgtModeIdx ?? INVALID, o + 32);
    b.writeUInt32LE(s.tag ?? 0, o + 48);
    b.writeUInt32LE(s.available ? 1 : 0, o + 60);
    b.writeUInt32LE(s.active ? 1 : 0, o + 68);
  });
  return b;
}

/** Cada modo lleva un número reconocible en `id` (offset 4) para saber cuál es cuál después de reordenar. */
function modes(ids: number[]): Buffer {
  const b = Buffer.alloc(ids.length * MODE_SIZE);
  ids.forEach((id, i) => b.writeUInt32LE(id, i * MODE_SIZE + 4));
  return b;
}
const modeIds = (m: Buffer) => Array.from({ length: m.length / MODE_SIZE }, (_, i) => m.readUInt32LE(i * MODE_SIZE + 4));
const field = (b: Buffer, i: number, off: number) => b.readUInt32LE(i * PATH_SIZE + off);
const SRC_MODE = 12;
const TGT_MODE = 32;
const TGT_ID = 28;

/** Tres pantallas prendidas (como la PC de Jay): cada camino usa su modo de origen y su modo de destino. */
function three(): CcdConfig {
  return {
    paths: paths([
      { srcId: 0, srcModeIdx: 0, tgtId: 100, tgtModeIdx: 1, available: true, active: true },
      { srcId: 1, srcModeIdx: 2, tgtId: 200, tgtModeIdx: 3, available: true, active: true },
      { srcId: 2, srcModeIdx: 4, tgtId: 300, tgtModeIdx: 5, available: true, active: true },
    ]),
    pathCount: 3,
    modes: modes([10, 11, 20, 21, 30, 31]),
    modeCount: 6,
  };
}
const TARGET_MID = { adapterLow: 89037, adapterHigh: 0, targetId: 200 };

describe("buildDisableConfig", () => {
  it("saca el camino de esa pantalla y deja los otros dos", () => {
    const c = buildDisableConfig(three(), TARGET_MID)!;
    expect(c.pathCount).toBe(2);
    expect([field(c.paths, 0, TGT_ID), field(c.paths, 1, TGT_ID)]).toEqual([100, 300]);
  });

  it("deja solo los modos que usan los caminos que quedan y les corrige el índice", () => {
    const c = buildDisableConfig(three(), TARGET_MID)!;
    expect(c.modeCount).toBe(4);
    expect(modeIds(c.modes)).toEqual([10, 11, 30, 31]); // se fueron 20 y 21, los de la pantalla apagada
    // cada camino apunta a sus propios modos, ya en la lista compacta
    expect([field(c.paths, 0, SRC_MODE), field(c.paths, 0, TGT_MODE)]).toEqual([0, 1]);
    expect([field(c.paths, 1, SRC_MODE), field(c.paths, 1, TGT_MODE)]).toEqual([2, 3]);
    expect(c.modes.readUInt32LE(field(c.paths, 1, SRC_MODE) * MODE_SIZE + 4)).toBe(30);
  });

  it("no toca los buffers de entrada", () => {
    const cfg = three();
    const before = Buffer.from(cfg.paths);
    const beforeModes = Buffer.from(cfg.modes);
    buildDisableConfig(cfg, TARGET_MID);
    expect(cfg.paths.equals(before)).toBe(true);
    expect(cfg.modes.equals(beforeModes)).toBe(true);
  });

  it("si otro camino comparte el modo de origen (clon), ese modo se conserva", () => {
    const cfg: CcdConfig = {
      paths: paths([
        { srcId: 0, srcModeIdx: 0, tgtId: 100, tgtModeIdx: 1, available: true, active: true },
        { srcId: 0, srcModeIdx: 0, tgtId: 200, tgtModeIdx: 2, available: true, active: true },
      ]),
      pathCount: 2,
      modes: modes([10, 11, 21]),
      modeCount: 3,
    };
    const c = buildDisableConfig(cfg, TARGET_MID)!;
    expect(c.pathCount).toBe(1);
    expect(modeIds(c.modes)).toEqual([10, 11]);
    expect(field(c.paths, 0, SRC_MODE)).toBe(0);
  });

  it("un camino sin modos asignados (índice inválido) no rompe la cuenta", () => {
    const cfg: CcdConfig = {
      paths: paths([
        { srcId: 0, srcModeIdx: 0, tgtId: 100, tgtModeIdx: 1, available: true, active: true },
        { srcId: 1, tgtId: 200, available: true, active: true },
      ]),
      pathCount: 2,
      modes: modes([10, 11]),
      modeCount: 2,
    };
    const c = buildDisableConfig(cfg, TARGET_MID)!;
    expect(c.pathCount).toBe(1);
    expect(modeIds(c.modes)).toEqual([10, 11]);
  });

  it("una pantalla que no está prendida → null", () => {
    expect(buildDisableConfig(three(), { adapterLow: 89037, adapterHigh: 0, targetId: 999 })).toBeNull();
  });

  it("no se puede dejar sin caminos: apagar el único prendido → null", () => {
    const one: CcdConfig = { paths: paths([{ srcId: 0, srcModeIdx: 0, tgtId: 200, tgtModeIdx: 1, active: true }]), pathCount: 1, modes: modes([1, 2]), modeCount: 2 };
    expect(buildDisableConfig(one, TARGET_MID)).toBeNull();
  });

  it("distingue el adaptador: mismo número de destino en otra placa no cuenta", () => {
    const other = { adapterLow: 5, adapterHigh: 0, targetId: 200 };
    expect(buildDisableConfig(three(), other)).toBeNull();
  });
});

describe("buildEnableConfig", () => {
  const tele = { adapterLow: 89037, adapterHigh: 0, targetId: 400 };

  /** Todos los caminos posibles: los 3 prendidos y los de la tele (conectada, apagada) hacia cada origen. */
  function all(extra: P[] = []): { paths: Buffer; pathCount: number } {
    const specs: P[] = [
      { srcId: 0, srcModeIdx: 0, tgtId: 100, tgtModeIdx: 1, available: true, active: true },
      { srcId: 1, srcModeIdx: 2, tgtId: 200, tgtModeIdx: 3, available: true, active: true },
      { srcId: 2, srcModeIdx: 4, tgtId: 300, tgtModeIdx: 5, available: true, active: true },
      { srcId: 0, tgtId: 400, available: true, tag: 70 }, // la tele hacia el origen 0 (ocupado)
      { srcId: 1, tgtId: 400, available: true, tag: 71 }, // hacia el origen 1 (ocupado)
      { srcId: 3, tgtId: 400, available: true, tag: 73 }, // hacia el origen 3 (libre)
      ...extra,
    ];
    return { paths: paths(specs), pathCount: specs.length };
  }

  it("agrega el camino de la tele hacia un origen libre, prendido y sin modos (Windows elige el mejor)", () => {
    const c = buildEnableConfig(three(), all(), tele)!;
    expect(c.pathCount).toBe(4);
    const i = 3;
    expect(field(c.paths, i, TGT_ID)).toBe(400);
    expect(field(c.paths, i, 8)).toBe(3); // origen libre
    expect(field(c.paths, i, 68) & 1).toBe(1); // activo
    expect(field(c.paths, i, SRC_MODE)).toBe(INVALID);
    expect(field(c.paths, i, TGT_MODE)).toBe(INVALID);
    expect(field(c.paths, i, 48)).toBe(73); // vino del camino correcto
  });

  it("los caminos y modos que ya estaban quedan exactamente igual", () => {
    const cfg = three();
    const c = buildEnableConfig(cfg, all(), tele)!;
    expect(c.paths.subarray(0, 3 * PATH_SIZE).equals(cfg.paths)).toBe(true);
    expect(c.modes.equals(cfg.modes)).toBe(true);
    expect(c.modeCount).toBe(6);
  });

  it("elige el primer origen libre aunque haya varios", () => {
    const extra: P[] = [{ srcId: 4, tgtId: 400, available: true, tag: 74 }];
    const c = buildEnableConfig(three(), all(extra), tele)!;
    expect(field(c.paths, 3, 8)).toBe(3);
  });

  it("sin ningún origen libre → null", () => {
    const busy = { paths: paths([
      { srcId: 0, srcModeIdx: 0, tgtId: 100, tgtModeIdx: 1, available: true, active: true },
      { srcId: 1, srcModeIdx: 2, tgtId: 200, tgtModeIdx: 3, available: true, active: true },
      { srcId: 2, srcModeIdx: 4, tgtId: 300, tgtModeIdx: 5, available: true, active: true },
      { srcId: 0, tgtId: 400, available: true },
      { srcId: 1, tgtId: 400, available: true },
      { srcId: 2, tgtId: 400, available: true },
    ]), pathCount: 6 };
    expect(buildEnableConfig(three(), busy, tele)).toBeNull();
  });

  it("una pantalla que no está conectada (targetAvailable=0) → null", () => {
    const gone = { paths: paths([{ srcId: 3, tgtId: 400, available: false }]), pathCount: 1 };
    expect(buildEnableConfig(three(), gone, tele)).toBeNull();
  });

  it("una pantalla que ya está prendida → null", () => {
    expect(buildEnableConfig(three(), all(), { adapterLow: 89037, adapterHigh: 0, targetId: 200 })).toBeNull();
  });

  it("una pantalla que Windows no lista → null", () => {
    expect(buildEnableConfig(three(), all(), { adapterLow: 89037, adapterHigh: 0, targetId: 12345 })).toBeNull();
  });

  it("solo cuentan los orígenes de la misma placa: el 3 de otra placa no ocupa el 3 de esta", () => {
    const cfg: CcdConfig = { ...three(), paths: Buffer.concat([three().paths, paths([{ srcId: 3, srcModeIdx: INVALID, tgtId: 500, adapterLow: 7, available: true, active: true }])]), pathCount: 4 };
    const c = buildEnableConfig(cfg, all(), tele)!;
    expect(field(c.paths, 4, 8)).toBe(3);
  });
});

describe("invalidateModes (para pedirle a Windows la posición que recordaba)", () => {
  it("deja todos los caminos con índices inválidos y sin lista de modos", () => {
    const c = invalidateModes(three());
    expect(c.pathCount).toBe(3);
    expect(c.modeCount).toBe(0);
    expect(c.modes.length).toBe(0);
    for (let i = 0; i < 3; i++) {
      expect(field(c.paths, i, SRC_MODE)).toBe(INVALID);
      expect(field(c.paths, i, TGT_MODE)).toBe(INVALID);
    }
  });

  it("no toca la entrada", () => {
    const cfg = three();
    const before = Buffer.from(cfg.paths);
    invalidateModes(cfg);
    expect(cfg.paths.equals(before)).toBe(true);
  });
});

// ── Volver a prender en el mismo lugar, y reordenar (después de probar en la PC de Jay) ──

import { buildArrangeConfig } from "../src/platform/win/ccd";

/** Modos de origen "de verdad": tipo 1, con tamaño, formato y posición, para poder mirar dónde queda cada pantalla. */
function sourceModes(list: { id: number; w: number; h: number; x: number; y: number }[]): Buffer {
  const b = Buffer.alloc(list.length * MODE_SIZE);
  list.forEach((m, i) => {
    const o = i * MODE_SIZE;
    b.writeUInt32LE(1, o); // DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE
    b.writeUInt32LE(m.id, o + 4);
    b.writeUInt32LE(89037, o + 8);
    b.writeUInt32LE(m.w, o + 16);
    b.writeUInt32LE(m.h, o + 20);
    b.writeUInt32LE(4, o + 24); // 32 bits por píxel
    b.writeInt32LE(m.x, o + 28);
    b.writeInt32LE(m.y, o + 32);
  });
  return b;
}
const posOf = (c: CcdConfig, pathIdx: number) => {
  const idx = c.paths.readUInt32LE(pathIdx * PATH_SIZE + 12);
  return { x: c.modes.readInt32LE(idx * MODE_SIZE + 28), y: c.modes.readInt32LE(idx * MODE_SIZE + 32) };
};

/** Tres pantallas con posición: izquierda (-1920), principal (0) y derecha (1920). Cada camino usa SU modo de origen. */
function placed(): CcdConfig {
  return {
    paths: paths([
      { srcId: 0, srcModeIdx: 0, tgtId: 100, available: true, active: true },
      { srcId: 1, srcModeIdx: 1, tgtId: 200, available: true, active: true },
      { srcId: 2, srcModeIdx: 2, tgtId: 300, available: true, active: true },
    ]),
    pathCount: 3,
    modes: sourceModes([
      { id: 0, w: 1920, h: 1080, x: 0, y: 0 },
      { id: 1, w: 1920, h: 1080, x: -1920, y: 0 },
      { id: 2, w: 1920, h: 1080, x: 1920, y: 0 },
    ]),
    modeCount: 3,
  };
}

describe("buildEnableConfig · con la posición que tenía", () => {
  const tele = { adapterLow: 89037, adapterHigh: 0, targetId: 400 };
  const allPaths = () => ({ paths: paths([{ srcId: 3, tgtId: 400, available: true }]), pathCount: 1 });
  const WAS = { x: -1920, y: 0, w: 1920, h: 1080 };

  it("agrega un modo de origen con ESE lugar y ese tamaño, y el camino nuevo lo usa", () => {
    const c = buildEnableConfig(placed(), allPaths(), tele, WAS)!;
    expect(c.modeCount).toBe(4);
    const o = 3 * MODE_SIZE;
    expect(c.modes.readUInt32LE(o)).toBe(1); // modo de origen
    expect(c.modes.readUInt32LE(o + 4)).toBe(3); // del origen 3, el libre
    expect(c.modes.readUInt32LE(o + 8)).toBe(89037); // de la misma placa
    expect([c.modes.readUInt32LE(o + 16), c.modes.readUInt32LE(o + 20)]).toEqual([1920, 1080]);
    expect(c.modes.readUInt32LE(o + 24)).toBe(4); // mismo formato de píxel que las demás
    expect(posOf(c, 3)).toEqual({ x: -1920, y: 0 });
    expect(c.paths.readUInt32LE(3 * PATH_SIZE + 12)).toBe(3); // el camino apunta al modo nuevo
    expect(c.paths.readUInt32LE(3 * PATH_SIZE + 32)).toBe(INVALID); // el modo de destino lo elige Windows
    expect(c.paths.readUInt32LE(3 * PATH_SIZE + 68) & 1).toBe(1);
  });

  it("las pantallas que ya estaban no se tocan", () => {
    const cfg = placed();
    const c = buildEnableConfig(cfg, allPaths(), tele, WAS)!;
    expect(c.paths.subarray(0, 3 * PATH_SIZE).equals(cfg.paths)).toBe(true);
    expect(c.modes.subarray(0, 3 * MODE_SIZE).equals(cfg.modes)).toBe(true);
  });

  it("sin modos de origen para copiar el formato usa 32 bits por píxel", () => {
    const empty: CcdConfig = { paths: placed().paths, pathCount: 3, modes: Buffer.alloc(0), modeCount: 0 };
    const c = buildEnableConfig(empty, allPaths(), tele, WAS)!;
    expect(c.modes.readUInt32LE(24)).toBe(4);
  });

  it("sin posición recordada se comporta como antes (modos sin asignar)", () => {
    const c = buildEnableConfig(placed(), allPaths(), tele)!;
    expect(c.modeCount).toBe(3);
    expect(c.paths.readUInt32LE(3 * PATH_SIZE + 12)).toBe(INVALID);
  });
});

describe("buildArrangeConfig · cambiar de lugar a las pantallas prendidas", () => {
  const K = (id: number) => `89037:0:${id}`;

  it("pone cada pantalla en el lugar pedido (también con coordenadas negativas)", () => {
    const c = buildArrangeConfig(placed(), new Map([[K(100), { x: 1920, y: 0 }], [K(300), { x: -1920, y: 0 }]]))!;
    expect(posOf(c, 0)).toEqual({ x: 1920, y: 0 }); // la 100 pasa a la derecha
    expect(posOf(c, 2)).toEqual({ x: -1920, y: 0 }); // la 300 pasa a la izquierda
    expect(posOf(c, 1)).toEqual({ x: -1920, y: 0 }); // la 200 no se pidió: queda igual
  });

  it("no toca los buffers de entrada ni cambia caminos, tamaños ni cantidad de modos", () => {
    const cfg = placed();
    const beforeP = Buffer.from(cfg.paths);
    const beforeM = Buffer.from(cfg.modes);
    const c = buildArrangeConfig(cfg, new Map([[K(200), { x: 50, y: 60 }]]))!;
    expect(cfg.paths.equals(beforeP)).toBe(true);
    expect(cfg.modes.equals(beforeM)).toBe(true);
    expect(c.paths.equals(cfg.paths)).toBe(true);
    expect(c.modeCount).toBe(3);
    expect(c.modes.readUInt32LE(1 * MODE_SIZE + 16)).toBe(1920); // el ancho sigue igual
  });

  it("una pantalla que no está prendida → null", () => {
    expect(buildArrangeConfig(placed(), new Map([[K(999), { x: 0, y: 0 }]]))).toBeNull();
  });

  it("un camino sin modo de origen válido no se puede mover → null", () => {
    const cfg = placed();
    cfg.paths.writeUInt32LE(INVALID, 1 * PATH_SIZE + 12);
    expect(buildArrangeConfig(cfg, new Map([[K(200), { x: 0, y: 0 }]]))).toBeNull();
  });

  it("sin cambios pedidos → null (no hay nada que hacer)", () => {
    expect(buildArrangeConfig(placed(), new Map())).toBeNull();
  });
});
