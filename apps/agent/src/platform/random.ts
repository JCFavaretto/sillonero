import { randomBytes, randomUUID } from "node:crypto";
import type { Random } from "../ports";

export const cryptoRandom: Random = {
  bytes: (n) => new Uint8Array(randomBytes(n)),
  uuid: () => randomUUID(),
};
