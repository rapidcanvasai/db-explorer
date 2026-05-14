import { useCallback, useEffect, useState } from 'react';
import type { QueryResponse } from './useExplorer';

export interface QueryTab {
  id: string;
  name: string;
  sql: string;
  result: QueryResponse | null;
  error: string | null;
  isRunning: boolean;
  lastRunAt: number | null;
}

const TABS_KEY = 'db-explorer:tabs';
const HISTORY_KEY = 'db-explorer:history';
const HISTORY_CAP = 100;

export interface HistoryEntry {
  id: string;
  sql: string;
  ts: number;
  rowCount: number;
  elapsedSeconds: number;
}

function newTab(idx = 1): QueryTab {
  return {
    id: crypto.randomUUID(),
    name: `Query ${idx}`,
    sql: '',
    result: null,
    error: null,
    isRunning: false,
    lastRunAt: null,
  };
}

function loadTabs(): { tabs: QueryTab[]; activeId: string } {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: { id: string; name: string; sql: string }[]; activeId: string };
      if (parsed.tabs?.length) {
        const tabs = parsed.tabs.map(t => ({
          id: t.id, name: t.name, sql: t.sql,
          result: null, error: null, isRunning: false, lastRunAt: null,
        }));
        return { tabs, activeId: parsed.activeId || tabs[0].id };
      }
    }
  } catch {
    /* ignore */
  }
  const t = newTab(1);
  return { tabs: [t], activeId: t.id };
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function useQueryTabs() {
  const [{ tabs, activeId }, setState] = useState(loadTabs);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // Persist tab structure (not transient result/error/isRunning).
  useEffect(() => {
    const slim = tabs.map(t => ({ id: t.id, name: t.name, sql: t.sql }));
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: slim, activeId }));
  }, [tabs, activeId]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

  const updateTab = useCallback((id: string, patch: Partial<QueryTab>) => {
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const addTab = useCallback((sql = '') => {
    setState(s => {
      const t = newTab(s.tabs.length + 1);
      t.sql = sql;
      return { tabs: [...s.tabs, t], activeId: t.id };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setState(s => {
      if (s.tabs.length === 1) {
        const t = newTab(1);
        return { tabs: [t], activeId: t.id };
      }
      const idx = s.tabs.findIndex(t => t.id === id);
      const remaining = s.tabs.filter(t => t.id !== id);
      const nextActive = s.activeId === id
        ? remaining[Math.max(0, idx - 1)].id
        : s.activeId;
      return { tabs: remaining, activeId: nextActive };
    });
  }, []);

  const renameTab = useCallback((id: string, name: string) => {
    updateTab(id, { name: name.trim() || 'Query' });
  }, [updateTab]);

  const setActive = useCallback((id: string) => {
    setState(s => ({ ...s, activeId: id }));
  }, []);

  const setSql = useCallback((id: string, sql: string) => {
    updateTab(id, { sql });
  }, [updateTab]);

  const recordHistory = useCallback((sql: string, response: QueryResponse) => {
    setHistory(h => {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        sql,
        ts: Date.now(),
        rowCount: response.row_count,
        elapsedSeconds: response.elapsed_seconds,
      };
      const next = [entry, ...h];
      return next.slice(0, HISTORY_CAP);
    });
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const loadIntoActiveTab = useCallback((sql: string) => {
    if (!activeTab) return;
    updateTab(activeTab.id, { sql });
  }, [activeTab, updateTab]);

  // Cmd/Ctrl shortcuts: T new, W close, 1..9 jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 't') { e.preventDefault(); addTab(); }
      else if (e.key === 'w') {
        if (activeTab) { e.preventDefault(); closeTab(activeTab.id); }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (tabs[idx]) { e.preventDefault(); setActive(tabs[idx].id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeTab, addTab, closeTab, setActive]);

  return {
    tabs, activeTab, activeId,
    addTab, closeTab, renameTab, setActive, setSql, updateTab,
    history, recordHistory, clearHistory, loadIntoActiveTab,
  };
}
