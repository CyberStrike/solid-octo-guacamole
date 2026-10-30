// HTMLRewriter hands us text and attribute values exactly as written in the
// source, entities and all. These helpers decode the references we need for
// metadata and URL checks. Unknown named references are left untouched so
// callers can detect them.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "­",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  zwj: "‍",
  zwnj: "‌",
};

const REF = /&(?:#(\d{1,8});?|#[xX]([0-9a-fA-F]{1,7});?|([a-zA-Z][a-zA-Z0-9]{1,31});)/g;

function fromCodePoint(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
  return String.fromCodePoint(cp);
}

export function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(REF, (whole, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10));
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16));
    const value = name === undefined ? undefined : NAMED[name];
    return value ?? whole;
  });
}

/** True if a named reference we could not decode is still present. */
export function hasNamedEntity(decoded: string): boolean {
  return /&[a-zA-Z][a-zA-Z0-9]*;/.test(decoded);
}

export function escapeText(raw: string): string {
  return raw.replace(/\0/g, "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim();
}
