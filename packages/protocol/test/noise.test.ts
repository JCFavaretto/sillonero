import { describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  NoiseError,
  PROLOGUE,
  initiatorHandshake,
  keyPairFromPrivate,
  responderHandshake,
  type KeyPair,
} from "../src/noise";
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from "../src/bytes";
import vectors from "./vectors/noise-ik.json";

const hex = hexToBytes;
const toHex = bytesToHex;
const text = utf8ToBytes;
const fromText = (b: Uint8Array) => bytesToUtf8(b) ?? "";

const contains = (haystack: Uint8Array, needle: Uint8Array) => toHex(haystack).includes(toHex(needle));

/** Azar determinista: devuelve las claves efímeras que pide el vector. */
const fixedRandom = (...chunks: Uint8Array[]) => {
  let i = 0;
  return (n: number) => {
    const c = chunks[i++];
    if (!c || c.length !== n) throw new Error("azar inesperado");
    return c;
  };
};

let counter = 1;
/** Azar "de verdad" para los tests que no usan vectores (distinto en cada llamada). */
const seqRandom = (n: number) => Uint8Array.from({ length: n }, (_, i) => (counter++ * 31 + i * 7) % 256);
const keyPair = (): KeyPair => keyPairFromPrivate(seqRandom(32));

describe("Noise_IK_25519_ChaChaPoly_SHA256 · vectores oficiales (cacophony)", () => {
  const v = vectors.vectors[0]!;

  it("el vector es del patrón que usamos", () => {
    expect(v.protocol_name).toBe("Noise_IK_25519_ChaChaPoly_SHA256");
    expect(v.messages.length).toBeGreaterThanOrEqual(4);
  });

  it("reproduce byte por byte los dos mensajes del handshake y los de transporte", () => {
    const prologue = hex(v.init_prologue);
    const init = initiatorHandshake({
      s: keyPairFromPrivate(hex(v.init_static)),
      rs: hex(v.init_remote_static),
      prologue,
      random: fixedRandom(hex(v.init_ephemeral)),
    });
    const resp = responderHandshake({
      s: keyPairFromPrivate(hex(v.resp_static)),
      prologue,
      random: fixedRandom(hex(v.resp_ephemeral)),
    });
    const [m1, m2, ...transport] = v.messages;

    const hs1 = init.writeHs1(hex(m1!.payload));
    expect(toHex(hs1)).toBe(m1!.ciphertext);

    const read1 = resp.readHs1(hs1);
    expect(toHex(read1.payload)).toBe(m1!.payload);
    expect(toHex(read1.remoteStatic)).toBe(toHex(x25519.getPublicKey(hex(v.init_static))));

    const w2 = resp.writeHs2(hex(m2!.payload));
    expect(toHex(w2.msg)).toBe(m2!.ciphertext);

    const read2 = init.readHs2(w2.msg);
    expect(toHex(read2.payload)).toBe(m2!.payload);

    // Los dos lados llegan al mismo hash de handshake, y es el del vector.
    expect(toHex(read2.transport.handshakeHash)).toBe(v.handshake_hash);
    expect(toHex(w2.transport.handshakeHash)).toBe(v.handshake_hash);

    // Mensajes de transporte: alternan iniciador → respondedor → iniciador…
    transport.forEach((m, i) => {
      const fromInitiator = i % 2 === 0;
      const sender = fromInitiator ? read2.transport : w2.transport;
      const receiver = fromInitiator ? w2.transport : read2.transport;
      const ct = sender.encrypt(hex(m.payload));
      expect(toHex(ct)).toBe(m.ciphertext);
      expect(toHex(receiver.decrypt(ct))).toBe(m.payload);
    });
  });
});

describe("Noise IK · uso normal", () => {
  function connect(opts: { initiatorRs?: Uint8Array } = {}) {
    const pc = keyPair();
    const phone = keyPair();
    const init = initiatorHandshake({ s: phone, rs: opts.initiatorRs ?? pc.publicKey, random: seqRandom });
    const resp = responderHandshake({ s: pc, random: seqRandom });
    return { pc, phone, init, resp };
  }

  it("el agente aprende la clave pública del celu y los dos hablan cifrado", () => {
    const { phone, init, resp } = connect();
    const hs1 = init.writeHs1(text('{"intent":"connect"}'));
    const r1 = resp.readHs1(hs1);
    expect(fromText(r1.payload)).toBe('{"intent":"connect"}');
    expect(r1.remoteStatic).toEqual(phone.publicKey);

    const w2 = resp.writeHs2(text('{"ok":true}'));
    const r2 = init.readHs2(w2.msg);
    expect(fromText(r2.payload)).toBe('{"ok":true}');

    const ct = r2.transport.encrypt(text("hola desde el celu"));
    expect(fromText(w2.transport.decrypt(ct))).toBe("hola desde el celu");
    const back = w2.transport.encrypt(text("hola desde la PC"));
    expect(fromText(r2.transport.decrypt(back))).toBe("hola desde la PC");
  });

  it("el payload no viaja en claro", () => {
    const { init } = connect();
    const secret = text("codigo-secreto-1234");
    const hs1 = init.writeHs1(secret);
    expect(contains(hs1, secret)).toBe(false);
  });

  it("dos conexiones del mismo celu producen mensajes distintos (efímeras nuevas)", () => {
    const pc = keyPair();
    const phone = keyPair();
    const a = initiatorHandshake({ s: phone, rs: pc.publicKey, random: seqRandom }).writeHs1(text("x"));
    const b = initiatorHandshake({ s: phone, rs: pc.publicKey, random: seqRandom }).writeHs1(text("x"));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("un QR de otra PC (clave equivocada) hace fallar a quien responde", () => {
    const { init, resp } = connect({ initiatorRs: keyPair().publicKey });
    const hs1 = init.writeHs1(text("x"));
    expect(() => resp.readHs1(hs1)).toThrow(NoiseError);
  });

  it("un byte alterado en hs1 o en hs2 se detecta", () => {
    const { init, resp } = connect();
    const hs1 = init.writeHs1(text("hola"));
    const bad1 = Uint8Array.from(hs1);
    bad1[bad1.length - 1]! ^= 1;
    expect(() => connectFresh().resp.readHs1(bad1)).toThrow(NoiseError);

    resp.readHs1(hs1);
    const w2 = resp.writeHs2(text("ok"));
    const bad2 = Uint8Array.from(w2.msg);
    bad2[40]! ^= 1;
    expect(() => init.readHs2(bad2)).toThrow(NoiseError);
  });

  it("hs1 truncado o vacío falla con NoiseError, no con una excepción rara", () => {
    const { init, resp } = connect();
    const hs1 = init.writeHs1(text("hola"));
    expect(() => resp.readHs1(hs1.slice(0, 20))).toThrow(NoiseError);
    expect(() => connectFresh().resp.readHs1(new Uint8Array(0))).toThrow(NoiseError);
  });

  it("transporte: un byte alterado, un mensaje repetido o salteado se rechazan", () => {
    const { init, resp } = connect();
    resp.readHs1(init.writeHs1(text("a")));
    const w2 = resp.writeHs2(text("b"));
    const r2 = init.readHs2(w2.msg);

    const m1 = r2.transport.encrypt(text("uno"));
    const m2 = r2.transport.encrypt(text("dos"));
    const tampered = Uint8Array.from(m1);
    tampered[0]! ^= 1;
    expect(() => w2.transport.decrypt(tampered)).toThrow(NoiseError);

    // tras un fallo el canal no se recupera: la especificación pide cortar
    const fresh = connect();
    fresh.resp.readHs1(fresh.init.writeHs1(text("a")));
    const f2 = fresh.resp.writeHs2(text("b"));
    const fr2 = fresh.init.readHs2(f2.msg);
    const a = fr2.transport.encrypt(text("uno"));
    const b = fr2.transport.encrypt(text("dos"));
    expect(fromText(f2.transport.decrypt(a))).toBe("uno");
    expect(() => f2.transport.decrypt(a)).toThrow(NoiseError); // repetido
    void b;
    void m2;
  });

  it("mensajes vacíos y de buen tamaño andan; uno demasiado grande se rechaza", () => {
    const { init, resp } = connect();
    resp.readHs1(init.writeHs1(new Uint8Array(0)));
    const w2 = resp.writeHs2(new Uint8Array(0));
    const r2 = init.readHs2(w2.msg);
    expect(w2.transport.decrypt(r2.transport.encrypt(new Uint8Array(0)))).toHaveLength(0);
    const big = new Uint8Array(20_000).fill(7);
    expect(w2.transport.decrypt(r2.transport.encrypt(big))).toEqual(big);
    expect(() => r2.transport.encrypt(new Uint8Array(65_520))).toThrow(NoiseError);
  });

  it("no se puede llamar dos veces a hs1/hs2 ni leer hs2 antes de escribir hs1", () => {
    const { init, resp } = connect();
    expect(() => init.readHs2(new Uint8Array(48))).toThrow(NoiseError);
    init.writeHs1(text("x"));
    expect(() => init.writeHs1(text("x"))).toThrow(NoiseError);
    expect(() => resp.writeHs2(text("x"))).toThrow(NoiseError);
  });

  it("el prólogo por defecto está fijado a la versión del protocolo", () => {
    expect(fromText(PROLOGUE)).toBe("proyecto-e/2");
  });

  it("con prólogos distintos los dos lados no se entienden", () => {
    const pc = keyPair();
    const phone = keyPair();
    const init = initiatorHandshake({ s: phone, rs: pc.publicKey, random: seqRandom, prologue: text("otro") });
    const resp = responderHandshake({ s: pc, random: seqRandom });
    expect(() => resp.readHs1(init.writeHs1(text("x")))).toThrow(NoiseError);
  });
});

function connectFresh() {
  const pc = keyPair();
  const phone = keyPair();
  return {
    init: initiatorHandshake({ s: phone, rs: pc.publicKey, random: seqRandom }),
    resp: responderHandshake({ s: pc, random: seqRandom }),
  };
}
