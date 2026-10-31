import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/message";
import { parseForQueue } from "../src/queues";
import { render } from "../src/render";

const FROM = "rarepair <sign-in@mail.example.test>";
const TO = "reader@example.test";
const UNSUBSCRIBE = "https://rarepair.fans/waitlist/unsubscribe?token=abc_DEF-123";

const launch = (url: string) => ({ kind: "waitlist-launch", to: TO, url });

describe("the launch email's message contract", () => {
  it("accepts a launch email linking to /waitlist/unsubscribe with a token", () => {
    expect(parseMessage(launch(UNSUBSCRIBE))).toEqual({
      kind: "waitlist-launch",
      to: TO,
      url: UNSUBSCRIBE,
    });
  });

  it.each([
    ["the confirm path", "https://rarepair.fans/waitlist/confirm?token=abc"],
    ["another host", "https://evil.example/waitlist/unsubscribe?token=abc"],
    ["www", "https://www.rarepair.fans/waitlist/unsubscribe?token=abc"],
    ["http", "http://rarepair.fans/waitlist/unsubscribe?token=abc"],
    ["user info", "https://evil.example@rarepair.fans/waitlist/unsubscribe?token=abc"],
    ["a fragment", "https://rarepair.fans/waitlist/unsubscribe?token=abc#more"],
    ["a longer path", "https://rarepair.fans/waitlist/unsubscribe/x?token=abc"],
    ["no token", "https://rarepair.fans/waitlist/unsubscribe"],
    ["an empty token", "https://rarepair.fans/waitlist/unsubscribe?token="],
    ["another parameter too", "https://rarepair.fans/waitlist/unsubscribe?token=abc&x=1"],
    ["a token that isn't base64url", "https://rarepair.fans/waitlist/unsubscribe?token=a%40b"],
  ])("refuses a launch email linking to %s", (_name, url) => {
    expect(parseMessage(launch(url))).toBeNull();
  });

  it("refuses a launch email to an address the mailer won't send to", () => {
    expect(parseMessage({ ...launch(UNSUBSCRIBE), to: "A <a@example.test>" })).toBeNull();
  });
});

describe("rendering the launch email", () => {
  it("opens with the archive's arrival and carries the unsubscribe link in the body", () => {
    const email = render({ kind: "waitlist-launch", to: TO, url: UNSUBSCRIBE }, FROM);

    expect(email.from).toBe(FROM);
    expect(email.to).toBe(TO);
    expect(email.subject).toBe("rarepair is open");
    expect(email.text).toContain(UNSUBSCRIBE);
    expect(email.text).toContain("https://rarepair.fans/\n");
  });
});

describe("what each queue accepts", () => {
  const signIn = { kind: "sign-in", to: TO, url: "https://rarepair.fans/login/confirm?token=a" };
  const confirm = {
    kind: "waitlist-confirm",
    to: TO,
    url: "https://rarepair.fans/waitlist/confirm?token=a",
  };

  it("sends sign-in and confirmation emails from `email` only", () => {
    expect(parseForQueue("email", signIn)).not.toBeNull();
    expect(parseForQueue("email", confirm)).not.toBeNull();
    expect(parseForQueue("email", launch(UNSUBSCRIBE))).toBeNull();
  });

  it("sends launch emails from `email-bulk` only, so nothing skips the pacing", () => {
    expect(parseForQueue("email-bulk", launch(UNSUBSCRIBE))).not.toBeNull();
    expect(parseForQueue("email-bulk", signIn)).toBeNull();
    expect(parseForQueue("email-bulk", confirm)).toBeNull();
  });

  it("accepts nothing from a queue it doesn't know", () => {
    expect(parseForQueue("somewhere-else", signIn)).toBeNull();
  });
});
