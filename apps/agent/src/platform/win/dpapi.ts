import koffi from "koffi";
import type { Secret } from "../../ports";

// DPAPI con koffi (docs/PLAN.md D73, verificado en el spike S1 del 09/11/2026): `CryptProtectData` y `CryptUnprotectData` con
// alcance de usuario. Solo la cuenta de Windows que cifró, en esta PC, puede abrir el resultado. Se carga recién al primer uso.

const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

interface Native {
  protect(plain: Uint8Array): Uint8Array;
  unprotect(cipher: Uint8Array): Uint8Array;
}

function load(): Native {
  const crypt32 = koffi.load("crypt32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const Blob = koffi.struct("PE_DATA_BLOB", { cbData: "uint32", pbData: "void *" });
  const CryptProtectData = crypt32.func("int __stdcall CryptProtectData(PE_DATA_BLOB *in, str16 desc, void *entropy, void *reserved, void *prompt, uint32 flags, _Out_ PE_DATA_BLOB *out)");
  const CryptUnprotectData = crypt32.func("int __stdcall CryptUnprotectData(PE_DATA_BLOB *in, _Out_ void *desc, void *entropy, void *reserved, void *prompt, uint32 flags, _Out_ PE_DATA_BLOB *out)");
  const LocalFree = kernel32.func("void * __stdcall LocalFree(void *p)");
  void Blob;

  /** Pasa los bytes por la función de Windows y libera el buffer que Windows reservó. */
  function run(fn: (input: { cbData: number; pbData: Buffer }, out: { cbData: number; pbData: unknown }) => number, data: Uint8Array, what: string): Uint8Array {
    const input = { cbData: data.length, pbData: Buffer.from(data) };
    const out = {} as { cbData: number; pbData: unknown };
    if (!fn(input, out)) throw new Error(`${what} falló`);
    try {
      return Uint8Array.from(koffi.decode(out.pbData, "uint8_t", out.cbData) as ArrayLike<number>);
    } finally {
      LocalFree(out.pbData);
    }
  }

  return {
    protect: (plain) => run((i, o) => CryptProtectData(i, "Proyecto E", null, null, null, CRYPTPROTECT_UI_FORBIDDEN, o) as number, plain, "CryptProtectData"),
    unprotect: (cipher) => run((i, o) => CryptUnprotectData(i, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, o) as number, cipher, "CryptUnprotectData"),
  };
}

export function createDpapiSecret(): Secret {
  let native: Native | null = null;
  const get = () => (native ??= load());
  return {
    protect: (plain) => get().protect(plain),
    unprotect: (cipher) => get().unprotect(cipher),
  };
}
