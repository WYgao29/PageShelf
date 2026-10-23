export const COMMANDS: readonly { id: string; label: string; key: string; accelerator?: string; menu: string }[];
export function commandForInput(input: { type: string; alt?: boolean; shift?: boolean; meta?: boolean; control?: boolean; key: string }, platform?: string): string | null;
