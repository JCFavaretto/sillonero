import {
  bytesToBase64Url,
  decodeHs2Payload,
  encodeFrame,
  encodeHs1Payload,
  initiatorHandshake,
  keyPairFromPrivate,
  openFrame,
  parseFrame,
  parseServerMessage,
  sealToFrame,
  type Hs1Payload,
  type Hs2Payload,
  type KeyPair,
  type ServerMessage,
  type Transport,
} from "@proyecto-e/protocol";

// Un celu falso que habla el protocolo v2 de verdad (Noise IK) contra una sesión o un servidor.
// Sirve para los tests del agente; no tiene nada que ver con el cliente real de la app.

export type Incoming = { type: "hs2"; payload: Hs2Payload } | ServerMessage;

let counter = 100;
/** Azar determinista pero distinto en cada llamada (los tests no necesitan azar real). */
export const testRandom = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (counter++ * 29 + i * 11) % 256);

export function newKeyPair(): KeyPair {
  return keyPairFromPrivate(testRandom(32));
}

export interface Phone {
  readonly keyPair: KeyPair;
  /** Clave pública en base64url, como la guarda el agente en `agent.json`. */
  readonly publicKey: string;
  /** Marco `hs1` listo para mandar. */
  hello(payload: Hs1Payload): string;
  /** Marco `data` cifrado con un mensaje de aplicación. */
  send(type: string, payload?: Record<string, unknown>): string;
  /** Marco `data` con basura cifrada (descifra pero no es un mensaje válido). */
  sendRaw(text: string): string;
  /** Interpreta lo que mandó el agente (hs2 o mensajes cifrados), en orden. Tira si algo no se puede leer. */
  read(frames: string[]): Incoming[];
  /** El transporte, para probar casos raros (marcos alterados o repetidos). */
  transport(): Transport;
}

export function createPhone(pcPublicKey: Uint8Array, keyPair: KeyPair = newKeyPair()): Phone {
  const init = initiatorHandshake({ s: keyPair, rs: pcPublicKey, random: testRandom });
  let transport: Transport | null = null;
  let seq = 0;

  const need = () => {
    if (!transport) throw new Error("el handshake todavía no terminó");
    return transport;
  };

  return {
    keyPair,
    publicKey: bytesToBase64Url(keyPair.publicKey),
    hello: (payload) => encodeFrame("hs1", init.writeHs1(encodeHs1Payload(payload))),
    send: (type, payload = {}) => sealToFrame(need(), JSON.stringify({ v: 1, id: `p${++seq}`, type, payload })),
    sendRaw: (text) => sealToFrame(need(), text),
    transport: need,
    read(frames) {
      return frames.map((raw): Incoming => {
        const f = parseFrame(raw);
        if (!f.ok) throw new Error(`el agente mandó un marco inválido: ${f.detail}`);
        if (f.kind === "hs2") {
          const r = init.readHs2(f.data);
          transport = r.transport;
          const p = decodeHs2Payload(r.payload);
          if (!p.ok) throw new Error(`hs2 inválido: ${p.detail}`);
          return { type: "hs2", payload: p.payload };
        }
        if (f.kind !== "data") throw new Error(`marco inesperado: ${f.kind}`);
        const m = parseServerMessage(openFrame(need(), f.data));
        if (!m.ok) throw new Error(`mensaje inválido del agente: ${m.detail}`);
        return m.msg;
      });
    },
  };
}
