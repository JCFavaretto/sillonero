import { isPrivateIPv4 } from "@proyecto-e/protocol";
import type { NetInterface } from "../ports";

export interface PickedAddress {
  address: string;
  name: string;
}

// Interfaces virtuales o de VPN: tienen IP privada pero el celu no llega por ahí.
const VIRTUAL_NAME =
  /vethernet|hyper-v|wsl|virtualbox|vmware|docker|loopback|tailscale|zerotier|tap|wintun|wireguard|openvpn|bluetooth/i;
// En esta PC la interfaz se llama "Wi-Fi 2": se compara por prefijo.
const PREFERRED_NAME = /^(wi-?fi|ethernet)/i;

// Node no expone el gateway, así que se ordena por rango: 192.168, después 10, al final 172.16/12.
function rangeRank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  return 2;
}

function compare(a: NetInterface, b: NetInterface): number {
  return (
    rangeRank(a.address) - rangeRank(b.address) ||
    Number(!PREFERRED_NAME.test(a.name)) - Number(!PREFERRED_NAME.test(b.name)) ||
    a.name.localeCompare(b.name) ||
    a.address.localeCompare(b.address)
  );
}

/** Todas las interfaces que pasan el filtro básico (IPv4, privada, no interna), de mejor a peor. Alimenta el selector del panel. */
export function listCandidates(list: NetInterface[]): PickedAddress[] {
  return list
    .filter((i) => i.family === "IPv4" && !i.internal && isPrivateIPv4(i.address))
    .sort(compare)
    .map((i) => ({ address: i.address, name: i.name }));
}

/**
 * Elige la IP que va en el QR (docs/PLAN.md 5.2). `preferred` es el nombre de
 * interfaz guardado en la config. Sin candidatas devuelve `null`.
 */
export function pickAddress(list: NetInterface[], preferred: string | null): PickedAddress | null {
  const usable = list.filter((i) => i.family === "IPv4" && !i.internal && isPrivateIPv4(i.address));

  if (preferred !== null) {
    const chosen = usable.filter((i) => i.name === preferred).sort(compare)[0];
    if (chosen) return { address: chosen.address, name: chosen.name };
  }

  const best = usable.filter((i) => !VIRTUAL_NAME.test(i.name)).sort(compare)[0];
  return best ? { address: best.address, name: best.name } : null;
}
