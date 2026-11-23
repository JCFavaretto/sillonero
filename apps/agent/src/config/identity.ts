import { base64UrlToBytes, bytesToBase64Url, keyPairFromPrivate, type KeyPair } from "@proyecto-e/protocol";
import type { Random } from "../ports";

// Identidad de la PC: un par de claves X25519 fijo (docs/PLAN.md D9). La pública va en el QR; la privada
// no sale nunca de agent.json. Si alguien la copia puede hacerse pasar por la PC: por eso no se loguea.

export interface Identity {
  publicKey: string;
  privateKey: string;
}

export function generateIdentity(random: Random): Identity {
  const kp = keyPairFromPrivate(random.bytes(32));
  return { publicKey: bytesToBase64Url(kp.publicKey), privateKey: bytesToBase64Url(kp.privateKey) };
}

export function identityToKeyPair(identity: Identity): KeyPair {
  const priv = base64UrlToBytes(identity.privateKey);
  if (priv === null || priv.length !== 32) throw new Error("la clave privada de la identidad es inválida");
  return keyPairFromPrivate(priv);
}
