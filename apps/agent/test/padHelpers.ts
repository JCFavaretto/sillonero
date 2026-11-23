import type { PadState } from "@proyecto-e/protocol";
import { createPadService } from "../src/input/service";
import { FakeClock, FakeInput, MemLogger } from "./fakes";

export function setup(opts: { enabled?: boolean } = {}) {
  const clock = new FakeClock(0);
  const input = new FakeInput();
  const log = new MemLogger();
  let enabled = opts.enabled ?? true;
  const states: PadState[] = [];
  const pad = createPadService({
    input,
    clock,
    log,
    config: { enabled: () => enabled, setEnabled: async (v) => void (enabled = v) },
  });
  pad.subscribe((s) => states.push(s));
  return { pad, input, clock, log, states, setEnabled: (v: boolean) => (enabled = v) };
}
