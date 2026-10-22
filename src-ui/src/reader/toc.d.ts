export function createToc(options: { article: HTMLElement; scrollContainer: HTMLElement; onActive: (id: string) => void }): { jump: (id: string) => void; destroy: () => void };
