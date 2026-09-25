---
layout: default
title: Contributing
---

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

---

[← Back to Home](./)
