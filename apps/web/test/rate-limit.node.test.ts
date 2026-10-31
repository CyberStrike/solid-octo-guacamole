import { describe, expect, it, vi } from "vitest";
import { experimental_readRawConfig } from "wrangler";
import {
  emailKey,
  ipKey,
  isLimited,
  LOGIN_WINDOW_SECONDS,
  tooManyRequests,
} from "../src/rate-limit";

/** The sign-in limit's key for a client address, or for a request without one. */
const loginIp = (address: string | null) => ipKey("login", address);

describe("ipKey", () => {
  it("keys an IPv4 client on its whole address", async () => {
    const key = await loginIp("192.0.2.1");
    expect(await loginIp("192.0.2.1")).toBe(key);
    expect(await loginIp("192.0.2.2")).not.toBe(key);
  });

  it("keys an IPv6 client on its /64, which one subscriber commonly holds", async () => {
    const key = await loginIp("2001:db8:1:2::1");
    expect(await loginIp("2001:db8:1:2:ffff:ffff:ffff:9")).toBe(key);
    expect(await loginIp("2001:0db8:0001:0002:0000:0000:0000:0042")).toBe(key);
    expect(await loginIp("2001:DB8:1:2::abcd")).toBe(key);
    expect(await loginIp("2001:db8:1:3::1")).not.toBe(key);
    // The /64 is the first four groups however the address is shortened.
    expect(await loginIp("2001:db8::1")).toBe(await loginIp("2001:db8:0:0::2"));
    expect(await loginIp("::1")).toBe(await loginIp("::2"));
  });

  it("keys an IPv4 address written as IPv6 on the IPv4 address", async () => {
    const key = await loginIp("198.51.100.7");
    expect(await loginIp("::ffff:198.51.100.7")).toBe(key);
    expect(await loginIp("::FFFF:198.51.100.7")).toBe(key);
    const other = await loginIp("::ffff:203.0.113.9");
    expect(other).not.toBe(key);
    expect(other).not.toBe(await loginIp("::1"));
  });

  it("gives every request without a client address one shared key, still limited", async () => {
    const key = await loginIp(null);
    expect(await loginIp(null)).toBe(key);
    expect(key).not.toBe(await loginIp("192.0.2.1"));
  });

  it("never carries the address itself, and differs between limits", async () => {
    const key = await loginIp("192.0.2.1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("192.0.2.1");
    expect(await ipKey("search", "192.0.2.1")).not.toBe(key);
  });
});

describe("emailKey", () => {
  it("keys an address however it was spelt", async () => {
    const key = await emailKey("login", "reader@example.test");
    expect(await emailKey("login", "  Reader@EXAMPLE.test ")).toBe(key);
    expect(await emailKey("login", "other@example.test")).not.toBe(key);
  });

  it("never carries the address, and differs from an IP key for the same text", async () => {
    const key = await emailKey("login", "reader@example.test");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("reader");
    // Two limits with one value can't share a counter.
    expect(await emailKey("login", "192.0.2.1")).not.toBe(await loginIp("192.0.2.1"));
  });
});

describe("isLimited", () => {
  it("is limited only when the binding says the request is over", async () => {
    expect(await isLimited({ limit: async () => ({ success: true }) }, "k")).toBe(false);
    expect(await isLimited({ limit: async () => ({ success: false }) }, "k")).toBe(true);
  });

  it("lets the request through when the binding fails, logging only the error's name", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    try {
      const failing = {
        limit: async () => {
          throw new TypeError("limiter down for key 0123abcd");
        },
      };
      expect(await isLimited(failing, "0123abcd")).toBe(false);
      expect(logged).toEqual([["Rate limit unavailable: TypeError"]]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isLimited without its binding", () => {
  it("fails loudly rather than letting every request through", async () => {
    // As a binding left out of a deploy's config is, whatever Bindings says.
    await expect(isLimited(undefined, "k")).rejects.toThrow("Rate limit binding missing");
  });
});

describe("the sign-in limits in wrangler.jsonc", () => {
  it("have the window Retry-After says", async () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const periods = Object.fromEntries(
      (rawConfig.ratelimits ?? []).map((limit: { name: string; simple: { period: number } }) => [
        limit.name,
        limit.simple.period,
      ]),
    );
    expect(periods).toEqual({
      LOGIN_IP_LIMIT: LOGIN_WINDOW_SECONDS,
      LOGIN_EMAIL_LIMIT: LOGIN_WINDOW_SECONDS,
    });
  });
});

describe("tooManyRequests", () => {
  it("is a 429 whose Retry-After and page say the same whole seconds", async () => {
    const res = tooManyRequests(60);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("<h1>Too many requests</h1>");
    expect(html).toContain("Please try again in 60 seconds.");
  });
});
