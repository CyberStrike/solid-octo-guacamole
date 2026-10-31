import { describe, expect, it } from "vitest";
import { isTermsExempt } from "../src/terms";

describe("terms gate's exempt paths", () => {
  it("The terms page, the pages it links to, sign-in and static files are exempt", () => {
    for (const path of [
      "/welcome/terms",
      "/terms",
      "/privacy",
      "/login",
      "/login/confirm",
      "/assets/site.0123456789abcdef.css",
      "/assets/waitlist/font.0123456789abcdef.woff2",
    ]) {
      expect(isTermsExempt(path), path).toBe(true);
    }
  });

  it("Exempt pages match exactly, and sections by whole segment", () => {
    for (const path of [
      "/",
      "/works/13000",
      "/upload",
      "/admin",
      "/terms/",
      "/terms/x",
      "/welcome/terms/x",
      "/welcome",
      "/privacyx",
      "/assets",
      "/assetsx/site.css",
      "/login/confirmx",
    ]) {
      expect(isTermsExempt(path), path).toBe(false);
    }
  });
});
