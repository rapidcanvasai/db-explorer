import { useCallback, useState } from 'react';
import { Play, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SqlEditor from '@/components/SqlEditor';
import type { QueryTab } from '@/hooks/useQueryTabs';

interface Props {
  tabs: QueryTab[];
  activeTab: QueryTab | undefined;
  height: number;
  schemas: Record<string, string[]>;
  dark: boolean;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onSelectTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  onSqlChange: (id: string, sql: string) => void;
  onRun: () => void;
}

export default function QueryTabs({
  tabs, activeTab, height, schemas, dark,
  onAddTab, onCloseTab, onSelectTab, onRenameTab, onSqlChange, onRun,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const startRename = useCallback((id: string) => setEditingId(id), []);
  const finishRename = useCallback((id: string, name: string) => {
    onRenameTab(id, name);
    setEditingId(null);
  }, [onRenameTab]);

  if (!activeTab) return null;
  const isRunning = activeTab.isRunning;

  return (
    <div className="flex flex-col bg-background shrink-0">
      {/* Tab strip */}
      <div className="flex items-stretch border-b bg-muted/30 overflow-x-auto">
        {tabs.map(t => {
          const isActive = t.id === activeTab.id;
          return (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              onClick={() => onSelectTab(t.id)}
              onDoubleClick={() => startRename(t.id)}
              className={`group flex items-center gap-1.5 px-3 h-8 text-xs cursor-pointer border-r select-none whitespace-nowrap ${
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              {editingId === t.id ? (
                <input
                  autoFocus
                  defaultValue={t.name}
                  onBlur={e => finishRename(t.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') finishRename(t.id, (e.target as HTMLInputElement).value);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="bg-transparent border-b border-primary outline-none w-24 text-xs"
                />
              ) : (
                <span>{t.name}</span>
              )}
              {t.isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
              <button
                aria-label="Close tab"
                onClick={e => { e.stopPropagation(); onCloseTab(t.id); }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          onClick={onAddTab}
          aria-label="New tab"
          className="px-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 border-r"
          title="New tab (⌘T)"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3">
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={isRunning || !activeTab.sql.trim()}
            onClick={onRun}
          >
            {isRunning
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Play className="h-3 w-3" />}
            Run
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘↵</span>
        </div>
      </div>

      <SqlEditor
        value={activeTab.sql}
        onChange={v => onSqlChange(activeTab.id, v)}
        onRun={onRun}
        height={height}
        schemas={schemas}
        dark={dark}
        placeholder="-- Ctrl+Space for autocomplete, Cmd+Enter to run&#10;SELECT * FROM your_table LIMIT 10;"
      />
    </div>
  );
}
