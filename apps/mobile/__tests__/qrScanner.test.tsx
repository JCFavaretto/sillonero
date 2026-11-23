import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { QrScanner } from "@/components/QrScanner";

// Se captura la función que la cámara real llamaría al ver un código.
type ScanHandler = (r: { data: string; cornerPoints?: { x: number; y: number }[]; bounds?: unknown }) => void;
let mockOnScan: ScanHandler | null = null;
jest.mock("expo-camera", () => ({
  CameraView: (props: { onBarcodeScanned: ScanHandler }) => {
    mockOnScan = props.onBarcodeScanned;
    return null;
  },
}));

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const see = (result: Parameters<ScanHandler>[0]) => act(() => mockOnScan?.(result));
const renderIt = (ui: ReactElement) => render(ui);

beforeEach(() => {
  jest.useFakeTimers();
  mockOnScan = null;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("QrScanner", () => {
  it("antes de ver algo muestra la guía fija y ningún recuadro", async () => {
    await renderIt(<QrScanner onScan={jest.fn()} />);
    expect(screen.queryByTestId("qr-highlight")).toBeNull();
  });

  it("al ver el QR dibuja el recuadro encima, con un margen, y no entrega la lectura enseguida", async () => {
    const onScan = jest.fn();
    await renderIt(<QrScanner onScan={onScan} />);
    await see({ data: "pe1:abc", cornerPoints: square(100, 50, 120) });
    const box = screen.getByTestId("qr-highlight");
    const style = Object.assign({}, ...[box.props.style].flat());
    expect(style).toMatchObject({ left: 92, top: 42, width: 136, height: 136 });
    expect(onScan).not.toHaveBeenCalled();
  });

  it("entrega la lectura después de mostrar el recuadro (450 ms)", async () => {
    const onScan = jest.fn();
    await renderIt(<QrScanner onScan={onScan} />);
    await see({ data: "pe1:abc", cornerPoints: square(100, 50, 120) });
    await act(async () => {
      jest.advanceTimersByTime(449);
    });
    expect(onScan).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("pe1:abc");
  });

  it("las lecturas repetidas se ignoran: se entrega una sola vez", async () => {
    const onScan = jest.fn();
    await renderIt(<QrScanner onScan={onScan} />);
    for (let i = 0; i < 10; i++) await see({ data: "pe1:abc", cornerPoints: square(100, 50, 120) });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("el recuadro sigue al QR si se mueve antes de entregar", async () => {
    await renderIt(<QrScanner onScan={jest.fn()} />);
    await see({ data: "pe1:abc", cornerPoints: square(100, 50, 120) });
    await see({ data: "pe1:abc", cornerPoints: square(140, 90, 120) });
    const style = Object.assign({}, ...[screen.getByTestId("qr-highlight").props.style].flat());
    expect(style).toMatchObject({ left: 132, top: 82 });
  });

  it("si la cámara no informa dónde está el QR, entrega igual y enseguida, sin recuadro", async () => {
    const onScan = jest.fn();
    await renderIt(<QrScanner onScan={onScan} />);
    await see({ data: "pe1:abc", cornerPoints: [] });
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(onScan).toHaveBeenCalledWith("pe1:abc");
    expect(screen.queryByTestId("qr-highlight")).toBeNull();
  });

  it("usa bounds cuando no hay esquinas", async () => {
    await renderIt(<QrScanner onScan={jest.fn()} />);
    await see({ data: "x", bounds: { origin: { x: 10, y: 20 }, size: { width: 80, height: 60 } } });
    const style = Object.assign({}, ...[screen.getByTestId("qr-highlight").props.style].flat());
    expect(style).toMatchObject({ left: 2, top: 12, width: 96, height: 76 });
  });

  it("si se desmonta antes de los 450 ms no entrega nada", async () => {
    const onScan = jest.fn();
    const view = await renderIt(<QrScanner onScan={onScan} />);
    await see({ data: "pe1:abc", cornerPoints: square(100, 50, 120) });
    await view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onScan).not.toHaveBeenCalled();
  });
});
