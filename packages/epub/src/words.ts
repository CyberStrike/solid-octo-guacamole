import { decodeEntities } from "./entities";

const BLOCK_TAG = /<\/?(?:p|br|hr|div|blockquote|h[1-6]|li|ul|ol|dl|dt|dd|table|tr|td|th|thead|tbody|center)\b[^>]*>/gi;
// Han, kana and similar scripts are written without spaces; count each character.
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

/**
 * Approximate word count of sanitized HTML. AO3 counts with its own rules, so
 * this will not match `Stats: Words` exactly.
 */
export function countWords(html: string): number {
  const text = decodeEntities(html.replace(BLOCK_TAG, " ").replace(/<[^>]*>/g, "")).replace(CJK, " x ");
  return text.split(/[\s ]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
