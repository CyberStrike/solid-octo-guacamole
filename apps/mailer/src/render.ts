import type { EmailMessage } from "./message";
import type { OutgoingEmail } from "./sender";

// Turns a queue message into the email a provider sends. The link expires after 15 minutes
// (ARCHITECTURE, Auth).
export function render(message: EmailMessage, from: string): OutgoingEmail {
  return {
    from,
    to: message.to,
    subject: "Your sign-in link for rarepair",
    text: `Use this link to sign in. It works once, and only for 15 minutes after you asked for it.\n\n${message.url}\n\nIf you didn't ask to sign in, you can ignore this email.\n`,
  };
}
