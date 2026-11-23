import { describe, expect, it } from "vitest";
import { PAIR_CODE_TTL_MS, PAIR_DECISION_TIMEOUT_MS } from "@proyecto-e/protocol";
import type { Device } from "../src/config/schema";
import { createPairing, type PairRequestHandle } from "../src/pairing/pairing";
import { FakeClock, FakeRandom, MemLogger } from "./fakes";

function setup(opts: { remote?: boolean } = {}) {
  const clock = new FakeClock(Date.UTC(2026, 10, 6, 12, 0, 0));
  const saved: Device[] = [];
  const log = new MemLogger();
  const state: { failSave: boolean; gate: Promise<void> | null } = { failSave: false, gate: null };
  const removed: string[] = [];
  const pairing = createPairing({
    clock,
    random: new FakeRandom(),
    log,
    remoteEnabled: opts.remote ?? true,
    saveDevice: async (d) => {
      if (state.gate) await state.gate;
      if (state.failSave) throw new Error("disk full");
      saved.push(d);
    },
    removeDevice: async (id) => void removed.push(id),
  });
  return { clock, pairing, saved, log, state, removed };
}

function pending(h: PairRequestHandle) {
  if (h.status !== "pending") throw new Error(`se esperaba pending, vino ${h.reason}`);
  return h;
}

const REQ = { deviceName: "Pixel de Jay", platform: "android" as const, publicKey: "D".repeat(43) };

describe("pairing · mostrar el código", () => {
  it("idle → showing: código de 22 caracteres que vence a los 120 s", () => {
    const { clock, pairing } = setup();
    expect(pairing.status()).toEqual({ state: "idle" });
    const shown = pairing.start();
    expect(shown?.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(shown?.expiresAt).toBe(clock.now() + PAIR_CODE_TTL_MS);
    expect(pairing.status()).toEqual({ state: "showing", code: shown?.code, expiresAt: shown?.expiresAt });
  });

  it("con el remoto apagado no muestra código", () => {
    const { pairing } = setup({ remote: false });
    expect(pairing.start()).toBeNull();
    expect(pairing.status()).toEqual({ state: "idle" });
  });

  it("showing → showing: un código nuevo reemplaza al anterior", () => {
    const { pairing } = setup();
    const first = pairing.start();
    const second = pairing.start();
    expect(second?.code).not.toBe(first?.code);
    const old = pairing.request({ code: first!.code, ...REQ });
    expect(old).toEqual({ status: "failed", reason: "invalid_code" });
    pending(pairing.request({ code: second!.code, ...REQ }));
  });

  it("showing → idle a los 120 s: el código vencido ya no sirve", () => {
    const { clock, pairing } = setup();
    const shown = pairing.start()!;
    clock.advance(PAIR_CODE_TTL_MS - 1);
    expect(pairing.status().state).toBe("showing");
    clock.advance(1);
    expect(pairing.status()).toEqual({ state: "idle" });
    expect(pairing.request({ code: shown.code, ...REQ })).toEqual({ status: "failed", reason: "invalid_code" });
  });

  it("un código vencido se rechaza aunque el timer no haya corrido todavía", () => {
    const { clock, pairing } = setup();
    const shown = pairing.start()!;
    // Salto de reloj sin disparar timers (suspensión de la PC, por ejemplo).
    const realNow = clock.now.bind(clock);
    clock.now = () => realNow() + PAIR_CODE_TTL_MS;
    expect(pairing.request({ code: shown.code, ...REQ })).toEqual({ status: "failed", reason: "invalid_code" });
  });
});

describe("pairing · pedido del celu", () => {
  it("sin código mostrado, cualquier pedido es invalid_code", () => {
    const { pairing } = setup();
    expect(pairing.request({ code: "x".repeat(22), ...REQ })).toEqual({ status: "failed", reason: "invalid_code" });
  });

  it("código incorrecto: invalid_code y el código correcto sigue valiendo", () => {
    const { pairing } = setup();
    const shown = pairing.start()!;
    expect(pairing.request({ code: "x".repeat(22), ...REQ })).toEqual({ status: "failed", reason: "invalid_code" });
    expect(pairing.status().state).toBe("showing");
    pending(pairing.request({ code: shown.code, ...REQ }));
  });

  it("código correcto: showing → awaiting y el código se consume", () => {
    const { pairing } = setup();
    const shown = pairing.start()!;
    pending(pairing.request({ code: shown.code, ...REQ }));
    const st = pairing.status();
    expect(st.state).toBe("awaiting");
    expect(st).not.toHaveProperty("code");
    expect(st).toMatchObject({ deviceName: "Pixel de Jay", platform: "android" });
  });

  it("awaiting: \"Emparejar\" no pisa el pedido que está esperando", () => {
    const { pairing } = setup();
    pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    expect(pairing.start()).toBeNull();
    expect(pairing.status().state).toBe("awaiting");
  });

  it("awaiting: otro pedido recibe busy, venga con el código que venga", () => {
    const { pairing } = setup();
    const shown = pairing.start()!;
    pending(pairing.request({ code: shown.code, ...REQ }));
    expect(pairing.request({ code: shown.code, ...REQ })).toEqual({ status: "failed", reason: "busy" });
    expect(pairing.request({ code: "x".repeat(22), ...REQ })).toEqual({ status: "failed", reason: "busy" });
    expect(pairing.status().state).toBe("awaiting");
  });
});

describe("pairing · IP del pedido", () => {
  it("el estado awaiting incluye la IP del celu cuando la sesión la informa", () => {
    const { pairing } = setup();
    pending(pairing.request({ code: pairing.start()!.code, ...REQ, ip: "192.168.1.9" }));
    expect(pairing.status()).toMatchObject({ state: "awaiting", ip: "192.168.1.9" });
  });
});

describe("pairing · decisión en la PC", () => {
  it("Permitir: crea el dispositivo con la clave pública del celu y no hay ningún token", async () => {
    const { clock, pairing, saved } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    const device = await pairing.allow();
    expect(device).toMatchObject({ name: "Pixel de Jay", platform: "android", publicKey: REQ.publicKey });

    const outcome = await h.outcome;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(outcome).sort()).toEqual(["deviceId", "ok"]);

    expect(saved).toHaveLength(1);
    const d = saved[0]!;
    expect(d.id).toBe(outcome.deviceId);
    expect(Object.keys(d)).not.toContain("tokenHash");
    expect(d.pairedAt).toBe(new Date(clock.now()).toISOString());
    expect(d.lastSeenAt).toBeNull();
    expect(pairing.status()).toEqual({ state: "idle" });
  });

  it("el deviceId lo asigna el agente, no el celu", async () => {
    const { pairing } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    await pairing.allow();
    const outcome = await h.outcome;
    expect(outcome.ok && outcome.deviceId).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("Rechazar: rejected, sin token, sin guardar nada, y el código quedó consumido", async () => {
    const { pairing, saved } = setup();
    const shown = pairing.start()!;
    const h = pending(pairing.request({ code: shown.code, ...REQ }));
    expect(pairing.reject()).toBe(true);
    expect(await h.outcome).toEqual({ ok: false, reason: "rejected" });
    expect(saved).toHaveLength(0);
    expect(pairing.status()).toEqual({ state: "idle" });
    expect(pairing.request({ code: shown.code, ...REQ })).toEqual({ status: "failed", reason: "invalid_code" });
  });

  it("60 s sin decisión: timeout y vuelve a idle", async () => {
    const { clock, pairing } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    clock.advance(PAIR_DECISION_TIMEOUT_MS - 1);
    expect(pairing.status().state).toBe("awaiting");
    clock.advance(1);
    expect(await h.outcome).toEqual({ ok: false, reason: "timeout" });
    expect(pairing.status()).toEqual({ state: "idle" });
  });

  it("Permitir o Rechazar sin pedido pendiente no hacen nada", async () => {
    const { pairing, saved } = setup();
    expect(await pairing.allow()).toBeNull();
    expect(pairing.reject()).toBe(false);
    pairing.start();
    expect(await pairing.allow()).toBeNull();
    expect(pairing.reject()).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it("dos Permitir seguidos crean un solo dispositivo", async () => {
    const { pairing, saved } = setup();
    pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    const [a, b] = await Promise.all([pairing.allow(), pairing.allow()]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it("si no se puede guardar, Permitir falla, el pedido sigue vivo y se puede reintentar", async () => {
    const { pairing, saved, state } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    state.failSave = true;
    await expect(pairing.allow()).rejects.toThrow("disk full");
    expect(pairing.status().state).toBe("awaiting");
    state.failSave = false;
    expect(await pairing.allow()).not.toBeNull();
    expect((await h.outcome).ok).toBe(true);
    expect(saved).toHaveLength(1);
  });
});

describe("pairing · el celu se va mientras se guarda", () => {
  it("si se cancela durante saveDevice, se deshace el dispositivo y allow() devuelve null", async () => {
    const { pairing, saved, removed, state } = setup();
    let release!: () => void;
    state.gate = new Promise<void>((r) => (release = r));
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    const allowing = pairing.allow();
    h.cancel(); // el celu se desconectó en medio
    release();
    expect(await allowing).toBeNull();
    expect(await h.outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(saved).toHaveLength(1);
    expect(removed).toEqual([saved[0]?.id]);
  });

  it("si todo sale bien no se deshace nada", async () => {
    const { pairing, removed } = setup();
    pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    expect(await pairing.allow()).not.toBeNull();
    expect(removed).toEqual([]);
  });
});

describe("pairing · cancelaciones", () => {
  it("el celu se desconecta: se descarta el pedido", async () => {
    const { pairing, saved } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    h.cancel();
    expect(await h.outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(pairing.status()).toEqual({ state: "idle" });
    expect(await pairing.allow()).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it("cancelar un pedido viejo no toca al pedido nuevo", async () => {
    const { pairing } = setup();
    const first = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    pairing.reject();
    await first.outcome;
    const second = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    first.cancel(); // llega tarde
    expect(pairing.status().state).toBe("awaiting");
    second.cancel();
  });

  it("remoto off en showing: idle y el código queda invalidado", () => {
    const { pairing } = setup();
    const shown = pairing.start()!;
    pairing.setRemoteEnabled(false);
    expect(pairing.status()).toEqual({ state: "idle" });
    pairing.setRemoteEnabled(true);
    expect(pairing.request({ code: shown.code, ...REQ })).toEqual({ status: "failed", reason: "invalid_code" });
  });

  it("remoto off en awaiting: descarta el pedido", async () => {
    const { pairing } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    pairing.setRemoteEnabled(false);
    expect(await h.outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(pairing.status()).toEqual({ state: "idle" });
  });

  it("no deja timers colgados al terminar", async () => {
    const { clock, pairing } = setup();
    const h = pending(pairing.request({ code: pairing.start()!.code, ...REQ }));
    expect(clock.pendingTimers()).toBe(1); // solo el de la decisión
    await pairing.allow();
    await h.outcome;
    expect(clock.pendingTimers()).toBe(0);
  });
});

describe("pairing · log", () => {
  it("registra los hechos sin token ni código", async () => {
    const { pairing, log } = setup();
    const shown = pairing.start()!;
    pending(pairing.request({ code: shown.code, ...REQ }));
    await pairing.allow();
    const text = JSON.stringify(log.entries);
    expect(log.entries.length).toBeGreaterThan(0);
    expect(text).not.toContain(shown.code);
  });
});
