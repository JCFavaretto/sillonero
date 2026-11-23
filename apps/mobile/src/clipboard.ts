/** Lee el portapapeles. Nunca rechaza: si no se puede (o no hay nada), devuelve "". El módulo se carga recién al usarlo. */
export async function readClipboardText(): Promise<string> {
  try {
    const Clipboard = await import("expo-clipboard");
    return (await Clipboard.getStringAsync()) ?? "";
  } catch {
    return "";
  }
}
