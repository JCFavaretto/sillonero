import { networkInterfaces } from "node:os";
import type { NetInfo, NetInterface } from "../ports";

type Source = () => NodeJS.Dict<
  { address: string; netmask: string; family: string | number; mac: string; internal: boolean }[]
>;

/** Aplana `os.networkInterfaces()` en una lista con el nombre de cada interfaz. */
export function createNetInfo(source: Source = networkInterfaces): NetInfo {
  return {
    list() {
      const out: NetInterface[] = [];
      for (const [name, infos] of Object.entries(source())) {
        for (const i of infos ?? []) {
          if (i.family !== "IPv4" && i.family !== "IPv6") continue;
          out.push({
            name,
            address: i.address,
            family: i.family,
            internal: i.internal,
            mac: i.mac,
            netmask: i.netmask,
          });
        }
      }
      return out;
    },
  };
}
