/**
 * The largest declared size `POST /uploads` accepts: 25 MiB, the processor's
 * `LIMITS.maxInputBytes` (packages/epub/src/unzip.ts). Restated, since importing
 * it would bundle the processor into this Worker; test/upload-limit.node.test.ts
 * holds the two equal.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
