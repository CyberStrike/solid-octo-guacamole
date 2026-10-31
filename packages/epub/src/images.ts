import type { ImageRef } from "./types";
import type { ManifestItem } from "./package";
import { LIMITS } from "./unzip";

type ImageType = ImageRef["mediaType"];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Identifies an image by its file signature. Anything else (SVG included) is null. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61)
    return "image/gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface ImageCandidate {
  ref: ImageRef;
  bytes: Uint8Array;
}

/** Hashes every manifest image that passes the signature and size checks, keyed by path. */
export async function collectImages(
  files: Map<string, Uint8Array>,
  manifest: Map<string, ManifestItem>,
): Promise<Map<string, ImageCandidate>> {
  const out = new Map<string, ImageCandidate>();
  for (const item of manifest.values()) {
    if (!item.mediaType.startsWith("image/")) continue;
    const bytes = files.get(item.path);
    if (!bytes || bytes.length > LIMITS.maxImageBytes) continue;
    const mediaType = sniffImage(bytes);
    if (!mediaType) continue;
    const key = await sha256Hex(bytes);
    out.set(item.path, {
      ref: { key, mediaType, size: bytes.length, sourcePath: item.path },
      bytes,
    });
  }
  return out;
}
