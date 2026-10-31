// The sign-in limits as wrangler.jsonc sets them: requests per IP and per email address in a
// window. Shared by the workerd tests and the Node test that checks them against the config.

export const LOGIN_IP_LIMIT = 10;
export const LOGIN_EMAIL_LIMIT = 3;
