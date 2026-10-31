// The one URL builder for tag pages, shared by the work page and the tag listing:
// `/tags/<type>/<name_norm>`, so the same name as a fandom and as a character are
// two pages. Both parts are percent-encoded, which also makes the href safe to quote.
export function tagHref(type: string, nameNorm: string): string {
  return "/tags/" + encodeURIComponent(type) + "/" + encodeURIComponent(nameNorm);
}
