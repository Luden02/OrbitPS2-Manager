---
layout: default
title: Folder Layout
---

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

---

Next: [Contributing →](contributing.md)
