import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'db-explorer:dark-mode';

function readInitial(): boolean {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved != null) return saved === '1';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(readInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    localStorage.setItem(STORAGE_KEY, dark ? '1' : '0');
  }, [dark]);

  const toggle = useCallback(() => setDark(d => !d), []);
  return [dark, toggle];
}
