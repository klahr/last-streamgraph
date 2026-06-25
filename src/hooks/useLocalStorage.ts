/**
 * A `useState`-shaped hook backed by localStorage, used to persist credentials
 * and viz config across reloads.
 */
import { useCallback, useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStored((prev) => {
        const next =
          typeof value === 'function'
            ? (value as (p: T) => T)(prev)
            : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Ignore quota / private-mode errors; state still updates in memory.
        }
        return next;
      });
    },
    [key],
  );

  return [stored, set];
}
