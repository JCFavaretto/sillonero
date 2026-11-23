import {
  bytesToBase64Url,
  decodeHs1Payload,
  encodeFrame,
  encodeHs2Payload,
  keyPairFromPrivate,
  openFrame,
  parseClientMessage,
  parseFrame,
  responderHandshake,
  sealToFrame,
  type ClientMessage,
  type Hs1Payload,
  type Hs2Payload,
  type Transport,
} from "@proyecto-e/protocol";
import type { FakeSocket } from "./fakes";

// La PC del lado de los tests del celu: habla Noise de verdad (responder) sobre un FakeSocket.

let counter = 7;
/** Azar determinista pero distinto en cada llamada. */
export const testRandom = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (counter++ * 23 + i * 5) % 256);

export const PC_KEYS = keyPairFromPrivate(testRandom(32));
export const PC_PUBLIC = bytesToBase64Url(PC_KEYS.publicKey);

export class AgentConn {
  private responder = responderHandshake({ s: PC_KEYS, random: testRandom });
  private transport: Transport | null = null;
  private seq = 0;
  private read = 1; // el primero que mandó el celu es el hs1
  hello!: Hs1Payload;
  remoteStatic!: Uint8Array;

  constructor(readonly sock: FakeSocket) {}

  /** Lee el hs1 que mandó el celu (el primer marco). */
  readHello(): Hs1Payload {
    const first = this.sock.sent[0];
    if (first === undefined) throw new Error("el celu todavía no mandó nada");
    const f = parseFrame(first);
    if (!f.ok || f.kind !== "hs1") throw new Error("el primer marco no es un hs1 válido");
    const r = this.responder.readHs1(f.data);
    const p = decodeHs1Payload(r.payload);
    if (!p.ok) throw new Error(`hs1 inválido: ${p.detail}`);
    this.remoteStatic = r.remoteStatic;
    this.hello = p.payload;
    return p.payload;
  }

  /** Contesta con hs2 y deja el canal cifrado listo. */
  reply(payload: Hs2Payload): void {
    const w2 = this.responder.writeHs2(encodeHs2Payload(payload));
    this.transport = w2.transport;
    this.sock.receive(encodeFrame("hs2", w2.msg));
  }

  replyOk(pcName = "DESKTOP-PSB9K0R"): void {
    this.reply({ ok: true, pcName, agentVersion: "0.1.0" });
  }

  /** Manda un mensaje de aplicación cifrado al celu. */
  send(type: string, payload: object = {}): void {
    if (!this.transport) throw new Error("falta contestar el hs2");
    this.sock.receive(sealToFrame(this.transport, JSON.stringify({ v: 1, id: `a${++this.seq}`, type, payload })));
  }

  /** Marco `data` alterado (un byte cambiado) para probar que el celu no lo acepta. */
  sendTampered(type: string, payload: object = {}): void {
    if (!this.transport) throw new Error("falta contestar el hs2");
    const frame = JSON.parse(sealToFrame(this.transport, JSON.stringify({ v: 1, id: "t", type, payload }))) as { d: string };
    frame.d = (frame.d[0] === "A" ? "B" : "A") + frame.d.slice(1);
    this.sock.receive(JSON.stringify({ v: 2, k: "data", d: frame.d }));
  }

  /** Lo que el celu mandó después del hs1, ya descifrado (cada llamada devuelve solo lo nuevo). */
  fromPhone(): ClientMessage[] {
    if (!this.transport) throw new Error("falta contestar el hs2");
    const out: ClientMessage[] = [];
    while (this.read < this.sock.sent.length) {
      const f = parseFrame(this.sock.sent[this.read++]!);
      if (!f.ok || f.kind !== "data") throw new Error("el celu mandó un marco inesperado");
      const m = parseClientMessage(openFrame(this.transport, f.data));
      if (!m.ok) throw new Error(`mensaje inválido del celu: ${m.detail}`);
      out.push(m.msg);
    }
    return out;
  }

  /** Atajo: acepta un `connect`, verifica la confirmación de la clave y manda auth.ok (y opcionalmente el estado). */
  acceptConnect(snapshot?: object): void {
    this.readHello();
    this.replyOk();
    const [first] = this.fromPhone();
    if (first?.type !== "ping") throw new Error("el celu no confirmó que tiene la clave (falta el ping después del hs2)");
    this.send("auth.ok", { pcName: "DESKTOP-PSB9K0R", agentVersion: "0.1.0" });
    if (snapshot) this.send("state.snapshot", snapshot);
  }
}

/** La PC contesta lo que haya abierto el celu en ese socket. */
export const agentFor = (sock: FakeSocket) => new AgentConn(sock);
