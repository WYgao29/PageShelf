import type { Item } from "../items";
export type Reading = {
  status: "reader" | "fallback"; reason?: string; site?: string;
  article: HTMLElement | null;
  toc: { id: string; level: number; text: string; element: HTMLElement }[];
  find: { readonly total: number; readonly current: number; next: (direction?: number) => number; destroy: () => void } | null;
};
export function buildReader(options: {
  item: Item; html?: string; markdown?: string; items?: Item[]; query?: string;
  onFindChange?: (position: number, total: number) => void;
}): Promise<Reading>;
