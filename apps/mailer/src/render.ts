import type { EmailMessage } from "./message";
import type { OutgoingEmail } from "./sender";

// Turns a queue message into the email a provider sends. The link expires after 15 minutes
// (ARCHITECTURE, Auth).
export function render(message: EmailMessage, from: string): OutgoingEmail {
  return {
    from,
    to: message.to,
    subject: "Your sign-in link for rarepair",
    text: `Use this link to sign in. It works once and expires in 15 minutes.\n\n${message.url}\n\nIf you didn't ask to sign in, you can ignore this email.\n`,
  };
}
