const REDACTED_TEXT_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type RedactedSensitiveTextModelInput = {
  readonly value: string | null | undefined;
  readonly revealed: boolean;
  readonly ariaLabel: string;
  readonly revealTooltip: string;
  readonly hideTooltip: string;
};

export type RedactedSensitiveTextModel = {
  readonly text: string;
  readonly revealed: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
};

function redactedPlaceholder(value: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }

  const nextChar = () => {
    state = Math.imul(state ^ (state >>> 13), 0x85ebca6b);
    state = Math.imul(state ^ (state >>> 16), 0xc2b2ae35);
    return REDACTED_TEXT_ALPHABET[Math.abs(state) % REDACTED_TEXT_ALPHABET.length] ?? "x";
  };

  return Array.from(value, (char) => {
    if (char === "@" || char === "." || char === "-" || char === "_") return char;
    return nextChar();
  }).join("");
}

export function buildRedactedSensitiveTextModel(
  input: RedactedSensitiveTextModelInput,
): RedactedSensitiveTextModel | null {
  const value = input.value?.trim();
  if (!value) return null;
  return {
    text: input.revealed ? value : redactedPlaceholder(value),
    revealed: input.revealed,
    ariaLabel: input.ariaLabel,
    tooltip: input.revealed ? input.hideTooltip : input.revealTooltip,
  };
}
