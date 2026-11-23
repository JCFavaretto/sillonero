/**
 * Argumentos de la línea de comandos del agente. `--background`: arranque con Windows, no abre el panel. `--smoke`: carga todo y sale
 * con 0 (sirve para comprobar que la carpeta portable arranca sin el repo).
 */
export function parseArgs(argv: readonly string[]): { background: boolean; smoke: boolean } {
  const args = argv.slice(2);
  return { background: args.includes("--background"), smoke: args.includes("--smoke") };
}
