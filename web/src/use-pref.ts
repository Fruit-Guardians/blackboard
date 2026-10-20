import { useEffect, useState } from 'react';

/** A boolean/string UI preference remembered per browser; safe when storage is blocked. */
export function usePref<T>(key: string, initial: T) {
  const storageKey = `blackboard-pref-${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* ignore */ }
    return initial;
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* ignore */ }
  }, [storageKey, value]);
  return [value, setValue] as const;
}
