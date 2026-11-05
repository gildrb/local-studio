export const PROMPT_PREVIEW_TEXT =
  "Use $frontend-design to fix the flaky test in " +
  "[surface.test.ts](apps/web/src/terminal/ghostty/surface.test.ts) and align the header with " +
  "[SettingsPanels.tsx](apps/web/src/components/settings/SettingsPanels.tsx) before shipping.";

export const DIFF_PREVIEW_PATCH = [
  "diff --git a/src/formatUser.ts b/src/formatUser.ts",
  "--- a/src/formatUser.ts",
  "+++ b/src/formatUser.ts",
  "@@ -1,3 +1,3 @@",
  " export function formatUser(user: User) {",
  "-  return user.name.toUpperCase();",
  "+  return `${user.name} <${user.email}>`; // 0O 1lI",
  " }",
  "",
].join("\n");

export const TERMINAL_PROMPT =
  "\x1b[1;32m→\x1b[0m \x1b[1;36mt3code\x1b[0m \x1b[1;34mgit:(\x1b[1;31mmain\x1b[1;34m)\x1b[0m \x1b[1;33m✗\x1b[0m ";

export const TERMINAL_PREVIEW_TRANSCRIPT =
  `${TERMINAL_PROMPT}vpr dev\r\n` +
  "\r\n" +
  "  \x1b[1;32mVITE\x1b[0m \x1b[32mv7.1.1\x1b[0m  \x1b[2mready in\x1b[0m \x1b[1m1.24s\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[32m→\x1b[0m  \x1b[2mLocal:\x1b[0m    \x1b[4;36mhttp://127.0.0.1:5173/\x1b[0m\r\n" +
  "  \x1b[32m→\x1b[0m  \x1b[2mNetwork:\x1b[0m  \x1b[4;36mhttp://192.168.1.24:5173/\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[32m✓ 85 passed\x1b[0m   \x1b[33m△ 2 warnings\x1b[0m   \x1b[31m✗ 0 failed\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[42;30m READY \x1b[0m \x1b[2mwatching for changes — press\x1b[0m \x1b[1mq\x1b[0m \x1b[2mto quit\x1b[0m\r\n" +
  "\r\n" +
  TERMINAL_PROMPT;

export type TerminalPreviewFont = { readonly family?: string; readonly size: number };

export type TerminalPreviewEcho = {
  readonly write: string | null;
  readonly lineLength: number;
};

export function previewTerminalFont(family: string, size: number): TerminalPreviewFont {
  const trimmed = family.trim();
  return trimmed.length > 0 ? { family: trimmed, size } : { size };
}

export function resolveTerminalPreviewEcho(data: string, lineLength: number): TerminalPreviewEcho {
  if (data === "\r") return { write: `\r\n${TERMINAL_PROMPT}`, lineLength: 0 };
  if (data === "\x7f" || data === "\b") {
    return lineLength > 0
      ? { write: "\b \b", lineLength: lineLength - 1 }
      : { write: null, lineLength };
  }
  if (data.startsWith("\x1b")) return { write: null, lineLength };
  const printable = [...data]
    .filter((character) => character >= " " && character !== "\x7f")
    .join("");
  if (printable.length === 0) return { write: null, lineLength };
  return { write: printable, lineLength: lineLength + printable.length };
}
