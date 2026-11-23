import type { PairedPc } from "@/connection/types";

/** WebSocket falso: no hace nada solo; el test lo maneja a mano. */
export class FakeSocket {
  static instances: FakeSocket[] = [];
  static reset() {
    FakeSocket.instances = [];
  }

  sent: string[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.closedWith = code;
  }

  open() {
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.onclose?.({ code });
  }
  get messages(): Array<{ v: number; id: string; type: string; payload: Record<string, unknown> }> {
    return this.sent.map((s) => JSON.parse(s));
  }
}

/** Reloj falso: `advance` dispara los timers vencidos en orden. */
export class FakeClock {
  t = 1_800_000_000_000;
  private next = 1;
  private timers = new Map<number, { fn: () => void; at: number }>();

  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.set(id, { fn, at: this.t + ms });
    return id;
  };
  clearTimeout = (id: unknown) => {
    this.timers.delete(id as number);
  };
  get pending() {
    return this.timers.size;
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.t = due[1].at;
      this.timers.delete(due[0]);
      due[1].fn();
    }
    this.t = end;
  }
}

export class MemStorage {
  pc: PairedPc | null = null;
  /** Simula que había un emparejamiento de B1 que se borró. */
  upgraded = false;
  /** Simula que SecureStore falla al guardar. */
  failSave = false;
  saves = 0;
  removes = 0;
  async load() {
    return { pc: this.pc, upgraded: this.upgraded };
  }
  async save(pc: PairedPc) {
    if (this.failSave) throw new Error("SecureStore no pudo guardar");
    this.pc = pc;
    this.saves++;
  }
  async remove() {
    this.pc = null;
    this.removes++;
  }
}
