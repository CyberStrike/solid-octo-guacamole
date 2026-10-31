// What an upload may be. Kept apart from src/upload.ts so that pages.ts, which
// upload.ts imports, can use it too.

/** The one type a presigned URL accepts (ARCHITECTURE, Ingestion pipeline). */
export const EPUB_TYPE = "application/epub+zip";

/** The limit in MiB, as the pages say it: "25 MB". */
export const MAX_UPLOAD_MB = 25;

/**
 * The largest declared size `POST /uploads` accepts: 25 MiB, the processor's
 * `LIMITS.maxInputBytes` (packages/epub/src/unzip.ts). Restated, since importing
 * it would bundle the processor into this Worker; test/upload-limit.node.test.ts
 * holds the two equal.
 */
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
