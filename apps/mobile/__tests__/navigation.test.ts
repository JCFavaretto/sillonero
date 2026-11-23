import { TABS } from "@/navigation";

// D94 (docs/PLAN.md 8.8): Escenas · Pantallas · Apps · Audio · Pad, con Apps como pantalla inicial (la ruta "/").
describe("navegación", () => {
  it("las pestañas van en el orden nuevo, con Apps en el centro", () => {
    expect(TABS.map((t) => t.label)).toEqual(["tabs.scenes", "tabs.screens", "tabs.apps", "tabs.audio", "tabs.pad"]);
  });

  it("Apps es la ruta inicial y Escenas tiene la suya", () => {
    expect(TABS.find((t) => t.label === "tabs.apps")).toMatchObject({ name: "index", href: "/" });
    expect(TABS.find((t) => t.label === "tabs.scenes")).toMatchObject({ name: "deck", href: "/deck" });
  });

  it("no queda ninguna pestaña de Inicio", () => {
    expect(TABS.some((t) => t.label === "tabs.home")).toBe(false);
    expect(new Set(TABS.map((t) => t.href)).size).toBe(TABS.length);
  });
});
