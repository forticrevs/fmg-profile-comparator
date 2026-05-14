"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type JinjaTemplateEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const JINJA_SEGMENT_RE = /({#[\s\S]*?#}|{{-?[\s\S]*?-?}}|{%-?[\s\S]*?-?%})/g;
const CLI_TOKEN_RE =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b|\b(?:append|clone|config|delete|diagnose|edit|end|execute|get|move|next|purge|rename|select|set|show|unset)\b)/g;
const JINJA_TOKEN_RE =
  /(\s+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w]*|==|!=|>=|<=|\/\/|\*\*|[|.()[\]{},:=+\-*/%<>!~])/g;

const JINJA_KEYWORDS = new Set([
  "and",
  "as",
  "block",
  "call",
  "defined",
  "do",
  "elif",
  "else",
  "endblock",
  "endcall",
  "endfilter",
  "endfor",
  "endif",
  "endmacro",
  "endraw",
  "endset",
  "endwith",
  "extends",
  "false",
  "filter",
  "for",
  "from",
  "if",
  "ignore",
  "import",
  "in",
  "include",
  "is",
  "macro",
  "none",
  "not",
  "or",
  "raw",
  "recursive",
  "set",
  "true",
  "with",
  "without",
]);

const JINJA_GLOBALS = new Set([
  "DVMDB",
  "DEVDB",
  "ADOM",
  "DEVICE",
  "FOS",
  "METADATA",
  "LOOP",
  "loop",
]);

const INDENT = "    ";

export default function JinjaTemplateEditor({
  value,
  onChange,
  disabled = false,
}: JinjaTemplateEditorProps) {
  const [focused, setFocused] = useState(false);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });

  const highlighted = useMemo(() => highlightTemplate(value), [value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();

    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = event.shiftKey
      ? unindentSelection(value, start, end)
      : indentSelection(value, start, end);

    onChange(next.value);
    requestAnimationFrame(() => {
      target.setSelectionRange(next.start, next.end);
    });
  };

  return (
    <div
      className={`relative mt-3 h-[520px] min-h-[320px] w-full resize-y overflow-hidden rounded-md border bg-slate-950 ${
        focused ? "border-cyan-600 shadow-[0_0_0_1px_rgba(8,145,178,0.35)]" : "border-slate-800"
      }`}
    >
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <pre
          className="min-h-full min-w-full whitespace-pre p-4 font-mono text-[12px] leading-relaxed text-slate-200"
          style={{
            tabSize: 4,
            transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
          }}
        >
          <code>{highlighted}</code>
        </pre>
      </div>
      <textarea
        aria-label="Jinja CLI template editor"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onScroll={(event) => {
          setScroll({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          });
        }}
        disabled={disabled}
        spellCheck={false}
        wrap="off"
        className="absolute inset-0 z-10 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-[12px] leading-relaxed text-transparent caret-cyan-200 outline-none selection:bg-cyan-500/30 selection:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ tabSize: 4 }}
      />
    </div>
  );
}

function highlightTemplate(template: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of template.matchAll(JINJA_SEGMENT_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(...highlightCli(template.slice(cursor, index), `cli-${key++}`));
    }
    nodes.push(...highlightJinja(match[0], `jinja-${key++}`));
    cursor = index + match[0].length;
  }

  if (cursor < template.length) {
    nodes.push(...highlightCli(template.slice(cursor), `cli-${key++}`));
  }

  if (template.endsWith("\n")) {
    nodes.push(<span key="trailing-space"> </span>);
  }

  return nodes;
}

function highlightCli(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(CLI_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    const token = match[0];
    nodes.push(
      <span key={`${keyPrefix}-${key++}`} className={cliTokenClass(token)}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function highlightJinja(segment: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  const open = segment.match(/^({[{%#]-?)/)?.[1] ?? segment.slice(0, 2);
  const close = segment.match(/(-?[}%#]})$/)?.[1] ?? segment.slice(-2);
  const body = segment.slice(open.length, segment.length - close.length);

  nodes.push(
    <span key={`${keyPrefix}-open`} className="font-semibold text-cyan-300">
      {open}
    </span>,
  );

  if (open.startsWith("{#")) {
    nodes.push(
      <span key={`${keyPrefix}-comment`} className="italic text-slate-500">
        {body}
      </span>,
    );
  } else {
    nodes.push(...highlightJinjaBody(body, `${keyPrefix}-body-${key++}`));
  }

  nodes.push(
    <span key={`${keyPrefix}-close`} className="font-semibold text-cyan-300">
      {close}
    </span>,
  );

  return nodes;
}

function highlightJinjaBody(body: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let expectFilter = false;

  for (const match of body.matchAll(JINJA_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(body.slice(cursor, index));
    }

    const token = match[0];
    if (/^\s+$/.test(token)) {
      nodes.push(token);
    } else {
      const tokenClass = jinjaTokenClass(token, expectFilter);
      nodes.push(
        <span key={`${keyPrefix}-${key++}`} className={tokenClass}>
          {token}
        </span>,
      );
    }

    if (token === "|") {
      expectFilter = true;
    } else if (!/^\s+$/.test(token)) {
      expectFilter = false;
    }

    cursor = index + token.length;
  }

  if (cursor < body.length) {
    nodes.push(body.slice(cursor));
  }

  return nodes;
}

function cliTokenClass(token: string) {
  if (token.startsWith("\"") || token.startsWith("'")) return "text-amber-200";
  if (/^\d{1,3}(?:\.\d{1,3}){3}/.test(token)) return "text-sky-300";
  return "font-semibold text-blue-300";
}

function jinjaTokenClass(token: string, expectFilter: boolean) {
  if (token.startsWith("\"") || token.startsWith("'")) return "text-amber-200";
  if (/^\d/.test(token)) return "text-sky-300";
  if (expectFilter) return "font-semibold text-teal-300";
  if (JINJA_KEYWORDS.has(token.toLowerCase())) return "font-semibold text-fuchsia-300";
  if (JINJA_GLOBALS.has(token) || /^[A-Z][A-Z0-9_]*$/.test(token)) return "text-violet-300";
  if (/^[A-Za-z_]\w*$/.test(token)) return "text-slate-100";
  if (token === "|") return "font-semibold text-teal-300";
  return "text-cyan-200";
}

function indentSelection(value: string, start: number, end: number) {
  if (start === end) {
    return {
      value: `${value.slice(0, start)}${INDENT}${value.slice(end)}`,
      start: start + INDENT.length,
      end: end + INDENT.length,
    };
  }

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const selected = value.slice(lineStart, end);
  const replacement = selected.replace(/^/gm, INDENT);

  return {
    value: `${value.slice(0, lineStart)}${replacement}${value.slice(end)}`,
    start: start + INDENT.length,
    end: end + replacement.length - selected.length,
  };
}

function unindentSelection(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const selected = value.slice(lineStart, end);
  let removedBeforeStart = 0;
  let removedTotal = 0;
  let offset = 0;

  const replacement = selected
    .split("\n")
    .map((line) => {
      const absoluteLineStart = lineStart + offset;
      offset += line.length + 1;
      const indent = line.match(/^( {1,4}|\t)/)?.[0] ?? "";
      if (!indent) return line;

      if (absoluteLineStart < start) {
        removedBeforeStart += Math.min(indent.length, start - absoluteLineStart);
      }
      if (absoluteLineStart < end) {
        removedTotal += indent.length;
      }
      return line.slice(indent.length);
    })
    .join("\n");

  return {
    value: `${value.slice(0, lineStart)}${replacement}${value.slice(end)}`,
    start: Math.max(lineStart, start - removedBeforeStart),
    end: Math.max(lineStart, end - removedTotal),
  };
}
