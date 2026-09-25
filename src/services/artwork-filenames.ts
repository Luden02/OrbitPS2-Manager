const INDEXED_REMOTE_TYPES: Record<string, string> = {
  SCR: "SCR_00",
  SCR2: "SCR_01",
  SCR3: "SCR_02",
  BG: "BG_00",
};

export function artRemoteFileNames(gameId: string, type: string): string[] {
  const classic = `${gameId}_${type}.png`;
  const indexedType = INDEXED_REMOTE_TYPES[type];
  if (!indexedType) {
    return [classic];
  }
  return [`${gameId}_${indexedType}.png`, classic];
}
