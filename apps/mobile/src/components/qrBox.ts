export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScanGeometry {
  cornerPoints?: { x: number; y: number }[];
  bounds?: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const finite = (...ns: number[]) => ns.every(Number.isFinite);

/**
 * Rectángulo donde `expo-camera` vio el QR, en coordenadas de la vista de la cámara.
 * Usa las esquinas (su orden cambia entre Android e iOS, por eso se toma el mínimo y el máximo)
 * y, si no hay, `bounds`. Devuelve `null` si no hay nada usable: la doc avisa que pueden venir vacíos.
 */
export function boxFromScan(scan: ScanGeometry, margin = 0): Box | null {
  let box: Box | null = null;

  const points = scan.cornerPoints ?? [];
  if (points.length > 0 && points.every((p) => finite(p.x, p.y))) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    box = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  } else if (scan.bounds) {
    const { origin, size } = scan.bounds;
    if (finite(origin.x, origin.y, size.width, size.height)) {
      box = { x: origin.x, y: origin.y, width: size.width, height: size.height };
    }
  }

  if (!box || box.width <= 0 || box.height <= 0) return null;
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  };
}
