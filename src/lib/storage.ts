import { useCallback, useEffect, useState } from 'react';
import type { Identifiable } from '../types';

/**
 * A tiny localStorage-backed collection hook providing CRUD helpers.
 * Replace with API calls when a backend is introduced — the component API stays the same.
 */
export function useCollection<T extends Identifiable>(storageKey: string, seed: T[]) {
  const [items, setItems] = useState<T[]>(() => {
    if (typeof window === 'undefined') return seed;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T[]) : seed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // storage may be unavailable (private mode / quota) — keep working in-memory.
    }
  }, [storageKey, items]);

  const add = useCallback((item: T) => {
    setItems((current) => [item, ...current]);
  }, []);

  const update = useCallback((id: string, patch: Partial<T>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const replaceAll = useCallback((next: T[]) => {
    setItems(next);
  }, []);

  return { items, add, update, remove, replaceAll };
}
