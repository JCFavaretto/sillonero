# Sillonero

**Control your Windows PC from the couch.** A stream-deck-style Android app plus a small Windows agent: switch screens, set per-app volume, route audio, drive any video in the browser, fire macro decks and move the mouse, all over your local network.

[Español](README.es.md) · [Changelog](CHANGELOG.md)

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-Expo%20SDK%2058-000020?logo=expo&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Tests](https://img.shields.io/badge/tests-2560%20passing-brightgreen)
![Platform](https://img.shields.io/badge/PC-Windows-0078d4?logo=windows&logoColor=white)

## Why I built it

My PC drives a few monitors and a living-room TV. Turning the TV on, sending a window to it, switching the audio output and pausing a video meant getting up or fighting the mouse. I started with an AutoHotkey prototype, then rebuilt it properly: the phone is the app, and the PC runs a headless Node agent.

## What it does

| Tab | What you get |
|---|---|
| **Apps** | One card per open window. Each playback gets its own card with a progress bar and **per-app volume**. |
| **Decks** | Up to 32 pages of keys with images or GIFs, stored on the phone. Export/import as a single file. Keys can launch apps, run scenes, press shortcuts or **play a sound through a chosen PC output**. |
| **Screens** | An interactive map of your monitors: tap one to turn it on/off, send the active window to it, rename it or reorder them. |
| **Audio** | Volume per output and per app, default output, send an app to a specific output, now-playing with cover art. |
| **Pad** | Touchpad and keyboard for the PC. |

Also: scenes (ordered steps: screens, audio, apps, links), global `Ctrl+Alt+…` shortcuts served by the agent, start with Windows, and **generic video control for any website** (play/pause, seek, speed, fullscreen) through an optional browser extension.

## Technical highlights

- **Encrypted LAN protocol.** WebSocket secured with the Noise protocol, QR pairing, no cloud, remote off by default. Messages are validated with strict `zod` schemas on both sides and capped at 16 KB; larger payloads (sounds) travel in checked chunks.
- **Deep Windows integration.** Audio sessions and endpoints run in a long-lived PowerShell host (C# core-audio and WinRT) spoken to over JSON lines; window, mouse and keyboard control uses `koffi` against Win32.
- **Playback position without chatter.** Progress comes from SMTC timelines and the extension, and is compared with a tolerance so normal playback never floods the socket.
- **Browser extension (MV3).** Self-contained injected media controller, per-tab timeouts, serialized pushes and adaptive polling.
- **Decks data model.** Resizable grids, atomic index writes with a `.bak`, orphan-image cleanup, versioned export format with all-or-nothing import.
- **Animations on the UI thread.** Reanimated worklets, a guard test for worklet purity, and reduced-motion support everywhere.
- **Portrait and landscape** on every screen, i18n from day one (Spanish UI).
- **Private key protected with Windows DPAPI**; the signing key and config never live in the repo.

## Stack

| Layer | Tech |
|---|---|
| Phone app | React Native 0.88, Expo SDK 58, expo-router, Reanimated 4, zustand, expo-image |
| PC agent | Node 22 + TypeScript, `ws`, `koffi`, PowerShell host, tray icon |
| Browser | Chrome extension (Manifest V3) |
| Shared | `@proyecto-e/protocol`: messages, envelope, QR and network helpers (zod) |
| Quality | Vitest (agent, protocol), Jest + Testing Library (app), ESLint, strict TypeScript |

Monorepo with pnpm workspaces: `apps/agent`, `apps/mobile`, `apps/extension`, `packages/protocol`.

## Run it locally

Requirements: Windows, Node ≥ 22.19, pnpm, and an Android phone on the same Wi-Fi.

```bash
pnpm install
pnpm agent        # starts the agent (tray icon + pairing QR)
pnpm mobile       # Expo dev server; open the app on the phone and scan the QR
pnpm check        # typecheck + lint + all tests
```

Build artifacts: `pnpm build:agent` produces a portable folder for Windows; `pnpm apk` builds an installable Android APK (you provide your own signing key).

## Roadmap

- [ ] iOS (paused, personal use only)
- [ ] Make the extension's all-sites permission optional
- [ ] Rate limit on `sound.play`
- [ ] Drag a window between screens on the map
- [ ] Screenshots and a demo GIF in this README

## Honest limitations

- Windows PCs only; Android first. Tested on Windows 10.
- Per-app volume for Chrome is shared by all its windows unless the extension is connected.
- Some Windows apps don't report playback position, so they show no progress bar.
- Decks live on one phone: export them to back them up.

## Author

Designed and developed by Juan Cruz (Jay), frontend developer in Mar del Plata, Argentina.
<!-- Add LinkedIn and email here -->

© 2026 Juan Cruz. All rights reserved.
