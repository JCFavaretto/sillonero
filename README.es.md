# Sillonero

**Controlá tu PC con Windows desde el sillón.** Una app Android estilo stream deck más un agente chico para Windows: cambiás pantallas, bajás el volumen de una app, elegís la salida de audio, manejás cualquier video del navegador, disparás decks de teclas y movés el mouse, todo por tu red local.

[English](README.md) · [Changelog](CHANGELOG.md)

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-Expo%20SDK%2058-000020?logo=expo&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Tests](https://img.shields.io/badge/tests-2560%20passing-brightgreen)
![Platform](https://img.shields.io/badge/PC-Windows-0078d4?logo=windows&logoColor=white)

## Por qué lo hice

Mi PC maneja varios monitores y la tele del living. Prender la tele, mandarle una ventana, cambiar la salida de audio y pausar un video implicaba levantarme o pelearme con el mouse. Empecé con un prototipo en AutoHotkey y lo rehice bien: el celu es la app y la PC corre un agente Node sin interfaz.

## Qué hace

| Pestaña | Qué tenés |
|---|---|
| **Apps** | Una tarjeta por ventana abierta. Cada reproducción tiene su tarjeta con barra de progreso y **volumen por app**. |
| **Decks** | Hasta 32 páginas de teclas con imágenes o GIF, guardadas en el celu. Exportar/importar en un solo archivo. Las teclas abren apps, corren escenas, mandan atajos o **reproducen un sonido por la salida de la PC que elijas**. |
| **Pantallas** | Un mapa interactivo de tus monitores: tocás uno para prenderlo/apagarlo, mandarle la ventana activa, ponerle apodo o reordenarlos. |
| **Audio** | Volumen por salida y por app, salida predeterminada, mandar una app a otra salida, "qué suena" con carátula. |
| **Pad** | Touchpad y teclado para la PC. |

Además: escenas (pasos en orden: pantallas, audio, apps, links), atajos globales `Ctrl+Alt+…` que sirve el agente, arranque con Windows y **control de video para cualquier sitio** (play/pausa, saltar, velocidad, pantalla completa) con una extensión opcional del navegador.

## Puntos técnicos

- **Protocolo cifrado en LAN.** WebSocket protegido con el protocolo Noise, emparejamiento por QR, sin nube y con el remoto apagado por defecto. Los mensajes se validan con esquemas `zod` estrictos de los dos lados y tienen tope de 16 KB; lo más grande (sonidos) viaja en pedazos verificados.
- **Integración profunda con Windows.** Las sesiones y salidas de audio corren en un host PowerShell de vida larga (C# con core audio y WinRT) al que se le habla con líneas JSON; ventanas, mouse y teclado usan `koffi` contra Win32.
- **Posición de reproducción sin ruido.** El progreso sale de las líneas de tiempo de SMTC y de la extensión, y se compara con tolerancia para que la reproducción normal no inunde el socket.
- **Extensión de navegador (MV3).** Controlador de medios inyectado y autocontenido, tiempos de espera por pestaña, envíos serializados y sondeo adaptable.
- **Modelo de los decks.** Grillas redimensionables, escritura atómica del índice con `.bak`, limpieza de imágenes huérfanas, formato de exportación versionado e importación todo o nada.
- **Animaciones en el hilo de UI.** Worklets de Reanimated, un test de guardia para que sean puros y soporte de "reducir movimiento" en todo.
- **Vertical y apaisado** en cada pantalla, i18n desde el día uno.
- **Clave privada protegida con DPAPI de Windows**; la clave de firma y la config nunca viven en el repo.

## Stack

| Capa | Tecnología |
|---|---|
| App del celu | React Native 0.88, Expo SDK 58, expo-router, Reanimated 4, zustand, expo-image |
| Agente en la PC | Node 22 + TypeScript, `ws`, `koffi`, host PowerShell, ícono de bandeja |
| Navegador | Extensión de Chrome (Manifest V3) |
| Compartido | `@proyecto-e/protocol`: mensajes, sobre, QR y red (zod) |
| Calidad | Vitest (agente, protocolo), Jest + Testing Library (app), ESLint, TypeScript estricto |

Monorepo con workspaces de pnpm: `apps/agent`, `apps/mobile`, `apps/extension`, `packages/protocol`.

## Correrlo local

Requisitos: Windows, Node ≥ 22.19, pnpm y un celu Android en el mismo Wi-Fi.

```bash
pnpm install
pnpm agent        # arranca el agente (ícono de bandeja + QR de emparejamiento)
pnpm mobile       # servidor de Expo; abrí la app en el celu y escaneá el QR
pnpm check        # tipos + lint + todos los tests
```

Para armar: `pnpm build:agent` genera una carpeta portable para Windows; `pnpm apk` arma una APK instalable de Android (con tu propia clave de firma).

## Roadmap

- [ ] iOS (en pausa, solo uso propio)
- [ ] Que el permiso de todos los sitios de la extensión sea opcional
- [ ] Límite de frecuencia en `sound.play`
- [ ] Arrastrar una ventana entre pantallas en el mapa
- [ ] Capturas y un GIF de demo en este README

## Limitaciones, sin maquillaje

- Solo PCs con Windows; Android primero. Probado en Windows 10.
- El volumen de Chrome es uno solo para todas sus ventanas salvo que la extensión esté conectada.
- Algunas apps de Windows no informan por dónde va la reproducción, así que no muestran barra.
- Los decks viven en un solo celu: exportalos para tener una copia.

## Autor

Diseñado y desarrollado por Juan Cruz (Jay), desarrollador frontend en Mar del Plata, Argentina.
<!-- Agregar LinkedIn y mail acá -->

© 2026 Juan Cruz. Todos los derechos reservados.
