import { createDb } from "@archive/db";
import { seedWork } from "@archive/db/seed";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchW } from "./helpers";

// One database serves every test file in the run, so this file keeps to AO3 work
// IDs 12500 to 12599, names every tag it seeds with an "x4-" prefix, and finds its
// reports by its own reporters. Text is synthetic.
const W = 12500;

const X4_TAGS = [
  { type: "rating", name: "x4-General Audiences" },
  { type: "fandom", name: "x4-Fandom" },
] as const;

const db = createDb({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });

beforeAll(async () => {
  await seedWork(db, { ao3WorkId: W, title: "x4 Work W", tags: [...X4_TAGS] });
});
afterAll(() => db.destroy());

describe("17-reports-and-dmca", () => {
  it("Every work has a report button", async () => {
    const res = await fetchW(`/works/${W}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`<a href="/works/${W}/report">Report</a>`);
  });
});
