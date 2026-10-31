// Stands in for wrangler in scripts/r2-bucket-rules.test.mjs, so no test reaches Cloudflare.
// Appends one JSON line per call to $STUB_LOG: the arguments, the parsed --file when there is one
// (the script deletes its file once wrangler returns), and the directory it ran in. Exits 1 when
// the arguments start with $STUB_FAIL; otherwise prints a line naming the call, as a list would
// print the rules.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--file");
const file = at === -1 ? null : JSON.parse(readFileSync(args[at + 1] ?? "", "utf8"));
appendFileSync(
  process.env.STUB_LOG ?? "",
  `${JSON.stringify({ args, file, cwd: process.cwd() })}\n`,
);
const fail = process.env.STUB_FAIL;
if (fail && args.join(" ").startsWith(fail)) {
  console.error(`stub: ${fail} failed`);
  process.exit(1);
}
console.log(`stub ran: ${args.join(" ")}`);
