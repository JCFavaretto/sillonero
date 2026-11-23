import { describe, expect, it } from "vitest";
import { listCandidates, pickAddress } from "../src/net/pickAddress";
import type { NetInterface } from "../src/ports";

function iface(name: string, address: string, extra: Partial<NetInterface> = {}): NetInterface {
  return {
    name,
    address,
    family: address.includes(":") ? "IPv6" : "IPv4",
    internal: false,
    mac: "aa:bb:cc:dd:ee:ff",
    netmask: "255.255.255.0",
    ...extra,
  };
}

// Salida real de os.networkInterfaces() en la PC de Jay (anotada en el spike 0a).
const JAY_PC: NetInterface[] = [
  iface("Wi-Fi 2", "2803:9800:9994:69f6:bf12:a8f0:234a:c52d"),
  iface("Wi-Fi 2", "fe80::f3e:7c81:9889:4e49"),
  iface("Wi-Fi 2", "192.168.100.5"),
  iface("Loopback Pseudo-Interface 1", "::1", { internal: true }),
  iface("Loopback Pseudo-Interface 1", "127.0.0.1", { internal: true, netmask: "255.0.0.0" }),
];

describe("pickAddress", () => {
  it("en la PC de Jay elige la IP del Wi-Fi 2", () => {
    expect(pickAddress(JAY_PC, null)).toEqual({ address: "192.168.100.5", name: "Wi-Fi 2" });
  });

  it("sin candidatas devuelve null", () => {
    expect(pickAddress([], null)).toBeNull();
    expect(pickAddress(JAY_PC.filter((i) => i.name.startsWith("Loopback")), null)).toBeNull();
    expect(pickAddress([iface("Wi-Fi", "8.8.8.8"), iface("Wi-Fi", "169.254.3.4"), iface("VPN", "100.64.0.9")], null)).toBeNull();
  });

  it("descarta Hyper-V, WSL, VPN y demás interfaces virtuales aunque tengan IP privada", () => {
    const virtual = [
      iface("vEthernet (Default Switch)", "172.20.0.1"),
      iface("vEthernet (WSL (Hyper-V firewall))", "172.28.0.1"),
      iface("VirtualBox Host-Only Network", "192.168.56.1"),
      iface("VMware Network Adapter VMnet1", "192.168.75.1"),
      iface("docker0", "172.17.0.1"),
      iface("Tailscale", "10.100.0.2"),
      iface("ZeroTier One", "10.147.17.5"),
      iface("TAP-Windows Adapter V9", "10.8.0.6"),
      iface("Wintun Userspace Tunnel", "10.9.0.2"),
      iface("WireGuard", "10.7.0.2"),
      iface("OpenVPN Data Channel Offload", "10.6.0.2"),
      iface("Bluetooth Network Connection", "192.168.44.2"),
      iface("Loopback Pseudo-Interface 1", "10.0.0.1"),
    ];
    expect(pickAddress(virtual, null)).toBeNull();
    expect(pickAddress([...virtual, iface("Ethernet", "192.168.1.20")], null)).toEqual({
      address: "192.168.1.20",
      name: "Ethernet",
    });
  });

  it("el descarte por nombre no distingue mayúsculas", () => {
    expect(pickAddress([iface("VETHERNET (switch)", "172.20.0.1")], null)).toBeNull();
  });

  it("prefiere 192.168 sobre 10 y 10 sobre 172.16/12", () => {
    const list = [
      iface("Ethernet 3", "172.16.0.9"),
      iface("Ethernet 2", "10.0.0.9"),
      iface("Ethernet", "192.168.0.9"),
    ];
    expect(pickAddress(list, null)?.address).toBe("192.168.0.9");
    expect(pickAddress(list.slice(0, 2), null)?.address).toBe("10.0.0.9");
  });

  it("un 172.x de Hyper-V que se cuele queda último", () => {
    const list = [iface("Red virtual", "172.30.0.1"), iface("Wi-Fi", "10.0.0.5")];
    expect(pickAddress(list, null)?.address).toBe("10.0.0.5");
  });

  it("desempata por prefijo Wi-Fi/Ethernet y después alfabético", () => {
    const list = [
      iface("Zeta", "192.168.0.1"),
      iface("Alfa", "192.168.1.1"),
      iface("Ethernet 2", "192.168.2.1"),
      iface("Wi-Fi 3", "192.168.3.1"),
    ];
    expect(pickAddress(list, null)?.name).toBe("Ethernet 2");
    expect(pickAddress(list.filter((i) => i.name !== "Ethernet 2"), null)?.name).toBe("Wi-Fi 3");
    expect(pickAddress(list.filter((i) => i.name === "Zeta" || i.name === "Alfa"), null)?.name).toBe("Alfa");
  });

  it("respeta la interfaz preferida si pasa el filtro", () => {
    const list = [iface("Wi-Fi", "192.168.1.5"), iface("Ethernet", "10.0.0.5")];
    expect(pickAddress(list, "Ethernet")).toEqual({ address: "10.0.0.5", name: "Ethernet" });
  });

  it("la preferida puede ser una que el descarte por nombre habría sacado", () => {
    const list = [iface("Wi-Fi", "192.168.1.5"), iface("Tailscale", "10.100.0.2")];
    expect(pickAddress(list, "Tailscale")?.address).toBe("10.100.0.2");
  });

  it("si la preferida no existe o no pasa el filtro, cae a la elección automática", () => {
    const list = [iface("Wi-Fi", "192.168.1.5"), iface("Pública", "8.8.8.8")];
    expect(pickAddress(list, "Pública")?.address).toBe("192.168.1.5");
    expect(pickAddress(list, "No existe")?.address).toBe("192.168.1.5");
  });

  it("ignora IPv6 e interfaces internas", () => {
    const list = [iface("Wi-Fi", "fd00::1"), iface("Wi-Fi", "192.168.1.5", { internal: true })];
    expect(pickAddress(list, null)).toBeNull();
  });
});

describe("listCandidates", () => {
  it("lista las privadas no internas, de mejor a peor, incluidas las virtuales", () => {
    const list = [
      iface("vEthernet (Default Switch)", "172.20.0.1"),
      iface("Wi-Fi", "192.168.1.5"),
      iface("Ethernet", "10.0.0.5"),
      iface("Wi-Fi", "fe80::1"),
      iface("Pública", "8.8.8.8"),
      iface("Loopback", "127.0.0.1", { internal: true }),
    ];
    expect(listCandidates(list)).toEqual([
      { name: "Wi-Fi", address: "192.168.1.5" },
      { name: "Ethernet", address: "10.0.0.5" },
      { name: "vEthernet (Default Switch)", address: "172.20.0.1" },
    ]);
  });

  it("sin candidatas devuelve una lista vacía", () => {
    expect(listCandidates(JAY_PC.filter((i) => i.internal))).toEqual([]);
  });
});
