---
layout: default
title: How-To Guide
---

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

---

Next: [Folder Layout →](folder-layout.md)
