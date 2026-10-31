import type { EmailMessage } from "./message";
import type { OutgoingEmail } from "./sender";

// Turns a queue message into the email a provider sends. A sign-in link expires after 15
// minutes (ARCHITECTURE, Auth); a wait list link after 7 days (ARCHITECTURE, Wait list).
export function render(message: EmailMessage, from: string): OutgoingEmail {
  switch (message.kind) {
    case "sign-in":
      return {
        from,
        to: message.to,
        subject: "Your sign-in link for rarepair",
        text: `Use this link to sign in. It works once, and only for 15 minutes after you asked for it.\n\n${message.url}\n\nIf you didn't ask to sign in, you can ignore this email.\n`,
      };
    case "waitlist-confirm":
      return {
        from,
        to: message.to,
        subject: "Confirm your place on the rarepair wait list",
        text: `Use this link to confirm your address for the rarepair wait list. It works once, for up to 7 days. A newer confirmation email replaces it.\n\n${message.url}\n\nOnce you confirm, you'll get one email when the archive opens, and nothing else.\n\nIf you didn't ask to join, you can ignore this email.\n`,
      };
  }
}
