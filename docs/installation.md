---
layout: default
title: Installation
---

# 💻 Installation

Grab the latest build from the [Releases](https://github.com/Luden02/OrbitPS2-Manager/releases) page.

On Arch Linux you can also use the [AUR binary](https://aur.archlinux.org/packages/orbitopl-toolbox-bin) or [AUR git](https://aur.archlinux.org/packages/orbitopl-toolbox-git) packages (thanks to u/m0tic).

## 🪟 Windows

1. Download the **`.exe`** installer (or the portable **`.zip`** if you'd rather not install).
2. Run it — the installer walks you through setup; the `.zip` just needs extracting, then run `OrbitPS2Manager.exe`.
3. If **SmartScreen** appears, click **"More info" → "Run anyway"** (the app is unsigned but 100% safe).

## 🍏 macOS

1. Download the `.dmg` for your architecture:
   - **arm64** (Apple Silicon — _recommended and tested_)
   - **x64** (Intel Macs)
2. Open the `.dmg` and drag **OrbitPS2Manager** to your **Applications** folder.
3. Because the app is **unsigned** (but **100% safe**), macOS quarantines it. Remove the quarantine flag by running this in your **terminal**:
   ```bash
   xattr -dr com.apple.quarantine /Applications/OrbitPS2Manager.app
   ```
4. **Run** the app.

## 🐧 Linux

1. Download the **`.AppImage`**, **`.deb`**, or **`.zip`** (whichever suits your distro).
2. For the **AppImage**: make it executable and run it. For the **`.deb`**: install it with your package manager. For the **`.zip`**: extract and run the `OrbitPS2Manager` binary.

---

Next: [How-To Guide →](guide.md)
