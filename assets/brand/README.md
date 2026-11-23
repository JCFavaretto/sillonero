# Marca

Ícono de **Sillonero** (nombre elegido el 09/11/2026): un sillón visto de frente con el respaldo hecho de botones (el pad; uno brasa encendido) y una señal de ondas en la esquina superior derecha (el control remoto). La v1 tenía las ondas centradas arriba y el asiento con borde, y parecía una mochila; la v2 las pasó a la esquina y quitó el borde.
Colores: fondo `#17161D`, ámbar `#F5A524` / `#D98E14` / almohadón `#FFBE45`, brasa `#FF6B4A`, botones apagados `#1B1405`.

Fuentes (SVG, 1024×1024):
- `icon.svg`: ícono completo con fondo (`icon.png`, `favicon.png`).
- `icon-foreground.svg` + `icon-background.svg`: ícono adaptable de Android (el dibujo queda dentro de la zona segura del 66 %). El primer plano también sirve de `splash-icon.png`.
- `icon-monochrome.svg`: silueta para íconos con tema de Android.
- `icon-tray.svg`: bandeja del agente (`apps/agent/assets/tray.png`, 64×64).

Los PNG de `apps/mobile/assets/images/` y `apps/agent/assets/tray.png` salen de estos SVG (se renderizaron con Edge headless, transparente donde corresponde).
Nombre visible: **Sillonero** (cambiado el 10/11/2026 en `app.json`, textos de la app y del agente). El paquete Android (`com.jfavarettodev.proyectoe`), el `scheme` `proyectoe` y la carpeta del repo siguen con el nombre viejo a propósito, para que la APK se actualice encima y no se rompan los QR ni el cifrado guardado.
