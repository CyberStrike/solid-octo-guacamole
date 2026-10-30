import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { EpubError } from "./errors";

const MiB = 1024 * 1024;

export const LIMITS = {
  maxInputBytes: 25 * MiB,
  maxEntries: 2_000,
  maxTotalBytes: 100 * MiB,
  maxEntryBytes: 20 * MiB,
  maxImageBytes: 5 * MiB,
  /**
   * Elements plus text nodes across every parsed document. Bounds tree memory
   * (chapter copies roughly double it) inside a 128 MB Worker; also caps the
   * largest work accepted. A guess until measured against real long works.
   */
  maxNodes: 300_000,
} as const;

// Compressed bytes fed to the inflater at a time. Deflate expands at most about
// 1032:1, so one push can produce at most ~16 MiB before the limits are checked.
const PUSH_BYTES = 16 * 1024;

function isSafeName(name: string): boolean {
  if (name === "" || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  return !name.split("/").includes("..");
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Unzips with hard limits. Uses fflate's streaming `Unzip` so the limits apply
 * to bytes actually inflated, not to the sizes the zip declares about itself.
 * Directory entries count toward the entry limit but are not returned.
 */
export function unzipEpub(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new EpubError("not_epub", "Not a zip file");
  }

  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let entries = 0;
  let total = 0;
  let pending = 0;
  let failure: EpubError | null = null;
  const fail = (err: EpubError, file?: UnzipFile) => {
    failure ??= err;
    file?.terminate();
  };

  const unzip = new Unzip((file) => {
    if (failure) return;
    entries++;
    if (entries > LIMITS.maxEntries) return fail(new EpubError("zip_bomb", `More than ${LIMITS.maxEntries} entries`));
    const name = file.name;
    if (!isSafeName(name)) return fail(new EpubError("not_epub", `Unsafe entry name: ${JSON.stringify(name)}`));
    // Two entries with one name could be read differently by different tools.
    if (seen.has(name)) return fail(new EpubError("not_epub", `Duplicate entry: ${JSON.stringify(name)}`));
    seen.add(name);
    if ((file.originalSize ?? 0) > LIMITS.maxEntryBytes) {
      return fail(new EpubError("zip_bomb", `Entry declares more than ${LIMITS.maxEntryBytes} bytes: ${name}`));
    }

    const isDir = name.endsWith("/");
    const chunks: Uint8Array[] = [];
    let size = 0;
    pending++;
    file.ondata = (err, data, final) => {
      if (failure) return;
      if (err) return fail(new EpubError("not_epub", `Corrupt entry ${name}: ${err.message}`), file);
      size += data.length;
      total += data.length;
      if (size > LIMITS.maxEntryBytes) {
        return fail(new EpubError("zip_bomb", `Entry inflates past ${LIMITS.maxEntryBytes} bytes: ${name}`), file);
      }
      if (total > LIMITS.maxTotalBytes) {
        return fail(new EpubError("zip_bomb", `Archive inflates past ${LIMITS.maxTotalBytes} bytes`), file);
      }
      if (data.length) chunks.push(data);
      if (final) {
        pending--;
        if (!isDir) files.set(name, concat(chunks, size));
      }
    };
    try {
      file.start();
    } catch (e) {
      fail(new EpubError("not_epub", `Cannot read entry ${name}: ${(e as Error).message}`));
    }
  });
  unzip.register(UnzipInflate);

  try {
    // In bounded chunks: a single push of the whole archive would inflate an
    // entry with a falsified size in one allocation, before `ondata` runs.
    for (let at = 0; at < bytes.length && !failure; at += PUSH_BYTES) {
      const end = Math.min(at + PUSH_BYTES, bytes.length);
      unzip.push(bytes.subarray(at, end), end === bytes.length);
    }
  } catch (e) {
    if (!failure) throw new EpubError("not_epub", `Unreadable zip: ${(e as Error).message}`, { cause: e });
  }
  if (failure) throw failure;
  if (pending > 0) throw new EpubError("not_epub", "Truncated zip");
  return files;
}
