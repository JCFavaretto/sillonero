import { describe, expect, it } from "vitest";
import {
  MODE_SIZE,
  PATH_SIZE,
  buildRawDisplays,
  encodeTargetNameRequest,
  parsePaths,
  parseSourceBounds,
  parseTargetName,
  type CcdPath,
  type TargetName,
} from "../src/platform/win/ccd";

// Estructuras de Windows armadas a mano (tamaños y offsets de docs/PLAN.md 8.2.4, medidos en la PC de Jay).

interface PathSpec {
  srcId?: number;
  srcModeIdx?: number;
  tgtAdapterLo?: number;
  tgtAdapterHi?: number;
  tgtId: number;
  tech?: number;
  available?: boolean;
  active?: boolean;
}

function pathBuffer(specs: PathSpec[]): Buffer {
  const b = Buffer.alloc(specs.length * PATH_SIZE);
  specs.forEach((s, i) => {
    const o = i * PATH_SIZE;
    b.writeUInt32LE(s.srcId ?? 0, o + 8);
    b.writeUInt32LE(s.srcModeIdx ?? 0xffffffff, o + 12);
    b.writeUInt32LE(s.tgtAdapterLo ?? 89037, o + 20);
    b.writeInt32LE(s.tgtAdapterHi ?? 0, o + 24);
    b.writeUInt32LE(s.tgtId, o + 28);
    b.writeInt32LE(s.tech ?? 4, o + 36);
    b.writeUInt32LE(s.available ? 1 : 0, o + 60);
    b.writeUInt32LE(s.active ? 1 : 0, o + 68);
  });
  return b;
}

function modeBuffer(modes: { w: number; h: number; x: number; y: number; infoType?: number }[]): Buffer {
  const b = Buffer.alloc(modes.length * MODE_SIZE);
  modes.forEach((m, i) => {
    const o = i * MODE_SIZE;
    b.writeUInt32LE(m.infoType ?? 1, o);
    b.writeUInt32LE(m.w, o + 16);
    b.writeUInt32LE(m.h, o + 20);
    b.writeInt32LE(m.x, o + 28);
    b.writeInt32LE(m.y, o + 32);
  });
  return b;
}

const names = (table: Record<number, Partial<TargetName>>) => (p: CcdPath): TargetName | null => {
  const n = table[p.targetId];
  return n ? { friendlyName: "", devicePath: "", outputTechnology: 4, ...n } : null;
};

describe("parsePaths", () => {
  it("lee adaptador, ids, tecnología, disponibilidad y bandera de activo", () => {
    const [a, b] = parsePaths(
      pathBuffer([
        { srcId: 2, srcModeIdx: 5, tgtAdapterLo: 7, tgtAdapterHi: -1, tgtId: 49409, tech: 5, available: true, active: true },
        { tgtId: 49408 },
      ]),
      2,
    );
    expect(a).toMatchObject({ sourceId: 2, sourceModeIdx: 5, adapterLow: 7, adapterHigh: -1, targetId: 49409, outputTechnology: 5, available: true, active: true });
    expect(b).toMatchObject({ targetId: 49408, available: false, active: false, sourceModeIdx: 0xffffffff });
  });

  it("no lee más de lo que hay en el buffer", () => {
    expect(parsePaths(pathBuffer([{ tgtId: 1 }]), 5)).toHaveLength(1);
    expect(parsePaths(Buffer.alloc(0), 0)).toEqual([]);
  });
});

describe("parseSourceBounds", () => {
  const modes = modeBuffer([
    { w: 1920, h: 1080, x: 0, y: 0 },
    { w: 1920, h: 1080, x: -1920, y: 0 },
    { w: 0, h: 0, x: 0, y: 0, infoType: 2 }, // modo de destino, no de origen
  ]);

  it("devuelve posición y tamaño, también con coordenadas negativas", () => {
    expect(parseSourceBounds(modes, 1)).toEqual({ x: -1920, y: 0, w: 1920, h: 1080 });
  });

  it("índice inválido, fuera de rango o que no es un modo de origen → null", () => {
    expect(parseSourceBounds(modes, 0xffffffff)).toBeNull();
    expect(parseSourceBounds(modes, 9)).toBeNull();
    expect(parseSourceBounds(modes, 2)).toBeNull();
  });
});

describe("DISPLAYCONFIG_TARGET_DEVICE_NAME", () => {
  it("el pedido tiene el tamaño, el tipo y el destino correctos", () => {
    const req = encodeTargetNameRequest({ adapterLow: 89037, adapterHigh: 0, targetId: 49415 } as CcdPath);
    expect(req.length).toBe(420);
    expect(req.readUInt32LE(0)).toBe(2); // DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME
    expect(req.readUInt32LE(4)).toBe(420);
    expect(req.readUInt32LE(8)).toBe(89037);
    expect(req.readUInt32LE(16)).toBe(49415);
  });

  it("parsea el nombre amistoso, la ruta y la tecnología (UTF-16, hasta el primer 0)", () => {
    const res = Buffer.alloc(420);
    res.writeInt32LE(5, 24);
    res.write("LF24T35", 36, "utf16le");
    res.write("\\\\?\\DISPLAY#SAM707D#UID49409", 164, "utf16le");
    expect(parseTargetName(res)).toEqual({
      friendlyName: "LF24T35",
      devicePath: "\\\\?\\DISPLAY#SAM707D#UID49409",
      outputTechnology: 5,
    });
  });
});

describe("buildRawDisplays", () => {
  // La PC de Jay: tres activas (izquierda, principal, derecha), una conectada pero apagada y una sin nada enchufado.
  const active = parsePaths(
    pathBuffer([
      { srcId: 0, srcModeIdx: 0, tgtId: 49415, available: true, active: true },
      { srcId: 1, srcModeIdx: 1, tgtId: 49411, available: true, active: true },
      { srcId: 2, srcModeIdx: 2, tgtId: 49409, tech: 5, available: true, active: true },
    ]),
    3,
  );
  const modes = modeBuffer([
    { w: 1920, h: 1080, x: 0, y: 0 },
    { w: 1920, h: 1080, x: -1920, y: 0 },
    { w: 1920, h: 1080, x: 1920, y: 0 },
  ]);
  const NAMES = {
    49415: { friendlyName: "LF24T35", devicePath: "path-49415" },
    49411: { friendlyName: "LG TV", devicePath: "path-49411" },
    49409: { friendlyName: "LF24T35", devicePath: "path-49409", outputTechnology: 5 },
    49412: { friendlyName: "Samsung TV", devicePath: "path-tele", outputTechnology: 5 },
  };

  const all = (extra: PathSpec[] = []) =>
    parsePaths(
      pathBuffer([
        { srcId: 0, srcModeIdx: 0, tgtId: 49415, available: true, active: true },
        { srcId: 1, srcModeIdx: 1, tgtId: 49411, available: true, active: true },
        { srcId: 2, srcModeIdx: 2, tgtId: 49409, available: true, active: true },
        { srcId: 0, tgtId: 49415, available: true }, // el mismo monitor por otro camino posible
        { srcId: 0, tgtId: 49413 }, // sin nada enchufado
        ...extra,
      ]),
      5 + extra.length,
    );

  it("devuelve una pantalla por monitor conectado, con bounds de las activas", () => {
    const raw = buildRawDisplays({ all: all(), active, modes }, names(NAMES));
    expect(raw).toHaveLength(3);
    expect(raw.find((r) => r.devicePath === "path-49411")).toMatchObject({
      friendlyName: "LG TV",
      active: true,
      primary: false,
      bounds: { x: -1920, y: 0, w: 1920, h: 1080 },
    });
  });

  it("la principal es la que está en (0,0)", () => {
    const raw = buildRawDisplays({ all: all(), active, modes }, names(NAMES));
    expect(raw.filter((r) => r.primary).map((r) => r.devicePath)).toEqual(["path-49415"]);
  });

  it("un monitor conectado pero apagado aparece como inactivo, con su nombre y sin bounds", () => {
    const tele: PathSpec = { srcId: 0, tgtId: 49412, tech: 10, available: true };
    const raw = buildRawDisplays({ all: all([tele]), active, modes }, names(NAMES));
    expect(raw).toHaveLength(4);
    expect(raw.find((r) => r.devicePath === "path-tele")).toMatchObject({
      friendlyName: "Samsung TV",
      active: false,
      primary: false,
      bounds: null,
      outputTechnology: 5, // el de TARGET_NAME, porque el camino inactivo trae valores por defecto
    });
  });

  it("un destino sin monitor enchufado (targetAvailable=0, inactivo) no se muestra", () => {
    const raw = buildRawDisplays({ all: all(), active, modes }, names(NAMES));
    expect(raw.some((r) => r.devicePath === "")).toBe(false);
    expect(raw).toHaveLength(3);
  });

  it("si Windows no da la ruta del dispositivo, arma una clave de respaldo estable", () => {
    const raw = buildRawDisplays({ all: all(), active, modes }, names({ ...NAMES, 49415: { friendlyName: "X", devicePath: "" } }));
    const sinRuta = raw.find((r) => r.friendlyName === "X");
    expect(sinRuta?.devicePath).toBe("ccd:89037:0:49415");
  });

  it("si no puede leer el nombre de un monitor activo, igual lo muestra (sin nombre)", () => {
    const raw = buildRawDisplays({ all: all(), active, modes }, names({ 49415: NAMES[49415], 49409: NAMES[49409] }));
    const sinNombre = raw.find((r) => r.devicePath === "ccd:89037:0:49411");
    expect(sinNombre).toMatchObject({ friendlyName: "", active: true });
  });

  it("activa pero sin modo de origen válido: queda activa sin bounds", () => {
    const brokenActive = parsePaths(pathBuffer([{ srcId: 0, srcModeIdx: 0xffffffff, tgtId: 49415, available: true, active: true }]), 1);
    const raw = buildRawDisplays({ all: brokenActive, active: brokenActive, modes }, names(NAMES));
    expect(raw[0]).toMatchObject({ active: true, bounds: null, primary: false });
  });
});
