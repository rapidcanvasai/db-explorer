import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

interface StatusBarProps {
  dbInfo: { host: string; database: string; env?: string } | null;
  tableCount: number;
  activeTable: string | null;
  activeTableRows: number | null | undefined;
  lastQuery: { rowCount: number; elapsedSeconds: number; ts: number } | null;
  errorText?: string | null;
}

function fmt(n: number | null | undefined): string {
  return n != null ? Number(n).toLocaleString() : '—';
}

export default function StatusBar({
  dbInfo, tableCount, activeTable, activeTableRows, lastQuery, errorText,
}: StatusBarProps) {
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await apiFetch('/api/info');
        if (!alive) return;
        setHealthy(r.ok);
      } catch {
        if (alive) setHealthy(false);
      }
    };
    ping();
    const id = window.setInterval(ping, 15000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const env = (dbInfo?.env ?? '?').toUpperCase();
  const envColor = env === 'PROD'
    ? 'text-red-500'
    : env === 'DEV' ? 'text-amber-500' : 'text-emerald-500';
  const dotColor = healthy == null
    ? 'bg-muted-foreground'
    : healthy ? 'bg-emerald-500' : 'bg-red-500';

  return (
    <div className="h-6 border-t bg-muted/40 px-3 flex items-center gap-4 text-[11px] font-mono text-muted-foreground shrink-0 select-none">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        {dbInfo ? (
          <>
            <span className="text-foreground font-medium">{dbInfo.database}</span>
            <span className="opacity-60">@</span>
            <span>{dbInfo.host}</span>
            <span className={`ml-1 font-semibold ${envColor}`}>{env}</span>
          </>
        ) : '...'}
      </span>
      <span className="opacity-50">·</span>
      <span>tables: <span className="text-foreground">{tableCount}</span></span>
      {activeTable && (
        <>
          <span className="opacity-50">·</span>
          <span>
            <span className="text-foreground">{activeTable}</span>: {fmt(activeTableRows)} rows
          </span>
        </>
      )}
      {lastQuery && (
        <>
          <span className="opacity-50">·</span>
          <span>
            last query: <span className="text-foreground">{fmt(lastQuery.rowCount)}</span> rows
            {' '}/ <span className="text-foreground">{lastQuery.elapsedSeconds.toFixed(3)}s</span>
          </span>
        </>
      )}
      {errorText && (
        <span className="ml-auto text-destructive truncate max-w-[40%]" title={errorText}>
          {errorText}
        </span>
      )}
    </div>
  );
}
