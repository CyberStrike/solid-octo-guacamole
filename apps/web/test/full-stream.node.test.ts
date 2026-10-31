import { describe, expect, it, vi } from "vitest";
import { streamParts, type Part } from "../src/full";

// The entire work's stream, on stub bodies: what workerd can't show, such as a reader
// who leaves stopping the R2 reads.

/** A fragment body that yields `chunks`, recording whether it was cancelled. */
const body = (chunks: Uint8Array[]) => {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
};

/** A body that hands out one chunk and then waits for ever, as a slow R2 read does. */
const stalled = () => {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<p>first</p>"));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
};

/** Lets pending stream work run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The whole stream as text, decoded once at the end. */
const readAll = (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe("streamParts", () => {
  it("puts markup and fragments together in order, keeping split characters whole", async () => {
    // "é" is two bytes in UTF-8; the fragment splits it across two chunks.
    const bytes = new TextEncoder().encode("<p>é</p>");
    const one = body([bytes.slice(0, 4), bytes.slice(4)]);
    const two = body([new TextEncoder().encode("<p>two</p>")]);
    const html = await readAll(
      streamParts(["<a>", one.stream, "</a><b>", () => Promise.resolve(two.stream), "</b>"]),
    );
    expect(html).toBe("<a><p>é</p></a><b><p>two</p></b>");
  });

  it("opens a fragment only when the reader reaches it, and stops when the reader leaves", async () => {
    const open = stalled();
    const opened: string[] = [];
    const later =
      (name: string): Part =>
      () => {
        opened.push(name);
        return Promise.resolve(body([]).stream);
      };
    const stream = streamParts(["<a>", open.stream, "</a>", later("two"), later("three")]);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const read = [(await reader.read()).value, (await reader.read()).value];
    expect(read.map((chunk) => decoder.decode(chunk))).toEqual(["<a>", "<p>first</p>"]);
    await reader.cancel();
    expect(open.state.cancelled).toBe(true);
    expect(opened).toEqual([]);
  });

  it("cancels a fragment opened ahead that the reader never reached", async () => {
    const first = body([new TextEncoder().encode("<p>one</p>")]);
    const reader = streamParts(["<header>", first.stream]).getReader();
    await reader.read();
    await reader.cancel();
    expect(first.state.cancelled).toBe(true);
  });

  it("ends in an error when a fragment is missing or fails, logging only its kind", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => logged.push(args));
    try {
      for (const failing of [
        () => Promise.resolve(null),
        () => Promise.reject(new TypeError("works/21001/x/3.html unreadable")),
      ] satisfies Part[]) {
        const stream = streamParts(["<a>", failing, "</a>"]);
        await expect(readAll(stream)).rejects.toThrow();
      }
    } finally {
      spy.mockRestore();
    }
    // A missing fragment and R2 failing are told apart, and neither names the work.
    expect(logged).toEqual([
      ["Entire work stream: MissingFragment"],
      ["Entire work stream: TypeError"],
    ]);
  });

  it("cancels a fragment whose read was still on its way when the reader left", async () => {
    const late = stalled();
    let resolve: (stream: ReadableStream<Uint8Array>) => void = () => {};
    const pending = new Promise<ReadableStream<Uint8Array>>((r) => (resolve = r));
    const reader = streamParts([() => pending, "</a>"]).getReader();
    const read = reader.read();
    // The pull starts a task later: let it reach R2 before the reader leaves.
    await tick();
    await reader.cancel();
    resolve(late.stream);
    await read;
    await tick();
    expect(late.state.cancelled).toBe(true);
  });

  it("opens nothing more once the reader leaves mid-fragment", async () => {
    const open = stalled();
    const opened: string[] = [];
    const reader = streamParts([
      open.stream,
      () => {
        opened.push("next");
        return Promise.resolve(body([]).stream);
      },
    ]).getReader();
    await reader.read();
    // The next pull waits on the stalled body; the reader leaves meanwhile.
    const read = reader.read();
    await tick();
    await reader.cancel();
    await read;
    await tick();
    expect(opened).toEqual([]);
  });

  it("logs nothing when the reader leaves", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => logged.push(args));
    try {
      const reader = streamParts(["<a>", stalled().stream, "</a>"]).getReader();
      await reader.read();
      await reader.read();
      const read = reader.read();
      await tick();
      await reader.cancel();
      await read;
      await tick();
    } finally {
      spy.mockRestore();
    }
    expect(logged).toEqual([]);
  });

  it("cancels the fragments opened ahead when a fragment fails", async () => {
    const ahead = body([new TextEncoder().encode("<p>ahead</p>")]);
    const stream = streamParts([() => Promise.resolve(null), ahead.stream]);
    await expect(readAll(stream)).rejects.toThrow();
    expect(ahead.state.cancelled).toBe(true);
  });
});
