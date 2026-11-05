export type LocalTerminal = {
  readonly input: (data: string) => void;
};

const terminals = new Map<string, LocalTerminal>();

export function registerLocalTerminal(key: string, terminal: LocalTerminal): void {
  terminals.set(key, terminal);
}

export function localTerminal(key: string): LocalTerminal | undefined {
  return terminals.get(key);
}
