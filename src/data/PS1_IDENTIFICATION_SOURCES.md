# PS1 identification data sources

OrbitPS2's RiptOPL PS1 identification work intentionally keeps imported data small and auditable.

- **pcm720 / OSDMenu** — the generic-boot PS1 fallback table in `src/utils/ps1-pvd-game-id.ts` is derived from the factual ISO9660 PVD creation-timestamp → disc-ID mappings in `common/include/game_id_table.h`, pinned to commit `a2b847a2d1b319483fe1fa84d4dc14493b7bbc6f`.
- **GDX-X / PFS-BatchKit-Manager** — `src/data/ps1-disc-conflicts.json` contains the small PS1 shared-serial MD5/title/disc-ID conflict table from `PFS-BatchKit-Manager/BAT/Fix_Conflict_Gameid_Title.bat`, pinned to commit `5e7e835ced587bb4784fe24489e0918ca0d44e2c`.
- **OrbitPS2 integration** — the parser, CUE/VCD handling, safe ambiguity state, storage naming, artwork gating, and regression tests are integration code in this fork rather than copied implementations from those projects.

The full upstream databases are not vendored. Only the factual mappings needed for the implemented resolution paths are retained.

## Known shared serials left on the retail title

These BOOT serials are also used by a pre-release or demo disc. They are not in the conflict table: marking them as conflicts would make every retail copy that is not a byte-exact known dump ambiguous, which is the wrong trade for rare discs. The retail title is used; the listed disc is named after the retail game until verified MD5 rules exist.

Verified 2026-09-29 against the Redump PS1 DAT (libretro-database `d5bae90b`) and DuckStation's `gamedb.yaml`, which lists the retail game under the serial (and separates `SLES-00107` by hash).

| BOOT serial | Retail title (used) | Colliding disc (not auto-identified) |
|---|---|---|
| `SCUS_945.05` | NFL GameDay (USA) | NCAA Football GameBreaker (USA) (Beta) — retail NCAA is `SCUS_945.09` |
| `SLES_000.76` | Slam 'n Jam '96 featuring Magic & Kareem (Europe) | Ninja - Shadow of Darkness (Europe) (Beta) |
| `SLUS_000.33` | Viewpoint (USA) | Madden NFL 96 (USA) (Proto) |
| `SLES_001.07` | Tomb Raider II - Starring Lara Croft (Italy) | Euro Demo 01 (Europe) |

Label-serial collisions in Redump that are *not* BOOT collisions (e.g. multi-disc sets such as Final Fantasy VII, where each disc boots its own serial) need no handling.
