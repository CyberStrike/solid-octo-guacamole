import { describe, expect, it } from "vitest";
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

  it("ends in an error when a fragment is missing or fails", async () => {
    for (const failing of [
      () => Promise.resolve(null),
      () => Promise.reject(new Error("R2 down")),
    ] satisfies Part[]) {
      const stream = streamParts(["<a>", failing, "</a>"]);
      await expect(readAll(stream)).rejects.toThrow();
    }
  });
});
