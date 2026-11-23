/**
 * ¿Se acepta este `Origin` en el upgrade del WebSocket? (docs/PLAN.md D14)
 *
 * Los navegadores siempre mandan `Origin` en un WebSocket, y una página web cualquiera abierta en la PC
 * de Jay podría abrir sockets contra el agente y gastar el rate limit hasta bloquearlo. La app del celu
 * (React Native) manda el que arma a partir de la URL: `http://<host>:<puerto>`, que acá es una IP propia.
 * Sin `Origin` pasa (no es un navegador). Comparación exacta, sin normalizar nada.
 */
export function originAllowed(
  origin: string | undefined,
  ownAddresses: readonly string[],
  port: number,
  opts: { allowLoopback?: boolean } = {},
): boolean {
  if (origin === undefined) return true;
  const hosts = opts.allowLoopback ? [...ownAddresses, "127.0.0.1"] : ownAddresses;
  return hosts.some((host) => origin === `http://${host}:${port}`);
}
