# Bocetos

Dos épocas:

- **Archivos grandes (historia):** `v1` a `v4` reúnen todas las pantallas en un solo HTML. No se tocan ni se vuelven a abrir salvo para consultar.
- **Bocetos por pantalla (desde 07/11/2026):** un archivo por pantalla o elemento, en una carpeta por feature. Es lo vigente.

## Regla (decisión de Jay, 07/11/2026)

- Al empezar una pantalla, y antes de implementarla, se mira si **cada elemento tiene boceto**: la pantalla, y también cualquier menú, dropdown, modal, hoja inferior o estado (cargando, error, sin conexión).
- Lo que no tiene boceto se bocetea **en su propio archivo** y se ordena en la carpeta de su feature. No se agrega a un archivo existente ni se crea un "v5" gigante.
- Cada boceto muestra vertical y apaisado, como siempre.
- Los bocetos no se pisan: un cambio es un archivo nuevo con fecha (`NN-nombre-AAAA-MM-DD.html`); el reemplazado se anota abajo.
- Estilo común en `_base.css` (copiado de v4). Los agregados nuevos se suman ahí al final.
- **Cada carpeta de feature tiene un `index.html`** que muestra todos sus bocetos en orden en una sola página (decisión de Jay, 07/11/2026): los archivos siguen separados para gastar menos al bocetar, pero se revisan juntos. Al sumar un boceto, se agrega a la lista del `index.html` de su carpeta.

## Índice

| Feature | Boceto | Estado |
|---|---|---|
| Pantallas (B2) | [01 · Pantalla principal](pantallas/01-pantalla-2026-11-07.html): mapa, ventana activa, interruptores, cambiando, error, límites, sin conexión | Aprobado por Jay el 07/11/2026 |
| Pantallas (B2) | [02 · Renombrar](pantallas/02-renombrar-2026-11-07.html): hoja inferior / cuadro, sin apodo, error | Aprobado por Jay el 07/11/2026 |
| Pantallas (B2) | [04 · Ordenar](pantallas/04-ordenar-2026-11-07.html): hoja con las pantallas de izquierda a derecha y flechas ◀ ▶, estados | Hecho 07/11/2026 (pedido de Jay tras probar) |
| Conexión (B2) | [01 · Volver a emparejar](conexion/01-reemparejar-2026-11-07.html): aviso en Conectar, QR viejo, error de clave, panel de la PC | Hecho antes de R3 (aviso sobre el bloque de errores que ya existía) |
| Pantallas (B2) | [03 · Identificar](pantallas/03-identificar-2026-11-07.html): números en cada monitor de la PC (2 s) y el botón en el celu | Hecho antes de R7 |
| Diseño | [01 · Tokens antes y después](diseno/01-tokens-2026-11-07.html): paleta, letra, radios y movimiento sobre Inicio, Pantallas, menú ☰, Renombrar y Ordenar | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | **[Todos juntos (index)](apps-escenas/index.html)** | Aprobados por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [01 · Inicio](apps-escenas/01-inicio-2026-11-07.html): teclas, escena corriendo, error, vacío, sin conexión (reemplaza la sección 8 de v4) | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [02 · Editar Inicio](apps-escenas/02-editar-inicio-2026-11-07.html): quitar y mover teclas, descartar, guardando | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [03 · Agregar al Inicio](apps-escenas/03-agregar-al-inicio-2026-11-07.html): hoja con escenas, lanzadores y acciones; elegir pantalla | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [04 · Apps · Abiertas](apps-escenas/04-apps-abiertas-2026-11-07.html): ventanas en vivo, vacía, sin conexión, cargando (reemplaza la sección 10 de v4) | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [05 · Acciones de una ventana](apps-escenas/05-acciones-ventana-2026-11-07.html): hoja, en curso, error, ventana que desaparece | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [06 · Confirmar](apps-escenas/06-confirmar-cerrar-2026-11-07.html): cerrar ventana, quitar lanzador, borrar escena | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [07 · Lanzadores](apps-escenas/07-lanzadores-2026-11-07.html): grilla, abriendo, error, menú de toque largo, vacía | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [08 · Agregar lanzador](apps-escenas/08-agregar-lanzador-2026-11-07.html): buscar app de la PC, cargando, sin resultados, error, link | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [09 · Escenas](apps-escenas/09-escenas-2026-11-07.html): lista, corriendo, resultado con problemas, vacía, otra corriendo (reemplaza la sección 11 de v4) | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [10 · Editor de escena](apps-escenas/10-editor-escena-2026-11-07.html): pasos, nueva, salir sin guardar, error al guardar (reemplaza la sección 12 de v4) | Aprobado por Jay el 07/11/2026 |
| Apps y Escenas (B3) | [11 · Paso](apps-escenas/11-paso-2026-11-07.html): elegir tipo, pantallas, abrir app con zona, abrir link | Aprobado por Jay el 07/11/2026 |
| Conectar, Ajustes | Hoy solo en [v4](v4-2026-11-07.html) | Se separan cuando se toquen |
| Audio (B4) | **[Todos juntos (index)](audio/index.html)** | 01–06 aprobados por Jay el 07/11/2026; 07 pendiente |
| Audio (B4) | [01 · Audio](audio/01-audio-2026-11-07.html): ahora suena, salidas, apps, arrastrando, nada sonando, error, cargando, no disponible, sin conexión (reemplaza la sección 13 de v4) | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [02 · Acciones de una salida](audio/02-acciones-salida-2026-11-07.html): hacer predeterminada, silenciar, renombrar, ocultar, cambiando, error, mostrar ocultas | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [03 · Mandar una app a una salida](audio/03-app-a-salida-2026-11-07.html): elegir salida, seguir a la predeterminada, fijada, error, no disponible (R7, entra sí o sí) | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [04 · Inicio con teclas de audio](audio/04-inicio-teclas-audio-2026-11-07.html): Media, Vol ±, Silenciar, Salida; al tocar; error (completa la sección 8 de v4) | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [05 · Agregar al Inicio · Audio](audio/05-agregar-tecla-audio-2026-11-07.html): grupo Audio y elegir la salida | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [06 · Paso de audio en una escena](audio/06-paso-audio-2026-11-07.html): tipo Audio, configurar, sin nada que hacer, en el editor, salida que no apareció | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [07 · Elegir la app de Media y carátula](audio/07-elegir-app-media-2026-11-07.html): tarjeta con carátula, YouTube sin ⏮ ⏭, hoja para elegir la app, carátula cargando o sin carátula, a qué app van las teclas del Inicio (completa la tarjeta de 01) | Aprobado por Jay el 07/11/2026 |
| Audio (B4) | [08 · Audio en el Inicio (mezclador)](audio/08-inicio-mezclador-2026-11-08.html): tarjeta Audio arriba de las teclas con la salida, lo que suena y las apps que suenan con su volumen y su salida; plegada, nada sonando, audio caído y varias sesiones de la misma app | Aprobado por Jay el 08/11/2026 |
| Audio (B4) | [09 · Inicio con reproductor](audio/09-inicio-reproductor-2026-11-08.html): reproductor protagonista con anillo de volumen (de la salida predeterminada) alrededor de la carátula, botón ⏻ de silencio, controles debajo, mezclador por app en un desplegable, plegado recordado y teclas por defecto. **Reemplaza al 08** | Aprobado por Jay el 08/11/2026 e implementado |
| Pad (B5) | **[Todos juntos (index)](pad/index.html)** | Aprobados por Jay el 08/11/2026 (pad lo más grande posible; sin permiso aparte: 02 A–C y 06 B quedan afuera). Reemplazan la sección 14 de v4 |
| Pad (B5) | [01 · Touchpad](pad/01-touchpad-2026-11-08.html): superficie con grilla y luz bajo el dedo, destino y latencia, barra de clic partida; reposo, moviendo, clic, arrastrando, dos dedos, Wi-Fi lento | Aprobado 08/11/2026 |
| Pad (B5) | [02 · Permiso y control](pad/02-permiso-2026-11-08.html): sin permiso, tomar el control, cortado por inactividad, sin conexión, ventana de administrador; panel de la PC y bandeja | Aprobado 08/11/2026 |
| Pad (B5) | [03 · Teclado](pad/03-teclado-2026-11-08.html): escribir y mandar, modificadores enganchables, teclas al instante; mandando, enviado, combinación, error, teclado del celu cerrado | Aprobado 08/11/2026 |
| Pad (B5) | [04 · Atajos](pad/04-atajos-2026-11-08.html): grilla fija por grupos (ventanas, navegador, YouTube, editar), al tocar y error, Alt+Tab | Aprobado 08/11/2026 |
| Pad (B5) | [05 · Ajustes del pad](pad/05-ajustes-2026-11-08.html): velocidad del cursor y del scroll, scroll natural, vibrar, pantalla prendida | Aprobado 08/11/2026 |
| Pad (B5) | [06 · Cortar el control](pad/06-cortar-2026-11-08.html): un toque suelta todo ("Soltar todo"); mantener para quitar el permiso queda afuera | Aprobado 08/11/2026 |

| Atajos y arranque (B6) | **[Todos juntos (index)](atajos/index.html)** | Pendientes del OK de Jay (09/11/2026). R10 (APK) no tiene pantallas nuevas |
| Atajos y arranque (B6) | [01 · Atajo y disparador de una escena](atajos/01-escena-atajo-y-disparador-2026-11-09.html): filas nuevas en el editor, hoja de atajo (grilla, teclas ocupadas), hoja "Ejecutar solo", insignias en la lista de escenas | Hecho 09/11/2026, falta OK |
| Atajos y arranque (B6) | [02 · Panel de la PC](atajos/02-panel-pc-2026-11-09.html): tarjetas "Iniciar con Windows", "Cortar el control" y "Atajos de teclado"; ancha, angosta y estados (página de la PC, no del celu) | Hecho 09/11/2026, falta OK |
| Atajos y arranque (B6) | [03 · Bandeja](atajos/03-bandeja-2026-11-09.html): ítems "Iniciar con Windows" y "Cortar control remoto" | Hecho 09/11/2026, falta OK |
| Comodidad (fase C) | **[Todos juntos (index)](comodidad/index.html)** | Pendientes del OK de Jay (11/11/2026). Plan en `docs/PLAN.md` 8.7 |
| Comodidad (fase C) | [01 · Inicio compacto](comodidad/01-inicio-compacto-2026-11-11.html): tarjeta baja con carátula cuadrada, barra de volumen abajo y fila de botones de la app; con y sin extensión, otra app, nada sonando, silenciado, varias sonando. **Reemplaza al 09 de Audio** | Hecho 11/11/2026, falta OK |
| Comodidad (fase C) | [02 · Apps visual](comodidad/02-apps-visual-2026-11-11.html): fichas por app con íconos (pantalla, sonando, cantidad), abiertas y lanzadores en una pantalla, hoja con pantallas a un toque; vacía y sin conexión. **Reemplaza a 04 y 07 de Apps y Escenas** | Hecho 11/11/2026, falta OK |
| Comodidad (fase C) | [03 · Navegador](comodidad/03-navegador-2026-11-11.html): pestañas, marcadores, botones según el sitio, sin extensión, extensión sin responder | Hecho 11/11/2026, falta OK |
| Comodidad (fase C) | [04 · YouTube: cola y buscador](comodidad/04-youtube-cola-buscar-2026-11-11.html): cola, buscar, mis listas, errores; todo sin traer la pestaña al frente | Hecho 11/11/2026, falta OK |
| Comodidad (fase C) | [05 · Apps en tarjetas desplegables](comodidad/05-apps-tarjetas-2026-11-11.html): una tarjeta por app, acciones rápidas al desplegar, "⋯ Todo" con el menú completo. **Reemplaza al 02** (corrección de Jay) | Hecho 11/11/2026, falta OK |
| Comodidad (fase C) | [06 · Inicio: qué hace cada botón](comodidad/06-inicio-botones-2026-11-11.html): hoja de Cola, Buscar en dos pasos, barra de "Vol app", Completa, fallas. Cambia la fila de 01 A: sale "Pestañas", entra "Vol app" | Hecho 11/11/2026, falta OK |
| Rediseño (14/11/2026) | **[Plan y todos juntos (index)](rediseno/index.html)** | Pendientes del OK de Jay (14/11/2026). Plan en `docs/PLAN.md` 8.8 |
| Rediseño (F1) | [01 · Navegación y Apps](rediseno/01-navegacion-y-apps-2026-11-14.html): barra Escenas · Pantallas · Apps · Audio · Pad, Apps como inicio, tarjetas con barra de reproducción y volumen por app, variante con ⏮ ⏯ ⏭ a la vista, estados. **Reemplaza a Comodidad 01, 05 y 06** (el Inicio desaparece) | Hecho 14/11/2026, falta OK |
| Rediseño (F1) | [02 · Escenas provisoria](rediseno/02-escenas-provisoria-2026-11-14.html): teclas del Inicio, lanzadores ("Abrir") y acceso a la lista de escenas, hasta que lleguen los decks | Hecho 14/11/2026, falta OK |
| Rediseño (F2) | [03 · Reproductor web](rediseno/03-reproductor-web-2026-11-14.html): controles genéricos de video y audio con la extensión, velocidad, vivo, sin extensión, sitio protegido, extensión sin responder | Hecho 14/11/2026, falta OK |
| Rediseño (F3) | [04 · Decks](rediseno/04-decks-2026-11-14.html): hasta 32 decks con grilla propia e imágenes, estados, lista de decks. **Reemplaza al 02** cuando llegue F3 | Hecho 14/11/2026, falta OK |
| Rediseño (F3) | [05 · Editar un deck](rediseno/05-editar-deck-2026-11-14.html): modo edición, hoja de tecla, elegir acción, grilla, administrar decks, confirmar | Hecho 14/11/2026, falta OK |
| Rediseño (F3) | [06 · Imagen y respaldo](rediseno/06-imagen-y-respaldo-2026-11-14.html): imagen fija y animada, Ajustes, exportar/importar, mudanza de teclas y links al celu | Hecho 14/11/2026, falta OK |

| Rediseño (F4b) | [07 · Pantallas](rediseno/07-pantallas-2026-11-17.html): un mapa interactivo con panel de la pantalla elegida, ventana activa dibujada dentro, límites dichos en el panel; cinco estados. **Reemplaza a Pantallas 01 cuando se implemente** | Hecho 17/11/2026, aprobado 18/11/2026 e implementado |

Los bocetos del Rediseño usan `rediseno/_kit.js` y `rediseno/_neo.css` (copias de los de Comodidad con la barra nueva y las piezas de tarjeta de reproducción y de deck).

Jay vio 01 a 04 el 11/11/2026 ("me gustaron bastante") y pidió los cambios que están en 05 y 06.

Los bocetos de Comodidad usan `comodidad/_kit.js` y `comodidad/_neo.css` (en color). Los bocetos de Apps y Escenas comparten el marco del teléfono en `apps-escenas/_kit.js`; los del Pad, en `pad/_kit.js` (en color, con los tokens de `theme.ts`); los de Audio, en `audio/_kit.js` (copia del de B3 con filas de salida, de app, deslizador y "Ahora suena") (solo dibuja; el estilo sigue en `_base.css`).
