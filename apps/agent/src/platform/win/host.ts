import type { HostReply, HostRequest } from "./nativeClient";
import { createWin32 } from "./win32";

// Proceso hijo: lo lanza el agente con fork() y le habla por IPC (JSON). Todo lo que usa koffi vive acá.
// Si el padre se va (cierre, caída), el canal se corta y este proceso termina solo: no quedan huérfanos.

const win32 = createWin32();

function reply(msg: HostReply): void {
  process.send?.(msg);
}

process.on("message", (raw: unknown) => {
  const req = raw as Partial<HostRequest> | null;
  const id = typeof req?.id === "number" ? req.id : -1;
  try {
    if (req?.op === "displays.list") return reply({ id, ok: true, result: win32.listDisplays() });
    if (req?.op === "displays.setEnabled" && req.args && "devicePath" in req.args) {
      win32.setDisplayEnabled(req.args.devicePath, req.args.on, { restoreAt: req.args.restoreAt });
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "displays.arrange" && req.args && "items" in req.args) {
      win32.arrangeDisplays(req.args.items);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "windows.place" && req.args && "rect" in req.args) {
      win32.placeWindow(req.args.handle, req.args.rect, req.args.maximize);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "windows.list") return reply({ id, ok: true, result: win32.listWindows() });
    if (req?.op === "windows.focus" && req.args && "handle" in req.args) {
      win32.focusWindow(req.args.handle);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "windows.show" && req.args && "cmd" in req.args) {
      win32.showWindow(req.args.handle, req.args.cmd);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "windows.close" && req.args && "handle" in req.args) {
      win32.closeWindow(req.args.handle);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "windows.fullscreen" && req.args && "monitor" in req.args) {
      win32.toggleFullscreen(req.args.handle, req.args.monitor);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "input.mediaKey" && req.args && "vk" in req.args) {
      win32.pressMediaKey(req.args.vk);
      return reply({ id, ok: true, result: null });
    }
    if (req?.op === "windows.foreground") return reply({ id, ok: true, result: win32.foreground() });
    reply({ id, ok: false, error: `operación desconocida: ${String(req?.op)}` });
  } catch (err) {
    reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

process.on("disconnect", () => process.exit(0));
