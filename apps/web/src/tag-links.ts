// Where a tag links to: its listing, `/tags/<type>/<name_norm>`. Each part is one
// path segment, so a relationship's `/` and `&` stay in the name.

export function tagHref(type: string, nameNorm: string): string {
  return "/tags/" + encodeURIComponent(type) + "/" + encodeURIComponent(nameNorm);
}
