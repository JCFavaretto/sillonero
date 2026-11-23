import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "../bytes";

// Noise_IK_25519_ChaChaPoly_SHA256, según la especificación (revisión 34), sin "mejoras".
//   <- s                       (el celu conoce la clave de la PC por el QR)
//   ...
//   -> e, es, s, ss            hs1
//   <- e, ee, se               hs2
// Las primitivas son de @noble (JS puro, auditadas). El azar entra por `random`: el agente usa
// `crypto.randomBytes`, el celu `expo-crypto`, y los tests unas claves fijas (vectores oficiales).

const PROTOCOL_NAME = "Noise_IK_25519_ChaChaPoly_SHA256";
const DH_LEN = 32;
const TAG_LEN = 16;
const HASH_LEN = 32;
/** Tope de la especificación para un mensaje Noise (65535 bytes en total, con la etiqueta). */
const MAX_MESSAGE = 65_535;

/** Prólogo: ata el handshake a la versión del protocolo. */
export const PROLOGUE: Uint8Array = utf8ToBytes("proyecto-e/2");

export class NoiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoiseError";
  }
}

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function keyPairFromPrivate(privateKey: Uint8Array): KeyPair {
  if (privateKey.length !== DH_LEN) throw new NoiseError("la clave privada tiene que ser de 32 bytes");
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export type RandomBytes = (n: number) => Uint8Array;

export interface Transport {
  encrypt(plain: Uint8Array): Uint8Array;
  decrypt(cipher: Uint8Array): Uint8Array;
  /** Hash del handshake: igual en los dos lados (sirve para verificar a mano que hablan con quien creen). */
  handshakeHash: Uint8Array;
}

// ── Primitivas ───────────────────────────────────────────────────────────────

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  const out = x25519.getSharedSecret(priv, pub);
  // Un punto de orden bajo da todo ceros: la especificación lo permite, pero acá no tiene sentido aceptarlo.
  if (out.every((b) => b === 0)) throw new NoiseError("clave pública inválida");
  return out;
}

/** HKDF de Noise: HMAC con la clave temporal; salidas de 32 bytes. */
function hkdf(chainingKey: Uint8Array, ikm: Uint8Array, outputs: 2): [Uint8Array, Uint8Array] {
  void outputs;
  const temp = hmac(sha256, chainingKey, ikm);
  const o1 = hmac(sha256, temp, Uint8Array.of(0x01));
  const o2 = hmac(sha256, temp, concat(o1, Uint8Array.of(0x02)));
  return [o1, o2];
}

/** Nonce de ChaChaPoly en Noise: 32 bits en cero + contador de 64 bits en little-endian. */
function nonceFor(n: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, n, true);
  return nonce;
}

class CipherState {
  private n = 0n;
  constructor(private k: Uint8Array | null) {}

  hasKey(): boolean {
    return this.k !== null;
  }

  encryptWithAd(ad: Uint8Array, plain: Uint8Array): Uint8Array {
    if (this.k === null) return plain;
    if (plain.length + TAG_LEN > MAX_MESSAGE) throw new NoiseError("mensaje demasiado grande");
    const out = chacha20poly1305(this.k, nonceFor(this.n), ad).encrypt(plain);
    this.n++;
    return out;
  }

  decryptWithAd(ad: Uint8Array, cipher: Uint8Array): Uint8Array {
    if (this.k === null) return cipher;
    if (cipher.length < TAG_LEN || cipher.length > MAX_MESSAGE) throw new NoiseError("mensaje con largo inválido");
    try {
      const out = chacha20poly1305(this.k, nonceFor(this.n), ad).decrypt(cipher);
      this.n++;
      return out;
    } catch {
      throw new NoiseError("no se pudo descifrar (clave, orden o contenido incorrectos)");
    }
  }
}

class SymmetricState {
  private ck: Uint8Array;
  private h: Uint8Array;
  private cs = new CipherState(null);

  constructor(protocolName: string, prologue: Uint8Array) {
    const name = utf8ToBytes(protocolName);
    // Con un nombre de hasta 32 bytes, h es el nombre rellenado con ceros; si no, su hash.
    this.h = name.length <= HASH_LEN ? concat(name, new Uint8Array(HASH_LEN - name.length)) : sha256(name);
    this.ck = this.h;
    this.mixHash(prologue);
  }

  mixHash(data: Uint8Array): void {
    this.h = sha256(concat(this.h, data));
  }

  mixKey(ikm: Uint8Array): void {
    const [ck, k] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cs = new CipherState(k);
  }

  hasKey(): boolean {
    return this.cs.hasKey();
  }

  encryptAndHash(plain: Uint8Array): Uint8Array {
    const cipher = this.cs.encryptWithAd(this.h, plain);
    this.mixHash(cipher);
    return cipher;
  }

  decryptAndHash(cipher: Uint8Array): Uint8Array {
    const plain = this.cs.decryptWithAd(this.h, cipher);
    this.mixHash(cipher);
    return plain;
  }

  /** Fin del handshake: dos CipherState (uno por sentido) y el hash final. */
  split(): { c1: CipherState; c2: CipherState; hash: Uint8Array } {
    const [k1, k2] = hkdf(this.ck, new Uint8Array(0), 2);
    return { c1: new CipherState(k1), c2: new CipherState(k2), hash: this.h };
  }
}

function transportOf(send: CipherState, receive: CipherState, handshakeHash: Uint8Array): Transport {
  const none = new Uint8Array(0);
  return {
    handshakeHash,
    encrypt: (plain) => send.encryptWithAd(none, plain),
    decrypt: (cipher) => receive.decryptWithAd(none, cipher),
  };
}

function ephemeral(random: RandomBytes): KeyPair {
  return keyPairFromPrivate(random(DH_LEN));
}

// ── Iniciador (el celu) ──────────────────────────────────────────────────────

export interface InitiatorOptions {
  /** Clave estática del celu. */
  s: KeyPair;
  /** Clave pública de la PC (viene en el QR). */
  rs: Uint8Array;
  random: RandomBytes;
  prologue?: Uint8Array;
}

export function initiatorHandshake(o: InitiatorOptions) {
  const ss = new SymmetricState(PROTOCOL_NAME, o.prologue ?? PROLOGUE);
  ss.mixHash(o.rs); // pre-mensaje "<- s"
  let e: KeyPair | null = null;
  let state: "start" | "sent" | "done" = "start";

  return {
    writeHs1(payload: Uint8Array): Uint8Array {
      if (state !== "start") throw new NoiseError("hs1 ya se escribió");
      e = ephemeral(o.random);
      ss.mixHash(e.publicKey); // e
      ss.mixKey(dh(e.privateKey, o.rs)); // es
      const encryptedS = ss.encryptAndHash(o.s.publicKey); // s
      ss.mixKey(dh(o.s.privateKey, o.rs)); // ss
      const body = ss.encryptAndHash(payload);
      state = "sent";
      return concat(e.publicKey, encryptedS, body);
    },

    readHs2(msg: Uint8Array): { payload: Uint8Array; transport: Transport } {
      if (state !== "sent" || e === null) throw new NoiseError("hs2 antes de hs1");
      if (msg.length < DH_LEN + TAG_LEN) throw new NoiseError("hs2 demasiado corto");
      const re = msg.subarray(0, DH_LEN);
      ss.mixHash(re); // e
      ss.mixKey(dh(e.privateKey, re)); // ee
      ss.mixKey(dh(o.s.privateKey, re)); // se
      const payload = ss.decryptAndHash(msg.subarray(DH_LEN));
      const { c1, c2, hash } = ss.split();
      state = "done";
      return { payload, transport: transportOf(c1, c2, hash) };
    },
  };
}

// ── Respondedor (el agente) ──────────────────────────────────────────────────

export interface ResponderOptions {
  /** Clave estática de la PC. */
  s: KeyPair;
  random: RandomBytes;
  prologue?: Uint8Array;
}

export function responderHandshake(o: ResponderOptions) {
  const ss = new SymmetricState(PROTOCOL_NAME, o.prologue ?? PROLOGUE);
  ss.mixHash(o.s.publicKey); // pre-mensaje "<- s"
  let re: Uint8Array | null = null;
  let rs: Uint8Array | null = null;
  let state: "start" | "read" | "done" = "start";

  return {
    readHs1(msg: Uint8Array): { payload: Uint8Array; remoteStatic: Uint8Array } {
      if (state !== "start") throw new NoiseError("hs1 ya se leyó");
      if (msg.length < DH_LEN + DH_LEN + TAG_LEN + TAG_LEN) throw new NoiseError("hs1 demasiado corto");
      const remoteEphemeral = msg.slice(0, DH_LEN);
      ss.mixHash(remoteEphemeral); // e
      ss.mixKey(dh(o.s.privateKey, remoteEphemeral)); // es
      const remoteStatic = ss.decryptAndHash(msg.subarray(DH_LEN, DH_LEN + DH_LEN + TAG_LEN)); // s
      ss.mixKey(dh(o.s.privateKey, remoteStatic)); // ss
      const payload = ss.decryptAndHash(msg.subarray(DH_LEN + DH_LEN + TAG_LEN));
      re = remoteEphemeral;
      rs = remoteStatic;
      state = "read";
      return { payload, remoteStatic };
    },

    writeHs2(payload: Uint8Array): { msg: Uint8Array; transport: Transport } {
      if (state !== "read" || re === null || rs === null) throw new NoiseError("hs2 antes de leer hs1");
      const e = ephemeral(o.random);
      ss.mixHash(e.publicKey); // e
      ss.mixKey(dh(e.privateKey, re)); // ee
      ss.mixKey(dh(e.privateKey, rs)); // se
      const body = ss.encryptAndHash(payload);
      const { c1, c2, hash } = ss.split();
      state = "done";
      // El respondedor envía con c2 y recibe con c1.
      return { msg: concat(e.publicKey, body), transport: transportOf(c2, c1, hash) };
    },
  };
}
