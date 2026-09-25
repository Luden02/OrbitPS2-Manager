![Logo](angular/public/logo.svg)

**OrbitPS2 Manager** — a modern, cross-platform way to manage your PlayStation OPL game collection.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-GPLv3-green)
[![Releases](https://img.shields.io/github/v/release/Luden02/OrbitPS2-Manager)](https://github.com/Luden02/OrbitPS2-Manager/releases)
[![AUR](https://img.shields.io/aur/version/orbitopl-toolbox-bin)](https://aur.archlinux.org/packages/orbitopl-toolbox-bin)

# 📖 About

OrbitPS2 Manager is an open-source, cross-platform desktop application for organizing your PlayStation 2 (and PlayStation 1) game library for use with [Open PS2 Loader (OPL)](https://github.com/ps2homebrew/Open-PS2-Loader).

It was created to fill the gap left by OPLManager, which lacks macOS and Linux support.
The goal isn't to replace OPLManager, but to offer an alternative — one that's modern, intuitive, and built with technologies familiar to JavaScript developers.

> Built with Electron + Angular, styled with Tailwind CSS & daisyUI. Cross-platform: **Windows, macOS, and Linux**.

<img width="1414" height="833" alt="image" src="https://github.com/user-attachments/assets/735f1984-28fb-40cd-abc2-41ef74ec187c" />

# ✨ Features

### 🎮 Multi-system library

- Manage **PS2** (DVD & CD), **PS1**, and **APPS** (homebrew) all in one place
- System tabs with live counts, plus a **search** box, **sort** (by title or game ID), and **grid / list** view modes
- Click any game for a rich **details view** — cover, screenshots, region, format, size, and metadata
- At-a-glance **library stats**: total games mounted and per-system counts
- Recognizes **UL** (split / fragmented) games

### 📥 Importing

- **PS2 DVD** — import `ISO` / `ZSO` images
- **PS2 CD** — convert `CUE`/`BIN` (including multi-track) to a single `ISO`
- **PS1** — convert `CUE`/`BIN`/`ZIP` to `VCD`, with a choice of launcher style:
  - **POPStarter** (default) — auto-generates a POPStarter launcher under `APPS/`
  - **RiptOPL / POPSLoader** — drops the VCD straight into `POPS/`/`VCD/` with no separate launcher
- **APPS** — import homebrew `ELF` executables with a custom title
- **Automatic game-ID detection** by scanning the disc image (no need to look it up manually)
- **Queued batch imports** with live progress for long operations

<img width="1408" height="828" alt="Screenshot 2026-08-28 at 18 12 26" src="https://github.com/user-attachments/assets/1a118330-8e05-4783-acd4-2e6d86edebe0" />

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

# 💻 Installation

Grab the latest build from the [Releases](https://github.com/Luden02/OrbitPS2-Manager/releases) page.

On Arch Linux you can also use the [AUR binary](https://aur.archlinux.org/packages/orbitopl-toolbox-bin) or [AUR git](https://aur.archlinux.org/packages/orbitopl-toolbox-git) packages (thanks to u/m0tic).

### 🪟 Windows

1. Download the **`.exe`** installer (or the portable **`.zip`** if you'd rather not install).
2. Run it — the installer walks you through setup; the `.zip` just needs extracting, then run `OrbitPS2Manager.exe`.
3. If **SmartScreen** appears, click **"More info" → "Run anyway"** (the app is unsigned but 100% safe).

### 🍏 macOS

1. Download the `.dmg` for your architecture:
   - **arm64** (Apple Silicon — _recommended and tested_)
   - **x64** (Intel Macs)
2. Open the `.dmg` and drag **OrbitPS2Manager** to your **Applications** folder.
3. Because the app is **unsigned** (but **100% safe**), macOS quarantines it. Remove the quarantine flag by running this in your **terminal**:
   ```bash
   xattr -dr com.apple.quarantine /Applications/OrbitPS2Manager.app
   ```
4. **Run** the app.

### 🐧 Linux

1. Download the **`.AppImage`**, **`.deb`**, or **`.zip`** (whichever suits your distro).
2. For the **AppImage**: make it executable and run it. For the **`.deb`**: install it with your package manager. For the **`.zip`**: extract and run the `OrbitPS2Manager` binary.

# 🚀 How-To Guide

## 1. Mount your library

On first launch you'll be asked to **mount a directory** — this is your OPL root: an internal folder or an external / USB drive that OPL reads from.

- Click **Mount Directory** and pick the folder.
- If it isn't already an OPL layout, the app offers to create the required folders (`CD`, `DVD`, `VCD`, `POPS`, `APPS`, `ART`, `CFG`, `VMC`) for you.
- Enable **Reconnect on launch** in Settings and the app will re-mount this drive automatically next time it starts.

> Everything else in the app operates on the currently mounted directory. Switch drives anytime by mounting a different folder.

## 2. Browse the library

The **Library** page is your home base.

- **System tabs** (PlayStation 2 / PlayStation 1 / Apps) filter the view; each shows a live count.
- Use the **search** box, the **sort** dropdown (Name or Game ID, A–Z / Z–A), and the **grid / list** toggle to find things fast.
- **Click a game** to open its **details view** — cover art, screenshots, region, format, size, and any available metadata.
- Each game's **⋮ menu** exposes per-game actions: *Fetch artwork*, *Game settings*, *Convert to ZSO / Convert to ISO* (PS2), *Convert to BIN/CUE* (PS1), *Convert launcher* (PS1, POPStarter ⟷ RiptOPL/POPSLoader), *Rename*, and *Delete*.
- The **⋮ menu in the top-right** runs library-wide actions (see below).

## 3. Import games

Go to the **Import** page and follow the three steps:

1. **Pick the disc type:**
   | Type | Accepts | What happens |
   |------|---------|--------------|
   | **PS2 DVD** | `.iso` / `.zso` | Copied into `DVD/` |
   | **PS2 CD** | `.bin` / `.cue` | Converted to a single `.iso` in `CD/` |
   | **PS1 / POPS** | `.cue` / `.zip` | Converted to `.vcd`, plus a launcher (see below) |
   | **App / Homebrew** | `.elf` | Copied into its own `APPS/` folder with a `title.cfg` launcher |

2. **Set options:**
   - **Download artwork after import** — grabs cover/icon/screenshot automatically.
   - *(PS2 DVD)* **Use new OPL naming** — saves as `<Title>.iso` instead of `SLES_123.45.<Title>.iso`; OPL reads the game ID from the disc's `SYSTEM.CNF`.
   - *(PS1)* **Launcher style**:
     - **POPStarter** (default) — auto-generates a POPStarter launcher in `APPS/`; the game shows up under the **Apps** tab.
     - **RiptOPL / POPSLoader** — puts the `.vcd` straight into `POPS/`/`VCD/` with no separate launcher; the game shows up under the **PS1** tab.
   - *(PS1, POPStarter style only)* **POPStarter prefix** — `XX.` for USB / MX4SIO, or `SB.` for an SMB network share.

3. **Select files & review** — add one or many files. The app auto-detects the game ID and name by reading each disc; if something can't be resolved it's flagged so you can fill it in manually. Click **Import** and watch the queued progress.

## 4. Download artwork

- **One game:** use the game's **⋮ → Fetch artwork**.
- **Whole library:** use the top-right **⋮ → Download artwork for all games**.

Art comes from the [PSX / PS2 OPL Art Database](https://github.com/Luden02/psx-ps2-opl-art-database) and lands in the `ART/` folder as `GAMEID_COV / _ICO / _SCR`.

## 5. Compress / convert disc images

ZSO is an LZ4-compressed disc image that saves space while staying OPL-compatible.

- **One game:** **⋮ → Convert to ZSO**.
- **Whole library:** top-right **⋮ → Convert all PS2 ISOs to ZSO**.

You can choose to delete the original `.iso` after a successful conversion.

Need to go the other way? Per-game actions let you undo a conversion:

- **⋮ → Convert to ISO** — decompresses a PS2 `.zso` back to a plain `.iso`.
- **⋮ → Convert to BIN/CUE** — converts a PS1 `.vcd` back to `.bin`/`.cue`.

These "convert back" actions are per-game only — there's no library-wide bulk version.

## 6. Configure a game

Open **⋮ → Game settings** on any PS2 game (or a PS1 launcher) to edit its OPL `.cfg`:

- **Display title** — the name OPL shows instead of the filename.
- **Compatibility modes** — toggle OPL's per-game compatibility flags.
- **VMC slots** — assign a virtual memory card to Slot 1 / Slot 2.

Any other keys already in the file (DMA settings, etc.) are preserved untouched.

## 7. Virtual Memory Cards

On the **Memory Cards** page you can **create** a blank VMC (8 / 16 / 32 / 64 MB), see all existing cards, and **delete** ones you no longer need. New cards are formatted by OPL on first use. Assign them to games from each game's settings dialog.

## 8. Fix invalid / mislabeled files

The **Invalid Files** page lists images OPL wouldn't recognise (usually a non-standard filename).

- **Rename Tool** (per file) — enter the game ID and title manually, optionally fetching artwork.
- **Bulk Auto-Correction** — reads every invalid disc image (ISO directly, ZSO on the fly) to discover its game ID, then renames everything into the convention you choose (**new** `<Title>.iso` or **old** `<GAMEID>.<Title>.iso`), optionally fetching artwork as it goes.

## 9. Rename to a naming convention

Switch a single game (**⋮ → Rename to convention**) or your whole library (top-right **⋮ → Rename all games to convention**) between:

- **New** — `<Title>.iso` (OPL reads the ID from the disc)
- **Old** — `<GAMEID>.<Title>.iso` (maximally compatible with older OPL builds)

## 10. Switch a PS1 game's launcher style

If you change your mind after importing, you can convert existing PS1 games between launcher styles:

- **One game:** **⋮ → Convert launcher** (on a PS1 entry or its POPStarter launcher).
- **Whole library:** top-right **⋮** — **Convert All PS1 games to RiptOPL/POPSLoader** (from the **Apps** tab) or **Convert All PS1 games to OPL/Popstarter** (from the **PS1** tab).

## 11. Settings, appearance, logs & updates

- **Settings → Appearance** — pick a **Theme**: OrbitPS2 Dark, OrbitPS2 Light, OrbitPS2 (follows your system), or the original Legacy look.
- **Settings → Library** — toggle *Reconnect on launch* and see your last mounted directory.
- **Settings → Logging** — enable *Verbose logging*.
- **Logs** — a real-time, in-app log viewer; turn on verbose mode when reporting an issue.
- **Updates** — Settings → *Check for updates* compares your version against the latest GitHub release.

# 📁 OPL folder layout

OrbitPS2 Manager reads and writes the standard OPL directory structure:

```
OPL_ROOT/
├── CD/     — PS2 CD-format games (.iso / .zso)
├── DVD/    — PS2 DVD-format games (.iso / .zso)
├── VCD/    — PS1 games (.vcd) — RiptOPL/POPSLoader-style, launcher-free
├── POPS/   — PS1 discs (.vcd) and POPStarter launchers (.elf) + POPS VMCs
├── APPS/   — Homebrew apps (one folder each, with title.cfg)
├── ART/    — Artwork (GAMEID_COV.png, GAMEID_ICO.png, GAMEID_SCR.png)
├── CFG/    — Per-game OPL settings (GAMEID.cfg)
└── VMC/    — Virtual memory cards (.bin)
```

Game IDs follow the PS2 format `XXXX_###.##` (e.g. `SLUS_123.45`); the region is derived from the prefix.

# 📜 License

This project is licensed under the GNU General Public License v3.0 — see the [LICENSE](LICENSE) file for details.

# 🤝 Contributing

Contributions are welcome! Here's how you can help improve OrbitPS2 Manager:

## Ways to Contribute

- **Bug Reports** — found an issue? Open a bug report with detailed steps to reproduce.
- **Feature Requests** — have an idea for improvement? Submit a feature request.
- **Code Contributions** — submit pull requests for bug fixes or new features.
- **Testing** — test new releases and provide feedback.

## 🧰 Development Setup

After cloning the repo, get a working dev environment in one command.

### ⚡ Automated (recommended)

A setup script detects your OS, installs the required tooling (Node.js, Git, and `binutils` for Linux `.deb` packaging), and installs the npm dependencies for **both** the Electron root project and the Angular renderer.

**macOS / Linux**

```bash
./scripts/setup.sh
```

**Windows** (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

If you already have Node.js installed, you can also just run:

```bash
npm run setup
```

> The script uses your platform's package manager — **Homebrew** on macOS; **apt / dnf / pacman / zypper** on Linux; **winget** (or **Chocolatey**) on Windows. Install the package manager first if you don't have one.

### 🔧 Manual

Prefer to do it yourself? Install these prerequisites, then install dependencies in both projects:

1. **Node.js 20.19+** (22 LTS or 24 recommended) and **npm** — https://nodejs.org
2. **Git** — https://git-scm.com
3. _(Linux packaging only)_ **binutils** for the GNU `ar` tool, required to build the `.deb`.
   - macOS: `brew install binutils`
   - Debian/Ubuntu: `sudo apt-get install binutils`
4. Install dependencies for both the root and Angular projects:

   ```bash
   npm install                          # Electron main process (repo root)
   cd angular && npm install && cd ..   # Angular renderer
   ```

### ▶️ Running

```bash
npm run app:serve       # full dev mode: Angular dev server + Electron with hot-reload
npm start               # build once and launch
npm test                # Electron main-process unit tests (`src/services`)
cd angular && ng test   # run the Angular unit tests
```

### 📦 Packaging

```bash
npm run package:win     # Windows (NSIS installer + portable ZIP)
npm run package:mac     # macOS (DMG, x64 + arm64)
npm run package:linux   # Linux (DEB, AppImage, ZIP)
```

## Pull Request Process

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes and commit them with clear messages.
4. Push to your fork and submit a pull request.
5. Ensure your code follows the project's coding standards.
