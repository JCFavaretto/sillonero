import { defineConfig } from "vitest/config";

// `pnpm check` corre los tests del protocolo, el agente y el celu a la vez: con la PC cargada, los tests que arman la carpeta
// del agente o levantan un servidor pasaban de los 5 s por defecto y fallaban en falso (un test distinto cada vez).
export default defineConfig({
  test: { testTimeout: 20_000 },
});
