// Reader settings (ARCHITECTURE, Reading): theme, size, line spacing and face, kept in
// a cookie and written as data-* attributes on <html>, which the stylesheet keys off.
// Pure, so it runs in Node: the routes are in settings.ts and the middleware that
// writes the attributes in page-state.ts.

/** Each setting and the values it may take, in the order they are written. */
export const SETTINGS = {
  theme: ["light", "dark", "sepia"],
  size: ["s", "m", "l", "xl"],
  leading: ["compact", "normal", "relaxed"],
  face: ["serif", "sans"],
} as const;

export type SettingName = keyof typeof SETTINGS;
export type Settings = { [K in SettingName]?: (typeof SETTINGS)[K][number] };

// SAFETY: the keys of SETTINGS, which Object.keys types only as string.
export const SETTING_NAMES = Object.keys(SETTINGS) as SettingName[];

/**
 * Whether `value` is one `name` may take. A plain lookup in the lists above, so a
 * value from a cookie or a form is never written anywhere unless it is one of them.
 */
export const isSettingValue = <K extends SettingName>(
  name: K,
  value: string | null | undefined,
): value is (typeof SETTINGS)[K][number] =>
  (SETTINGS[name] as readonly string[]).includes(value ?? "");

/**
 * The settings cookie's name. `__Host-`: Secure, Path=/ and no Domain, so it never
 * reaches the content origin. Not HttpOnly: the settings script writes it, and it holds
 * only the display values above, nothing that identifies anyone.
 */
export const SETTINGS_COOKIE = "__Host-reader";
// A year, renewed whenever the reader changes something. The script writes the same.
export const SETTINGS_COOKIE_ATTRIBUTES = "; Max-Age=31536000; Path=/; SameSite=Lax; Secure";

/**
 * The settings a cookie value holds, such as `theme=dark&size=l`. Unknown keys and any
 * value outside its list are dropped; of a repeated key, the first is kept.
 */
export function parseSettings(value: string | undefined): Settings {
  const settings: Settings = {};
  if (!value) return settings;
  const fields = new URLSearchParams(value);
  for (const name of SETTING_NAMES) {
    const field = fields.get(name);
    // SAFETY: isSettingValue has checked the value is in this setting's list.
    if (isSettingValue(name, field)) (settings as Record<string, string>)[name] = field;
  }
  return settings;
}

/** The cookie's value: each setting that is set, as `name=value`, in a fixed order. */
const serializeSettings = (settings: Settings) =>
  SETTING_NAMES.flatMap((name) => {
    const value = settings[name];
    return isSettingValue(name, value) ? [`${name}=${value}`] : [];
  }).join("&");

/** The whole `Set-Cookie` value that stores `settings`. */
export const settingsCookie = (settings: Settings) =>
  `${SETTINGS_COOKIE}=${serializeSettings(settings)}${SETTINGS_COOKIE_ATTRIBUTES}`;

/**
 * The attributes for <html>, each with a leading space: only values from the lists,
 * so the cookie's own text is never echoed.
 */
export const htmlAttributes = (settings: Settings) =>
  SETTING_NAMES.map((name) => {
    const value = settings[name];
    return isSettingValue(name, value) ? ` data-${name}="${value}"` : "";
  }).join("");

/**
 * The one-shot flash cookie: a code from FLASHES, never copy or markup, so a forged
 * cookie can show nothing but our own sentences. HttpOnly, since no script reads it.
 */
export const FLASH_COOKIE = "__Host-flash";
const FLASH_ATTRIBUTES = "; Path=/; SameSite=Lax; Secure; HttpOnly";

// Draft copy for the operator to proof.
const FLASHES = new Map([["settings-saved", "Reader settings saved."]]);
export type FlashCode = "settings-saved";

/** The copy for a flash code, or null for any code not in the table. */
export const flashMessage = (code: string | undefined) =>
  (code === undefined ? undefined : FLASHES.get(code)) ?? null;

/** Sets the flash for the page a redirect lands on, for a minute at most. */
export const flashCookie = (code: FlashCode) =>
  `${FLASH_COOKIE}=${code}; Max-Age=60${FLASH_ATTRIBUTES}`;

/** Clears the flash once a page has shown it. A `__Host-` cookie is cleared only with the same attributes. */
export const CLEAR_FLASH_COOKIE = `${FLASH_COOKIE}=; Max-Age=0${FLASH_ATTRIBUTES}`;
