import { createDb } from "@archive/db";
import { putFragments, seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

// Every work here has an AO3 work ID in 22000-22099 and tags named r5-..., so no other
// test file sharing the database sees them.
const W = 22001;

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

beforeAll(async () => {
  const w = await seedWork(db, {
    ao3WorkId: W,
    title: "R5 work",
    tags: [{ type: "rating" as const, name: "r5-General Audiences" }],
    // Synthetic markers only: no fic text in tests.
    chapters: [{ html: "<p>R5-ONE-TEXT</p>" }, { html: "<p>R5-TWO-TEXT</p>" }],
  });
  await putFragments(env.BUCKET, w.fragments);
});

afterAll(() => db.destroy());

const CHAPTER = `/works/${W}/chapters/2`;

/** A page, as a reader whose settings cookie holds `settings` sees it. */
const pageWith = async (path: string, settings?: string) =>
  (
    await fetchW(
      path,
      settings === undefined ? {} : { headers: { cookie: `__Host-reader=${settings}` } },
    )
  ).text();

/** The stylesheet a page links to. */
const stylesheetOf = async (html: string) => {
  const href = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  const res = await fetchW(href ?? "/missing.css");
  expect(res.status).toBe(200);
  return res.text();
};

/** The declarations of every top-level rule whose selector list includes exactly `selector`. */
const rulesFor = (css: string, selector: string) =>
  [
    ...css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<=^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g),
  ].flatMap(([, selectors = "", body = ""]) =>
    selectors.split(",").some((s) => s.trim() === selector) ? [body] : [],
  );

/** The page's <html> start tag. */
const htmlTag = (html: string) => html.match(/<html\b[^>]*>/)?.[0] ?? null;

describe("13-reader-settings-and-position", () => {
  it("Settings come from a cookie as attributes on html", async () => {
    const html = await pageWith(CHAPTER, "theme=dark&size=l&leading=relaxed");
    expect(html).toContain("R5-TWO-TEXT");
    expect(htmlTag(html)).toBe(
      '<html lang="en" data-theme="dark" data-size="l" data-leading="relaxed">',
    );
    expect(html).not.toMatch(/\sstyle=|<style\b/i);
    // Values outside the lists give no attribute and are never echoed.
    const hostile = await pageWith(CHAPTER, 'theme="><script>x&size=xxl');
    expect(htmlTag(hostile)).toBe('<html lang="en">');
    expect(hostile).not.toContain("xxl");
    expect(hostile).not.toContain('"><script>x');
  });

  it("Font sizes S, M, L and XL", async () => {
    const css = await stylesheetOf(await pageWith(CHAPTER));
    expect(rulesFor(css, "article.chapter").join("\n")).toMatch(
      /font-size:\s*var\(--reading-size\);/,
    );
    const sizes = { s: 16, m: 18, l: 20, xl: 23 };
    for (const [size, px] of Object.entries(sizes)) {
      expect(rulesFor(css, `html[data-size="${size}"]`).join("\n"), size).toMatch(
        new RegExp(`--reading-size:\\s*${px}px;`),
      );
      expect(htmlTag(await pageWith(CHAPTER, `size=${size}`))).toBe(
        `<html lang="en" data-size="${size}">`,
      );
    }
  });

  it("Default reading size is 18 px", async () => {
    const html = await pageWith(CHAPTER);
    expect(htmlTag(html)).toBe('<html lang="en">');
    const css = await stylesheetOf(html);
    expect(rulesFor(css, ":root").join("\n")).toMatch(/--reading-size:\s*18px;/);
  });

  it("Themes light, dark and sepia", async () => {
    const css = await stylesheetOf(await pageWith(CHAPTER));
    for (const theme of ["light", "dark", "sepia"]) {
      const rules = rulesFor(css, `:root[data-theme="${theme}"]`).join("\n");
      expect(rules, theme).toMatch(
        new RegExp(`color-scheme:\\s*${theme === "dark" ? "dark" : "light"};`),
      );
      expect(htmlTag(await pageWith(CHAPTER, `theme=${theme}`))).toBe(
        `<html lang="en" data-theme="${theme}">`,
      );
    }
    // Each theme that is not the default sets the page's colours.
    for (const theme of ["dark", "sepia"]) {
      const rules = rulesFor(css, `:root[data-theme="${theme}"]`).join("\n");
      for (const colour of ["--ink", "--paper", "--muted", "--rule", "--accent"]) {
        expect(rules, `${theme} ${colour}`).toMatch(new RegExp(`${colour}:\\s*#[0-9a-f]{6};`));
      }
    }
  });

  it("Default theme follows prefers-color-scheme", async () => {
    const html = await pageWith(CHAPTER);
    expect(htmlTag(html)).toBe('<html lang="en">');
    const css = await stylesheetOf(html);
    // The system's dark preference applies only while no theme is chosen, so an explicit
    // light or sepia choice wins over a dark system.
    const media =
      css.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? "";
    expect(media).toMatch(/^\s*:root:not\(\[data-theme\]\)\s*\{[^}]*--paper:\s*#[0-9a-f]{6};/);
    expect(rulesFor(css, ":root").join("\n")).toMatch(/color-scheme:\s*light dark;/);
  });

  it("Serif or sans-serif reading face", async () => {
    const html = await pageWith(CHAPTER);
    expect(htmlTag(html)).toBe('<html lang="en">');
    const css = await stylesheetOf(html);
    expect(rulesFor(css, ":root").join("\n")).toContain(
      '--reading: Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif;',
    );
    expect(rulesFor(css, "article.chapter").join("\n")).toMatch(/font-family:\s*var\(--reading\);/);
    expect(rulesFor(css, 'html[data-face="sans"]').join("\n")).toMatch(/--reading:\s*var\(--ui\);/);
    expect(htmlTag(await pageWith(CHAPTER, "face=sans"))).toBe('<html lang="en" data-face="sans">');
  });

  it("Line spacing setting", async () => {
    const css = await stylesheetOf(await pageWith(CHAPTER));
    const leading = { compact: "1.45", normal: "1.6", relaxed: "1.8" };
    for (const [name, height] of Object.entries(leading)) {
      expect(
        rulesFor(css, `html[data-leading="${name}"] article.chapter`).join("\n"),
        name,
      ).toMatch(new RegExp(`line-height:\\s*${height.replace(".", "\\.")};`));
      expect(htmlTag(await pageWith(CHAPTER, `leading=${name}`))).toBe(
        `<html lang="en" data-leading="${name}">`,
      );
    }
  });
});
