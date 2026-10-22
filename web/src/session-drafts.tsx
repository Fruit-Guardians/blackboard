import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Entry = { value: unknown; dirty: boolean };
type DraftStore = { entries: Map<string, Entry>; put: (key: string, value: unknown, dirty: boolean) => void };
const DraftContext = createContext<DraftStore | null>(null);

/** Private to this mounted workspace: drafts never enter browser storage or the event log. */
export function SessionDrafts({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState(() => new Map<string, Entry>());
  const latest = useRef(entries);
  latest.current = entries;
  const put = useCallback((key: string, value: unknown, dirty: boolean) => {
    setEntries((previous) => new Map(previous).set(key, { value, dirty }));
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (![...latest.current.values()].some((entry) => entry.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return <DraftContext.Provider value={{ entries, put }}>{children}</DraftContext.Provider>;
}

export function useSessionDraft<T>(key: string, initial: T) {
  const store = useContext(DraftContext);
  if (!store) throw new Error('SessionDrafts provider missing');
  const value = (store.entries.get(key)?.value as T | undefined) ?? initial;
  const set = (next: T, dirty: boolean) => store.put(key, next, dirty);
  return [value, set] as const;
}
