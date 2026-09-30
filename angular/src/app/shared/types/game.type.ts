export type GameFormat = 'ISO' | 'ZSO' | 'VCD' | 'UL' | 'POPS' | 'EMBER' | 'APP';

export type Ps1LauncherInfo = {
  folder: string;
  title: string;
  boot: string;
  path: string;
  gameId?: string;
};

export type Game = {
  filename: string;
  size?: string;
  gameId: string;
  region?: 'NTSC-U' | 'PAL' | 'NTSC-J' | 'UNKNOWN';
  cdType: string;
  title?: string;
  path: string;
  extension: string;
  parentPath: string;
  format?: GameFormat;
  system?: 'PS1' | 'PS2' | 'APPS';
  art?: gameArt[];
  /** APPS only: the subfolder name under APPS/ (used for deletion). */
  appFolder?: string;
  /** PS1 only: path to the APPS/POPS_* launcher folder for this game. */
  ps1LauncherPath?: string;
  /** PS1 only: ELF boot filename inside the launcher folder. */
  ps1LauncherBoot?: string;
  /** PS1 only: POPS subfolder for VMC detection (derived from POPS_ prefix). */
  ps1VmcSub?: string;
  /** Marks this APPS entry as a PS1 POPStarter launcher (OPL 1.2+). */
  isPs1Launcher?: boolean;
  /** Canonical PS1 title resolved from disc identity, independent of user naming. */
  canonicalTitle?: string;
  /** PS1 disc-identification confidence used to gate automatic renames/artwork. */
  identificationStatus?: 'identified' | 'ambiguous' | 'unidentified';
  /** Ember only: game-folder name used by RiptOPL as the artwork/config identity. */
  emberFolder?: string;
  /** Ember only: CUE file used to locate the game's BIN data track. */
  emberCuePath?: string;
};

export type RawGameFile = {
  extension: string;
  name: string;
  parentPath: string;
  path: string;
  stats?: {
    dev: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    blksize: number;
    ino: number;
    size: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: string;
    mtime: string;
    ctime: string;
    birthtime: string;
  };
};

export type gameArt = {
  extension: string;
  gameId: string;
  name: string;
  path: string;
  type: string;
  base64: string;
};
