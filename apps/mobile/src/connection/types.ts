/**
 * La PC emparejada, tal como se guarda en expo-secure-store (clave `pairedPc.v2`).
 * La identidad del celu es su clave privada: no hay token (docs/PLAN.md D9).
 */
export interface PairedPc {
  v: 2;
  host: string;
  port: number;
  pcName: string;
  /** Clave pública de la PC (32 bytes en base64url), del QR. */
  pcPublicKey: string;
  /** Clave privada de este celu (32 bytes en base64url). */
  devicePrivateKey: string;
  /** `null` mientras el emparejamiento no terminó: un registro así se descarta al arrancar. */
  deviceId: string | null;
  pairedAt: string | null;
}
