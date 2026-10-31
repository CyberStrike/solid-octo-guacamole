import "vitest";
import type { Expected } from "./expected";

declare module "vitest" {
  export interface ProvidedContext {
    /** Real epubs from fixtures/epubs/, base64 by file name. Empty when none are present. */
    epubFixtures: Record<string, string>;
    /** fixtures/epubs/expected.json by epub file name. Empty when the file is absent. */
    epubExpected: Record<string, Expected>;
  }
}
