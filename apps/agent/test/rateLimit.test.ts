import { describe, expect, it } from "vitest";
import { RATE_LIMIT } from "@proyecto-e/protocol";
import { createRateLimiter } from "../src/security/rateLimit";
import { FakeClock } from "./fakes";

function setup() {
  const clock = new FakeClock(0);
  const limiter = createRateLimiter({ clock });
  return { clock, limiter };
}

describe("rateLimit", () => {
  it("usa 5 intentos por 60 s y bloqueo de 300 s por defecto", () => {
    expect(RATE_LIMIT).toEqual({ attempts: 5, windowMs: 60_000, blockMs: 300_000 });
  });

  it("deja pasar 5 intentos y el 6.º bloquea", () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) expect(limiter.attempt("192.168.1.5").allowed).toBe(true);
    const sixth = limiter.attempt("192.168.1.5");
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBe(300_000);
    expect(limiter.isBlocked("192.168.1.5")).toBe(true);
  });

  it("los intentos viejos salen de la ventana", () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.attempt("a");
    clock.advance(60_000); // la ventana ya los dejó afuera
    expect(limiter.attempt("a").allowed).toBe(true);
    expect(limiter.isBlocked("a")).toBe(false);
  });

  it("5 intentos repartidos en más de 60 s no bloquean nunca", () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 20; i++) {
      expect(limiter.attempt("a").allowed).toBe(true);
      clock.advance(15_000); // 4 por minuto
    }
  });

  it("mientras está bloqueada rechaza todo y no extiende el bloqueo", () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 6; i++) limiter.attempt("a");
    clock.advance(100_000);
    const res = limiter.attempt("a");
    expect(res.allowed).toBe(false);
    expect(res.retryAfterMs).toBe(200_000);
    clock.advance(200_000); // se cumplen los 300 s desde el 6.º intento
    expect(limiter.isBlocked("a")).toBe(false);
    expect(limiter.attempt("a").allowed).toBe(true);
  });

  it("desbloquea a los 300 s justos y arranca con la cuenta en cero", () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 6; i++) limiter.attempt("a");
    clock.advance(299_999);
    expect(limiter.isBlocked("a")).toBe(true);
    clock.advance(1);
    expect(limiter.isBlocked("a")).toBe(false);
    for (let i = 0; i < 5; i++) expect(limiter.attempt("a").allowed).toBe(true);
    expect(limiter.attempt("a").allowed).toBe(false);
  });

  it("cada IP lleva su propia cuenta", () => {
    const { limiter } = setup();
    for (let i = 0; i < 6; i++) limiter.attempt("a");
    expect(limiter.isBlocked("a")).toBe(true);
    expect(limiter.isBlocked("b")).toBe(false);
    expect(limiter.attempt("b").allowed).toBe(true);
  });

  it("isBlocked no cuenta como intento", () => {
    const { limiter } = setup();
    for (let i = 0; i < 100; i++) limiter.isBlocked("a");
    for (let i = 0; i < 5; i++) expect(limiter.attempt("a").allowed).toBe(true);
  });

  it("limpia IPs viejas para no crecer sin límite", () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 500; i++) limiter.attempt(`10.0.${Math.floor(i / 250)}.${i % 250}`);
    expect(limiter.size()).toBe(500);
    clock.advance(RATE_LIMIT.windowMs + 1);
    limiter.attempt("nueva");
    expect(limiter.size()).toBe(1);
  });

  it("acepta límites propios (para otros usos)", () => {
    const clock = new FakeClock(0);
    const limiter = createRateLimiter({ clock, attempts: 2, windowMs: 1000, blockMs: 5000 });
    limiter.attempt("a");
    limiter.attempt("a");
    expect(limiter.attempt("a")).toEqual({ allowed: false, retryAfterMs: 5000 });
  });
});
