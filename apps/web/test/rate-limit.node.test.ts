import { describe, expect, it, vi } from "vitest";
import { isLimited, loginEmailKey, loginIpKey, tooManyRequests } from "../src/rate-limit";

/** A sign-in request from `ip`, or with no client address when it is null. */
const from = (ip: string | null) =>
  new Request("https://rarepair.fans/login", {
    method: "POST",
    headers: ip === null ? {} : { "cf-connecting-ip": ip },
  });

describe("loginIpKey", () => {
  it("keys an IPv4 client on its whole address", async () => {
    const key = await loginIpKey(from("192.0.2.1"));
    expect(await loginIpKey(from("192.0.2.1"))).toBe(key);
    expect(await loginIpKey(from("192.0.2.2"))).not.toBe(key);
  });

  it("keys an IPv6 client on its /64, which one subscriber commonly holds", async () => {
    const key = await loginIpKey(from("2001:db8:1:2::1"));
    expect(await loginIpKey(from("2001:db8:1:2:ffff:ffff:ffff:9"))).toBe(key);
    expect(await loginIpKey(from("2001:0db8:0001:0002:0000:0000:0000:0042"))).toBe(key);
    expect(await loginIpKey(from("2001:DB8:1:2::abcd"))).toBe(key);
    expect(await loginIpKey(from("2001:db8:1:3::1"))).not.toBe(key);
    // The /64 is the first four groups however the address is shortened.
    expect(await loginIpKey(from("2001:db8::1"))).toBe(await loginIpKey(from("2001:db8:0:0::2")));
    expect(await loginIpKey(from("::1"))).toBe(await loginIpKey(from("::2")));
  });

  it("gives every request without a client address one shared key, still limited", async () => {
    const key = await loginIpKey(from(null));
    expect(await loginIpKey(from(null))).toBe(key);
    expect(key).not.toBe(await loginIpKey(from("192.0.2.1")));
  });

  it("never carries the address itself", async () => {
    const key = await loginIpKey(from("192.0.2.1"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("192.0.2.1");
  });
});

describe("loginEmailKey", () => {
  it("keys an address however it was spelt", async () => {
    const key = await loginEmailKey("reader@example.test");
    expect(await loginEmailKey("  Reader@EXAMPLE.test ")).toBe(key);
    expect(await loginEmailKey("other@example.test")).not.toBe(key);
  });

  it("never carries the address, and differs from an IP key for the same text", async () => {
    const key = await loginEmailKey("reader@example.test");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("reader");
    // Two limits with one value can't share a counter.
    expect(await loginEmailKey("192.0.2.1")).not.toBe(await loginIpKey(from("192.0.2.1")));
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
