# Good and bad tests

## Good tests

**Integration-style:** test through the seam, with real collaborators and the runtime's real bindings.

```typescript
// GOOD: a scenario case, through the library's export, with literals from its THEN lines
const oneChapter = (body: string) =>
  ao3Epub({
    files: [{
      name: "x_split_001.xhtml",
      body: `<div id="chapters" class="userstuff1"><h2 class="toc-heading">One</h2>
<div class="userstuff2">${body}</div></div>`,
    }],
  });

describe("07 sanitizing and images", () => {
  it("Dangerous elements are dropped", async () => {
    const epub = oneChapter("<p>kept</p><script>alert(1)</script><svg><p>inside</p></svg>");
    const { chapters } = await processEpub(epub);
    expect(chapters[0].html).not.toMatch(/<script|<svg/);
    expect(chapters[0].html).not.toContain("inside");
    expect(chapters[0].html).toContain("kept");
  });
});
```

```typescript
// GOOD: a Worker's HTTP surface, as a browser would reach it
it("POST /login refuses a cross-site origin", async () => {
  const res = await worker.fetch("https://archive.test/login", {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    body: new URLSearchParams({ email: "reader@example.test" }),
  });
  expect(res.status).toBe(403);
});
```

Characteristics:

- Tests behaviour a reader, uploader or moderator (or the next Worker in the pipeline) cares about
- Uses the seam only
- Survives internal refactors
- Named for the scenario case: what, not how
- One logical assertion per test: one case's THEN, however many `expect` lines it takes

## Bad tests

**Implementation-detail tests:** coupled to internal structure.

```typescript
// BAD: asserts how the sanitizer is built, not what it outputs
it("uses the allowlist serializer", async () => {
  const spy = vi.spyOn(serializer, "write");
  await processEpub(epub);
  expect(spy).toHaveBeenCalledTimes(3);
});
```

Red flags:

- Mocking internal collaborators
- Testing private functions the notes didn't agree as a seam
- Asserting on call counts or order
- Breaks when refactoring without a behaviour change
- Named for how, not what
- Verifying through a side channel instead of the seam

```typescript
// BAD: the web Worker never promised this row; the session is what it promised
it("login confirm writes a session row", async () => {
  await worker.fetch(confirmUrl);
  const row = await env.DB.prepare("select * from session").first();
  expect(row).toBeDefined();
});

// GOOD: verifies through the interface: the cookie it set opens a signed-in page
it("Confirming a sign-in link starts a session", async () => {
  const res = await worker.fetch(confirmUrl, { redirect: "manual" });
  const cookie = res.headers.get("set-cookie")!;
  const page = await worker.fetch("https://archive.test/my/uploads", { headers: { cookie } });
  expect(page.status).toBe(200);
});
```

**Tautological tests:** the expected value restates the implementation, so the test passes by construction.

```typescript
// BAD: the expected count is recomputed the way the code counts
it("counts a chapter's words", async () => {
  const body = "<p>one two three</p><p>four five</p>";
  const { chapters } = await processEpub(oneChapter(body));
  expect(chapters[0].words).toBe(body.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length);
});

// GOOD: an independent, known literal
it("counts a chapter's words", async () => {
  const { chapters } = await processEpub(oneChapter("<p>one two three</p><p>four five</p>"));
  expect(chapters[0].words).toBe(5);
});
```

A snapshot accepted from the code's output is the same mistake at scale. Keep snapshots as a guard on everything else, and give each bullet its own literal assertion.
