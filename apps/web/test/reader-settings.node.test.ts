import { describe, expect, it } from "vitest";
import {
  CLEAR_FLASH_COOKIE,
  flashCookie,
  flashMessage,
  htmlAttributes,
  parseSettings,
  settingsCookie,
} from "../src/reader-settings";

// The settings cookie and the flash code are anyone's to write, so they are parsed
// against allowlists here, on the pure module; the Worker tests cover the routes.

describe("parseSettings", () => {
  it("keeps the allowlisted value of each setting", () => {
    expect(parseSettings("theme=dark&size=l&leading=relaxed&face=sans")).toEqual({
      theme: "dark",
      size: "l",
      leading: "relaxed",
      face: "sans",
    });
  });

  it("drops unknown keys and values, and anything with markup", () => {
    expect(parseSettings('theme="><script>&size=xxl&leading=RELAXED&face=sans&colour=red')).toEqual(
      { face: "sans" },
    );
  });

  it("reads nothing from an absent, empty or junk cookie", () => {
    expect(parseSettings(undefined)).toEqual({});
    expect(parseSettings("")).toEqual({});
    expect(parseSettings("x".repeat(4096))).toEqual({});
    expect(parseSettings("theme=dark=sepia")).toEqual({});
  });

  it("keeps the first of a repeated key", () => {
    expect(parseSettings("size=s&size=xl")).toEqual({ size: "s" });
  });
});

describe("htmlAttributes", () => {
  it("writes the settings as data attributes in a fixed order", () => {
    expect(htmlAttributes({ leading: "relaxed", size: "l", theme: "dark" })).toBe(
      ' data-theme="dark" data-size="l" data-leading="relaxed"',
    );
    expect(htmlAttributes({ face: "sans" })).toBe(' data-face="sans"');
    expect(htmlAttributes({})).toBe("");
  });
});

describe("settingsCookie", () => {
  it("is a __Host- cookie scripts can write, with no Domain", () => {
    expect(settingsCookie({ theme: "sepia", size: "xl" })).toBe(
      "__Host-reader=theme=sepia&size=xl; Max-Age=31536000; Path=/; SameSite=Lax; Secure",
    );
  });

  it("round-trips through parseSettings", () => {
    const settings = { theme: "light", size: "s", leading: "compact", face: "serif" } as const;
    const value = settingsCookie(settings).match(/^__Host-reader=([^;]*);/)?.[1];
    expect(parseSettings(value)).toEqual(settings);
  });
});

describe("flash", () => {
  it("maps a known code to fixed copy and anything else to nothing", () => {
    expect(flashMessage("settings-saved")).toBe("Reader settings saved.");
    expect(flashMessage("<b>hi</b>")).toBeNull();
    expect(flashMessage("toString")).toBeNull();
    expect(flashMessage(undefined)).toBeNull();
  });

  it("is a short-lived HttpOnly __Host- cookie, cleared with the same attributes", () => {
    expect(flashCookie("settings-saved")).toBe(
      "__Host-flash=settings-saved; Max-Age=60; Path=/; SameSite=Lax; Secure; HttpOnly",
    );
    expect(CLEAR_FLASH_COOKIE).toBe(
      "__Host-flash=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly",
    );
  });
});
