import { useEffect, useRef, useCallback } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { MySQL, sql } from '@codemirror/lang-sql';
import {
  autocompletion,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  height: number;
  schemas?: Record<string, string[]>;
  placeholder?: string;
  dark?: boolean;
}

const baseTheme = EditorView.theme({
  '&': { fontSize: '12px', fontFamily: 'ui-monospace, monospace', height: '100%' },
  '.cm-content': { padding: '8px 16px', minHeight: '100%' },
  '.cm-gutters': { display: 'none' },
  '.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-tooltip-autocomplete': { fontSize: '11px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'hsl(var(--primary))',
    color: 'hsl(var(--primary-foreground))',
  },
});

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'CURDATE', 'CURTIME',
  'DATE', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMESTAMPDIFF',
  'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE',
  'COALESCE', 'IFNULL', 'NULLIF', 'IF', 'CASE',
  'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'LENGTH', 'CHAR_LENGTH',
  'LOWER', 'UPPER', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE',
  'ROUND', 'CEIL', 'FLOOR', 'ABS', 'MOD',
  'CAST', 'CONVERT', 'GROUP_CONCAT', 'JSON_EXTRACT', 'JSON_OBJECT',
];

const SQL_KEYWORDS_AFTER_DOT_SAFE = /^[A-Za-z_][\w]*$/;

const FUNCTION_COMPLETIONS: Completion[] = SQL_FUNCTIONS.map(fn => ({
  label: fn,
  type: 'function',
  apply: `${fn}()`,
  boost: 5,
}));

const SNIPPET_COMPLETIONS: Completion[] = [
  snippetCompletion('SELECT * FROM ${table} LIMIT ${100};', {
    label: 'selstar', detail: 'select all', type: 'keyword', boost: 10,
  }),
  snippetCompletion('SELECT COUNT(*) FROM ${table};', {
    label: 'cnt', detail: 'count rows', type: 'keyword', boost: 10,
  }),
  snippetCompletion('JOIN ${table} ${alias} ON ${alias}.${col} = ${other}.${col}', {
    label: 'joinon', detail: 'inner join', type: 'keyword', boost: 10,
  }),
  snippetCompletion('SELECT ${cols}\nFROM ${table}\nWHERE ${cond}\nORDER BY ${col} DESC\nLIMIT ${100};', {
    label: 'sel', detail: 'select template', type: 'keyword', boost: 10,
  }),
];

interface ParsedRef { table: string; alias: string }

function currentStatement(text: string): string {
  // Slice to the text after the last top-level `;`, respecting quoted strings
  // so a `;` inside a literal doesn't split.
  let lastSemi = -1;
  let q: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q && text[i - 1] !== '\\') q = null;
    } else if (c === "'" || c === '"' || c === '`') {
      q = c;
    } else if (c === ';') {
      lastSemi = i;
    }
  }
  return lastSemi >= 0 ? text.slice(lastSemi + 1) : text;
}

function parseTableRefs(doc: string): ParsedRef[] {
  // Pulls `FROM tbl` / `JOIN tbl alias` / `FROM tbl AS alias`.
  const refs: ParsedRef[] = [];
  const re = /\b(?:from|join|update|into)\s+`?([A-Za-z_][\w]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][\w]*)`?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    const table = m[1];
    const alias = m[2];
    // Skip SQL keywords that could appear as a 2nd token (WHERE, ON, etc.)
    const reserved = new Set(['where', 'on', 'inner', 'left', 'right', 'cross', 'join', 'group', 'order', 'limit', 'using', 'set', 'values']);
    refs.push({
      table,
      alias: alias && !reserved.has(alias.toLowerCase()) ? alias : table,
    });
  }
  return refs;
}

function makeContextSource(getSchemas: () => Record<string, string[]>) {
  return (context: CompletionContext): CompletionResult | null => {
    const schemas = getSchemas();
    const tableNames = Object.keys(schemas);
    if (tableNames.length === 0) return null;

    const before = context.state.doc.sliceString(0, context.pos);
    const stmt = currentStatement(before);
    const word = context.matchBefore(/[\w]*/);
    if (!word) return null;

    // Case A: <alias>. or <table>.<word>
    const dotMatch = before.match(/([A-Za-z_][\w]*)\.([\w]*)$/);
    if (dotMatch) {
      const prefix = dotMatch[1];
      const refs = parseTableRefs(stmt);
      // Match by alias first, then by table name
      const ref = refs.find(r => r.alias.toLowerCase() === prefix.toLowerCase())
        || refs.find(r => r.table.toLowerCase() === prefix.toLowerCase());
      const tbl = ref ? ref.table : tableNames.find(t => t.toLowerCase() === prefix.toLowerCase());
      if (tbl && schemas[tbl]) {
        const from = context.pos - dotMatch[2].length;
        return {
          from,
          options: schemas[tbl].map(c => ({
            label: c, type: 'property', boost: 50,
          })),
          validFor: SQL_KEYWORDS_AFTER_DOT_SAFE,
        };
      }
      return null;
    }

    // Case B: after FROM/JOIN/UPDATE/INTO → tables only
    if (/\b(?:from|join|update|into)\s+`?[\w]*$/i.test(stmt)) {
      return {
        from: context.pos - word.text.length,
        options: tableNames.map(t => ({
          label: t, type: 'class', boost: 30,
        })),
        validFor: SQL_KEYWORDS_AFTER_DOT_SAFE,
      };
    }

    // Case C: column-position keywords (SELECT/WHERE/ON/GROUP BY/ORDER BY)
    // → only columns from FROM/JOIN tables of the CURRENT statement, + functions.
    const colCtx = /\b(?:select|where|on|and|or|by|having|set|,)\s+[\w`. ]*$/i.test(stmt);
    if (colCtx) {
      const refs = parseTableRefs(stmt);
      if (refs.length === 0) {
        return {
          from: context.pos - word.text.length,
          options: [...SNIPPET_COMPLETIONS, ...FUNCTION_COMPLETIONS],
          validFor: SQL_KEYWORDS_AFTER_DOT_SAFE,
        };
      }
      const seen = new Set<string>();
      const opts: Completion[] = [];
      for (const r of refs) {
        const cols = schemas[r.table];
        if (!cols) continue;
        for (const c of cols) {
          if (seen.has(c)) continue;
          seen.add(c);
          opts.push({ label: c, type: 'property', boost: 40 });
        }
      }
      for (const f of FUNCTION_COMPLETIONS) opts.push(f);
      return {
        from: context.pos - word.text.length,
        options: opts,
        validFor: SQL_KEYWORDS_AFTER_DOT_SAFE,
      };
    }

    // Case D: bare word at statement start → snippets + keywords
    if (word.text.length > 0) {
      const opts: Completion[] = [...SNIPPET_COMPLETIONS, ...FUNCTION_COMPLETIONS];
      return {
        from: context.pos - word.text.length,
        options: opts,
        validFor: SQL_KEYWORDS_AFTER_DOT_SAFE,
      };
    }

    return null;
  };
}

export default function SqlEditor({ value, onChange, onRun, height, schemas, placeholder, dark }: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sqlCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const schemasRef = useRef<Record<string, string[]>>(schemas ?? {});
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  schemasRef.current = schemas ?? {};

  const runKeymap = useCallback(() => Prec.highest(keymap.of([{
    key: 'Mod-Enter',
    preventDefault: true,
    run: () => { onRunRef.current(); return true; },
  }])), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        runKeymap(),
        sqlCompartment.current.of(
          sql({ dialect: MySQL, schema: schemasRef.current, upperCaseKeywords: true })
        ),
        autocompletion({
          defaultKeymap: true,
          override: [makeContextSource(() => schemasRef.current)],
        }),
        baseTheme,
        themeCompartment.current.of(dark ? oneDark : []),
        cmPlaceholder(placeholder ?? ''),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => { view.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!viewRef.current || !schemas) return;
    viewRef.current.dispatch({
      effects: sqlCompartment.current.reconfigure(
        sql({ dialect: MySQL, schema: schemas, upperCaseKeywords: true })
      ),
    });
  }, [schemas]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(dark ? oneDark : []),
    });
  }, [dark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto border-b bg-background"
      style={{ height }}
    />
  );
}
