// La conexión de la extensión con el agente de la PC (docs/PLAN.md D89): un WebSocket a 127.0.0.1 con un secreto que el agente
// escribe en `config.json` de esta carpeta. El agente además exige que el origen sea esta extensión. Se reconecta solo.

const PING_MS = 20_000; // mientras hay tráfico, Chrome no duerme el service worker
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * @param {{ url: string, onOpen(send: (m: object) => void): void, onRequest(req: any): Promise<{ ok: boolean, data?: unknown, error?: string }>, WebSocketImpl?: any, setTimeoutFn?: any, setIntervalFn?: any, clearIntervalFn?: any }} opts
 */
export function createBridge(opts) {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const later = opts.setTimeoutFn ?? setTimeout;
  const every = opts.setIntervalFn ?? setInterval;
  const stopEvery = opts.clearIntervalFn ?? clearInterval;
  let ws = null;
  let attempts = 0;
  let pinger = null;
  let stopped = false;
  let connecting = false;

  const send = (m) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  };

  function reconnect() {
    if (stopped) return;
    const wait = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    attempts++;
    later(connect, wait);
  }

  function connect() {
    if (stopped || connecting || (ws && ws.readyState <= 1)) return;
    connecting = true;
    let socket;
    try {
      socket = new WS(opts.url);
    } catch {
      connecting = false;
      return reconnect();
    }
    ws = socket;
    socket.onopen = () => {
      connecting = false;
      attempts = 0;
      pinger = every(() => send({ t: "ping" }), PING_MS);
      opts.onOpen(send);
    };
    socket.onmessage = async (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg?.t !== "req" || typeof msg.id !== "number") return;
      let out;
      try {
        out = await opts.onRequest(msg);
      } catch {
        out = { ok: false, error: "failed" };
      }
      send({ t: "res", id: msg.id, ...out });
    };
    const lost = () => {
      connecting = false;
      if (pinger) stopEvery(pinger);
      pinger = null;
      if (ws === socket) ws = null;
      reconnect();
    };
    socket.onclose = lost;
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        // ya estaba cerrado
      }
    };
  }

  return {
    start: connect,
    send,
    /** Para despertar el service worker: si no está conectado, intenta ya. */
    ensure: connect,
    stop() {
      stopped = true;
      if (pinger) stopEvery(pinger);
      ws?.close();
    },
    isOpen: () => ws !== null && ws.readyState === 1,
  };
}
