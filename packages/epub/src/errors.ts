/** Rejection codes from ARCHITECTURE "EPUB processor" that this package can raise. */
export type EpubErrorCode = "not_epub" | "zip_bomb" | "too_large" | "not_ao3" | "parse_failed";

export class EpubError extends Error {
  readonly code: EpubErrorCode;

  constructor(code: EpubErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EpubError";
    this.code = code;
  }
}
