// Dónde se guardan los decks del celu: un archivo con el índice y una carpeta con las imágenes (docs/PLAN.md D103, D105).
// Esta interfaz es lo único que toca el almacenamiento: la real usa `expo-file-system` (`fsStorage.ts`); los tests y la demo usan
// la de memoria.

export interface DecksStorage {
  /** El texto del archivo del índice; `null` si todavía no existe. */
  readIndex(): Promise<string | null>;
  writeIndex(json: string): Promise<void>;
  /** Guarda lo que no se pudo leer (un archivo roto) aparte, para no perderlo. */
  backupCorrupt(json: string): Promise<void>;
  /** Las imágenes se guardan en base64 con su nombre (`k_abc.jpg`, nunca una ruta). */
  writeImage(name: string, base64: string): Promise<void>;
  readImage(name: string): Promise<string | null>;
  /** Una dirección que `expo-image` pueda dibujar. */
  imageUri(name: string): string;
  removeImage(name: string): Promise<void>;
  listImages(): Promise<string[]>;
}

/** Almacenamiento en memoria: los tests y la demo. */
export function createMemoryStorage(initial: { index?: string; images?: Record<string, string> } = {}): DecksStorage & { files: Map<string, string>; corrupt: string[]; writes: number } {
  const files = new Map<string, string>(Object.entries(initial.images ?? {}));
  let index = initial.index ?? null;
  const self = {
    files,
    corrupt: [] as string[],
    writes: 0,
    async readIndex() {
      return index;
    },
    async writeIndex(json: string) {
      self.writes++;
      index = json;
    },
    async backupCorrupt(json: string) {
      self.corrupt.push(json);
    },
    async writeImage(name: string, base64: string) {
      files.set(name, base64);
    },
    async readImage(name: string) {
      return files.get(name) ?? null;
    },
    imageUri: (name: string) => `memory://decks/${name}`,
    async removeImage(name: string) {
      files.delete(name);
    },
    async listImages() {
      return [...files.keys()];
    },
  };
  return self;
}
