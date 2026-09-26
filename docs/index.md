---
layout: default
title: Home
---

![Logo](assets/logo.svg)

# OrbitPS2 Manager

A modern, cross-platform way to manage your PlayStation OPL game collection.

<span class="badge-row">
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-GPLv3-green)
[![Releases](https://img.shields.io/github/v/release/Luden02/OrbitPS2-Manager)](https://github.com/Luden02/OrbitPS2-Manager/releases)
[![AUR](https://img.shields.io/aur/version/orbitopl-toolbox-bin)](https://aur.archlinux.org/packages/orbitopl-toolbox-bin)
</span>

## About

OrbitPS2 Manager is an open-source, cross-platform desktop application for organizing your PlayStation 2 (and PlayStation 1) game library for use with [Open PS2 Loader (OPL)](https://github.com/ps2homebrew/Open-PS2-Loader).

It was created to fill the gap left by OPLManager, which lacks macOS and Linux support. The goal isn't to replace OPLManager, but to offer an alternative — one that's modern, intuitive, and built with technologies familiar to JavaScript developers.

> Built with Electron + Angular, styled with Tailwind CSS & daisyUI. Cross-platform: **Windows, macOS, and Linux**.

<img width="100%" alt="OrbitPS2 Manager — library view" src="https://github.com/user-attachments/assets/38534dc9-83c1-40ba-9a24-f2e64f5106d0" />

## Features

### 🎮 Multi-system library

- Manage **PS2** (DVD & CD), **PS1**, and **APPS** (homebrew) all in one place
- System tabs with live counts, plus a **search** box, **sort** (by title or game ID), and **grid / list** view modes
- Click any game for a rich **details view** — cover, screenshots, region, format, size, and metadata
- At-a-glance **library stats**: total games mounted and per-system counts
- Recognizes **UL** (split / fragmented) games

### 📥 Importing

- **PS2 DVD** — import `ISO` / `ZSO` images
- **PS2 CD** — convert `CUE`/`BIN` (including multi-track) to a single `ISO`
- **PS1** — convert `CUE`/`BIN`/`ZIP` to `VCD`, with a choice of launcher style (POPStarter or RiptOPL/POPSLoader)
- **APPS** — import homebrew `ELF` executables with a custom title
- **Automatic game-ID detection** by scanning the disc image
- **Queued batch imports** with live progress for long operations

<img width="100%" alt="OrbitPS2 Manager — import view" src="https://github.com/user-attachments/assets/e9aac4f1-821e-40fe-b37f-8a66074b1434" />

### 🖼️ Artwork

- Download cover, icon, and screenshot art (`COV` / `ICO` / `SCR`) for **PS1 & PS2**
- Fetch art for a **single game** or for your **entire library** in one click
- Sourced from the [PSX / PS2 OPL Art Database](https://github.com/Luden02/psx-ps2-opl-art-database)

### 🗜️ Compression & conversion

- Compress PS2 `ISO` → `ZSO` (LZ4) to save disk space — single game or **bulk** the whole library
- Decompress a `ZSO` back to `ISO` for a single game
- Convert a PS1 `VCD` back to `BIN`/`CUE` for a single game
- Optionally delete the original file after compression/decompression

### ⚙️ Per-game configuration

- Edit OPL per-game settings (`CFG/<GAMEID>.cfg`) directly from the UI
- Set the **display title**, toggle **compatibility modes**, and assign **VMC** slots
- Unknown / OPL-written keys are preserved

### 💾 Virtual Memory Cards (VMC)

- Create, list, and delete OPL-compatible virtual memory cards (8 / 16 / 32 / 64 MB)

### 🧹 File maintenance

- **Invalid-file detection** for malformed or wrongly-named files
- **Bulk auto-correction** — discover game IDs and rename in one pass, with optional artwork download
- **Rename to convention** — switch between the legacy (`GAMEID.Title.iso`) and new OPL naming styles
- **PS1 launcher style conversion** — switch existing PS1 games between **POPStarter** and **RiptOPL/POPSLoader** layouts, per game or **library-wide**
- **Safe delete** — removes the game image, its artwork, and any paired PS1 launcher

### 🛠️ Quality of life

- **Theme picker** — OrbitPS2 Dark, Light, follow-system, or the original Legacy look
- **Auto-reconnect** to your last library on launch
- Real-time **logs** viewer with verbose mode
- Built-in **update check**
- Window-close guard while an import is in progress

## Next steps

- [**Installation**](installation.md) — grab a build for Windows, macOS, or Linux
- [**How-To Guide**](guide.md) — mounting a library, importing games, artwork, VMCs, and more
- [**Folder Layout**](folder-layout.md) — the OPL directory structure OrbitPS2 Manager reads and writes
- [**Contributing**](contributing.md) — dev setup, running from source, and the PR process

## License

This project is licensed under the [GNU General Public License v3.0](https://github.com/Luden02/OrbitPS2-Manager/blob/main/LICENSE).
