// The launch wait list, from ARCHITECTURE's Data model and Wait list. The
// address is trimmed and lowercased before it is stored, so it is the key a
// repeat join meets. Tokens are stored only as hashes. `confirm_count` counts
// the confirmation emails sent, for the rule of 3 in all; `confirm_sent_at`
// is the latest one's time, for the rule of one an hour and the 7 days a link
// lasts. No IP address, user agent or referrer. The rows are deleted after
// launch. Add-only: never edit this file once merged.
export default /* sql */ `
create table "waitlist" (
  "email" text not null primary key,
  "confirm_token_hash" text,
  "confirm_sent_at" timestamptz not null default current_timestamp,
  "confirm_count" integer not null default 1,
  "confirmed_at" timestamptz,
  "notified_at" timestamptz,
  "unsubscribe_token_hash" text,
  "created_at" timestamptz not null default current_timestamp
);

-- A confirmation or unsubscribe link finds its row by the token's hash.
create unique index "waitlist_confirm_token_hash_key" on "waitlist" ("confirm_token_hash");
create unique index "waitlist_unsubscribe_token_hash_key" on "waitlist" ("unsubscribe_token_hash");
`;
