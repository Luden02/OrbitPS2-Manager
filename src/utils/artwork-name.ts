export interface ParsedArtworkBaseName {
  identity: string;
  type: string;
}

/**
 * Split an artwork basename into its storage identity and art-type suffix.
 *
 * Most files use <identity>_<TYPE>. Indexed database variants use a compound
 * suffix such as SCR_00 or BG_02, which must be kept intact instead of treating
 * only the final numeric segment as the type.
 */
export function parseArtworkBaseName(
  baseName: string
): ParsedArtworkBaseName | null {
  const indexed = baseName.match(/^(.*)_((?:SCR|BG)_\d{1,2})$/i);
  if (indexed?.[1] && indexed[2]) {
    return {
      identity: indexed[1],
      type: indexed[2].toUpperCase(),
    };
  }

  const lastUnderscore = baseName.lastIndexOf("_");
  if (lastUnderscore <= 0 || lastUnderscore >= baseName.length - 1) {
    return null;
  }

  return {
    identity: baseName.slice(0, lastUnderscore),
    type: baseName.slice(lastUnderscore + 1).toUpperCase(),
  };
}