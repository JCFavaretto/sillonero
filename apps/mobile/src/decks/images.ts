import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { MAX_ANIMATED_BYTES, STATIC_SIZE, detectAnimated, squareCrop } from "./imageMath";

// Elegir la imagen de una tecla (D105). APIs de expo-image-picker, expo-image-manipulator y expo-file-system leídas de sus tipos
// instalados (SDK 58). Lo que depende del celu real (la galería, el recorte) se verifica a mano; las cuentas están en `imageMath`.

export type PickedImage =
  | { ok: true; base64: string; ext: "jpg" | "png" | "gif" | "webp"; animated: boolean }
  | { ok: false; reason: "canceled" | "permission" | "failed" }
  /** Es animada y pesa más que el tope: se puede usar solo el primer cuadro (`pickDeckImage(true)` con la misma foto). */
  | { ok: false; reason: "tooBig"; bytes: number };

const extFor = (mime: string | undefined, uri: string): "jpg" | "png" | "gif" | "webp" => {
  const m = mime?.toLowerCase() ?? "";
  if (m.includes("png") || /\.png$/i.test(uri)) return "png";
  if (m.includes("gif") || /\.gif$/i.test(uri)) return "gif";
  if (m.includes("webp") || /\.webp$/i.test(uri)) return "webp";
  return "jpg";
};

/**
 * Abre la galería y devuelve la imagen lista para guardar: una fija se recorta cuadrada al centro y se reduce a 256 px; una
 * animada se guarda tal cual (hasta 2 MB). `firstFrameOnly` fuerza el camino de la fija (para quedarse con el primer cuadro).
 */
export async function pickDeckImage(firstFrameOnly = false): Promise<PickedImage> {
  try {
    // Sin pedir permiso: el selector de fotos del sistema (Android) no lo necesita y pedirlo sin declararlo daría un "denegado" falso.
    const res = await launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
    if (res.canceled || !res.assets[0]) return { ok: false, reason: "canceled" };
    const asset = res.assets[0];
    const ext = extFor(asset.mimeType, asset.uri);

    if (!firstFrameOnly && (ext === "gif" || ext === "webp")) {
      if ((asset.fileSize ?? 0) > MAX_ANIMATED_BYTES) {
        // Un archivo grande puede ser animado: sin leerlo entero no se sabe; se pide el primer cuadro solo si de verdad lo es.
        const head = await new File(asset.uri).bytes();
        if (detectAnimated(head, asset.mimeType)) return { ok: false, reason: "tooBig", bytes: asset.fileSize ?? head.length };
      } else {
        const file = new File(asset.uri);
        const bytes = await file.bytes();
        if (detectAnimated(bytes, asset.mimeType)) return { ok: true, base64: await file.base64(), ext, animated: true };
      }
    }

    // Fija: el cuadrado del centro, a 256 px. PNG se queda PNG (íconos con transparencia); lo demás va a JPG.
    const crop = squareCrop(asset.width, asset.height);
    const png = ext === "png";
    const rendered = await ImageManipulator.manipulate(asset.uri).crop(crop).resize({ width: STATIC_SIZE, height: STATIC_SIZE }).renderAsync();
    const out = await rendered.saveAsync({ compress: 0.85, format: png ? SaveFormat.PNG : SaveFormat.JPEG, base64: true });
    if (!out.base64) return { ok: false, reason: "failed" };
    return { ok: true, base64: out.base64, ext: png ? "png" : "jpg", animated: false };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
