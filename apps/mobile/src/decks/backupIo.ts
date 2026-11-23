import { File, Paths } from "expo-file-system";
import { shareAsync } from "expo-sharing";
import { MAX_ARCHIVE_CHARS } from "./archive";

// La E/S real del respaldo (D106): compartir el archivo con el menú de Android y elegir uno con el selector de archivos.
// APIs de expo-sharing y expo-file-system leídas de sus tipos (SDK 58); se verifican en el celu.

/** Escribe el archivo en la caché y abre el menú de compartir (guardarlo, mandarlo a Drive, pasarlo a otro celu). */
export async function shareText(fileName: string, text: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  await shareAsync(file.uri, { mimeType: "application/json", dialogTitle: fileName });
}

export class TooBigError extends Error {}

/** Abre el selector de archivos; `null` si se cancela. Un archivo gigante no se lee: lanza `TooBigError`. */
export async function pickText(): Promise<string | null> {
  const r = await File.pickFileAsync({ mimeTypes: ["application/json", "text/plain", "application/octet-stream"] });
  if (!r.result) return null;
  if (r.result.size > MAX_ARCHIVE_CHARS) throw new TooBigError();
  return await r.result.text();
}
