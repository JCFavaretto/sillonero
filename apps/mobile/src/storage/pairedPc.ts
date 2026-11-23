import { Base64Url } from "@proyecto-e/protocol";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import type { PairedPc } from "@/connection/types";

const KEY = "pairedPc.v2";
/** El emparejamiento de B1 (con token, sin cifrado): ya no sirve y se borra. */
const LEGACY_KEY = "pairedPc.v1";

const Key = Base64Url.length(43); // 32 bytes

const Schema = z.strictObject({
  v: z.literal(2),
  host: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
  pcName: z.string().min(1).max(64),
  /** Clave pública de la PC (del QR). */
  pcPublicKey: Key,
  /** Clave privada de este celu. Vive solo acá, en el almacenamiento seguro. */
  devicePrivateKey: Key,
  /** null hasta que la PC confirma el emparejamiento. */
  deviceId: z.uuid().nullable(),
  pairedAt: z.string().nullable(),
});

export async function savePairedPc(pc: PairedPc): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(pc));
}

export interface LoadedPc {
  pc: PairedPc | null;
  /** Había un emparejamiento de B1: se borró y hay que volver a escanear el QR. */
  upgraded: boolean;
}

/** Si lo guardado está roto o no cumple el esquema, se borra y se vuelve a Conectar. */
export async function loadPairedPc(): Promise<LoadedPc> {
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
  if (legacy !== null) await SecureStore.deleteItemAsync(LEGACY_KEY);

  const raw = await SecureStore.getItemAsync(KEY);
  if (raw === null) return { pc: null, upgraded: legacy !== null };
  try {
    const parsed = Schema.safeParse(JSON.parse(raw));
    if (parsed.success) return { pc: parsed.data, upgraded: false };
  } catch {
    // JSON roto: cae al borrado
  }
  await SecureStore.deleteItemAsync(KEY);
  return { pc: null, upgraded: false };
}

export async function deletePairedPc(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
