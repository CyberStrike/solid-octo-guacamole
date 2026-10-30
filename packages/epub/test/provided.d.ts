import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Real epubs from fixtures/epubs/, base64 by file name. Empty when none are present. */
    epubFixtures: Record<string, string>;
  }
}
