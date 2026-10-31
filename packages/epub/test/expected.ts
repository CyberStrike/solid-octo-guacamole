// Shape of one entry in the git-ignored fixtures/epubs/expected.json, keyed by epub
// file name. fixtures/epubs/expected.example.json shows it with placeholder values.
// Every `*Sha` is the SHA-256 (lowercase hex) of the real string's UTF-8 bytes.
export interface Expected {
  workIdSha: string;
  titleSha: string;
  authors: { pseudSha: string; userSha: string | null }[];
  rating: string;
  fandomShas: string[];
  relationships: number;
  relationshipIncludesSha?: string;
  characters: number;
  freeforms: number;
  words: number;
  published: string;
  // Where the chapter's first words sit in its whitespace-collapsed HTML.
  opening: { offset: number; length: number; sha: string };
}
