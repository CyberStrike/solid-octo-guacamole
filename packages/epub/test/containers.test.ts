import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { processEpub } from "../src";
import { ao3Epub, expectEpubError, MiB, zipEntries } from "./helpers";

describe("hostile containers", () => {
  it("accepts the synthetic baseline", async () => {
    const work = await processEpub(ao3Epub());
    expect(work.ao3WorkId).toBe("1000001");
    expect(work.chapters).toHaveLength(1);
  });

  it("rejects a file that is not a zip", async () => {
    await expectEpubError(processEpub(strToU8("just some text, not a zip")), "not_epub");
  });

  it("rejects a wrong mimetype", async () => {
    await expectEpubError(processEpub(ao3Epub({ mimetype: "application/zip" })), "not_epub");
  });

  it("rejects a missing mimetype", async () => {
    await expectEpubError(processEpub(ao3Epub({ mimetype: null })), "not_epub");
  });

  it.each(["../evil.xhtml", "OEBPS/../../evil.xhtml", "/etc/evil.xhtml", "C:/evil.xhtml", "OEBPS\\evil.xhtml"])(
    "rejects the entry name %s",
    async (name) => {
      await expectEpubError(processEpub(zipEntries({ [name]: "<p>x</p>" })), "not_epub");
    },
  );

  it("rejects an entry that inflates past 20 MB (30 MB of zeros)", async () => {
    await expectEpubError(processEpub(zipEntries({ "big.bin": new Uint8Array(30 * MiB) })), "zip_bomb");
  });

  it("rejects an entry that inflates past 20 MB while declaring a small size", async () => {
    // Patch the local header's uncompressed size, so only the streaming check can catch it.
    const zip = zipEntries({ "big.bin": new Uint8Array(30 * MiB) });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const name = new TextEncoder().encode("big.bin");
    let patched = false;
    for (let at = 0; at + 30 + name.length <= zip.length; at++) {
      if (view.getUint32(at, true) !== 0x04034b50 || view.getUint16(at + 26, true) !== name.length) continue;
      if (!name.every((b, i) => zip[at + 30 + i] === b)) continue;
      view.setUint32(at + 22, 1024, true);
      patched = true;
      break;
    }
    expect(patched).toBe(true);
    await expectEpubError(processEpub(zip), "zip_bomb");
  });

  it("rejects an archive that inflates past 100 MB in total", async () => {
    const chunk = new Uint8Array(19 * MiB);
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 6; i++) entries[`part${i}.bin`] = chunk;
    await expectEpubError(processEpub(zipEntries(entries)), "zip_bomb");
  });

  it("rejects more than 2,000 entries", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 2_000; i++) entries[`f${i}.txt`] = "x";
    // Plus the mimetype entry: 2,001 in all.
    await expectEpubError(processEpub(zipEntries(entries)), "zip_bomb");
  });

  it("flags a spine itemref with no manifest item", async () => {
    const files = unzipSync(ao3Epub());
    const opf = strFromU8(files["content.opf"]!).replace("</spine>", `<itemref idref="ghost"/></spine>`);
    const { mimetype: _, ...rest } = files;
    const work = await processEpub(zipEntries({ ...rest, "content.opf": opf }));
    expect(work.reviewReasons).toEqual(['unknown_spine_item: "ghost"']);
  });

  it("rejects input over 25 MB before unzipping", async () => {
    const bytes = new Uint8Array(25 * MiB + 1);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
    await expectEpubError(processEpub(bytes), "too_large");
  });

  it("rejects a valid epub without an AO3 work URL", async () => {
    await expectEpubError(processEpub(ao3Epub({ workId: null })), "not_ao3");
  });

  it("flags a non-native file that only has an AO3 URL in the OPF", async () => {
    const bytes = zipEntries({
      "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
      "OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Elsewhere</dc:title><dc:creator>someone</dc:creator>
          <dc:source>http://archiveofourown.org/works/5</dc:source>
        </metadata>
        <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c1"/></spine>
      </package>`,
      "OEBPS/c1.xhtml": `<html><body><p>plain text</p></body></html>`,
    });
    const work = await processEpub(bytes);
    expect(work.ao3WorkId).toBe("5");
    expect(work.title).toBe("Elsewhere");
    expect(work.authors).toEqual([{ pseud: "someone", user: null }]);
    expect(work.rating).toBeNull();
    expect(work.chapters).toHaveLength(1);
    expect(work.reviewReasons).toEqual([
      expect.stringMatching(/^chapters_one_per_file/),
      "missing_rating",
    ]);
  });

  it("rejects a missing OPF", async () => {
    const bytes = zipEntries({
      "META-INF/container.xml": `<container><rootfiles><rootfile full-path="nope.opf"/></rootfiles></container>`,
    });
    await expectEpubError(processEpub(bytes), "not_epub");
  });

  it("refuses XML entity declarations", async () => {
    const bytes = zipEntries({
      "META-INF/container.xml": `<?xml version="1.0"?><!DOCTYPE c [<!ENTITY a "aaaaaaaa">]><container>&a;</container>`,
    });
    await expectEpubError(processEpub(bytes), "not_epub");
  });
});
