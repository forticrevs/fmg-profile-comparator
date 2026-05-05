"use client";

/**
 * ChatWidget — persistent floating chat panel with markdown rendering
 * and drag-to-resize.
 *
 * Lives in the root layout so it survives page navigation. Panel is
 * anchored to the bottom-right corner; drag the top-left corner or
 * edges to resize. Size persists in localStorage.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { authFetch, API_BASE } from "@/lib/api";
import {
  useChatContext,
  type ChatContextItem,
  type ChatPageContext,
} from "@/components/ChatContext";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  kind: string;
  model: string;
  enabled: boolean;
  has_api_key: boolean;
}

/* ------------------------------------------------------------------ */
/* Size persistence                                                    */
/* ------------------------------------------------------------------ */

const MIN_W = 380;
const MIN_H = 420;
const MAX_W = 1000;
const MAX_H = 960;
const DEFAULT_W = 480;
const DEFAULT_H = 620;

function loadSize(): { w: number; h: number } {
  if (typeof window === "undefined") return { w: DEFAULT_W, h: DEFAULT_H };
  try {
    const w = parseInt(localStorage.getItem("chat:width") ?? "", 10);
    const h = parseInt(localStorage.getItem("chat:height") ?? "", 10);
    return {
      w: Number.isFinite(w) ? Math.max(MIN_W, Math.min(MAX_W, w)) : DEFAULT_W,
      h: Number.isFinite(h) ? Math.max(MIN_H, Math.min(MAX_H, h)) : DEFAULT_H,
    };
  } catch {
    return { w: DEFAULT_W, h: DEFAULT_H };
  }
}

function saveSize(w: number, h: number) {
  try {
    localStorage.setItem("chat:width", String(w));
    localStorage.setItem("chat:height", String(h));
  } catch {}
}

/* ------------------------------------------------------------------ */
/* SSE streaming helper                                                */
/* ------------------------------------------------------------------ */

async function* streamChat(
  providerId: string,
  message: string,
  sessionId: string | null,
  pageContext: Record<string, unknown>,
): AsyncGenerator<
  | { type: "session"; id: string }
  | { type: "token"; text: string }
  | { type: "error"; message: string },
  void
> {
  const res = await authFetch(`${API_BASE}/api/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider_id: providerId,
      message,
      session_id: sessionId,
      page_context: pageContext,
    }),
  });

  if (!res.ok) {
    let detail = "Chat request failed";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {}
    yield { type: "error", message: detail };
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    yield { type: "error", message: "No response stream" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        const data = JSON.parse(payload);
        if (data.session_id) yield { type: "session", id: data.session_id };
        else if (data.token) yield { type: "token", text: data.token };
        else if (data.error) yield { type: "error", message: data.error };
      } catch {}
    }
  }
}

/* ------------------------------------------------------------------ */
/* Markdown components — dark-themed overrides for react-markdown      */
/* ------------------------------------------------------------------ */

const mdComponents: Record<string, React.FC<Record<string, unknown>>> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pre({ children, ...rest }: any) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-900" {...rest}>
        {children}
      </div>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ className, children, ...rest }: any) {
    const isBlock = /language-/.test(className || "");
    const content = String(children).replace(/\n$/, "");
    if (isBlock) {
      return (
        <code
          className="block whitespace-pre p-3 font-mono text-[12px] leading-relaxed text-slate-200"
          {...rest}
        >
          {content}
        </code>
      );
    }
    // Detect multi-line code that react-markdown wraps in <pre> anyway
    if (content.includes("\n")) {
      return (
        <code
          className="block whitespace-pre p-3 font-mono text-[12px] leading-relaxed text-slate-200"
          {...rest}
        >
          {content}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-slate-700/60 px-1 py-0.5 font-mono text-[12px] text-cyan-300"
        {...rest}
      >
        {content}
      </code>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1({ children, ...rest }: any) {
    return <h1 className="mt-3 mb-1 text-base font-bold text-white" {...rest}>{children}</h1>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2({ children, ...rest }: any) {
    return <h2 className="mt-3 mb-1 text-sm font-bold text-white" {...rest}>{children}</h2>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3({ children, ...rest }: any) {
    return <h3 className="mt-2 mb-1 text-sm font-semibold text-slate-200" {...rest}>{children}</h3>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p({ children, ...rest }: any) {
    return <p className="mb-2 last:mb-0" {...rest}>{children}</p>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul({ children, ...rest }: any) {
    return <ul className="mb-2 ml-4 list-disc space-y-0.5" {...rest}>{children}</ul>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol({ children, ...rest }: any) {
    return <ol className="mb-2 ml-4 list-decimal space-y-0.5" {...rest}>{children}</ol>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li({ children, ...rest }: any) {
    return <li className="text-[13px] leading-relaxed" {...rest}>{children}</li>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a({ children, href, ...rest }: any) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-400 underline decoration-cyan-800 hover:text-cyan-300"
        {...rest}
      >
        {children}
      </a>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table({ children, ...rest }: any) {
    return (
      <div className="my-2 overflow-x-auto rounded border border-slate-700/60">
        <table className="w-full border-collapse text-[12px]" {...rest}>{children}</table>
      </div>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  th({ children, ...rest }: any) {
    return (
      <th className="border-b border-slate-700/60 bg-slate-900/80 px-2 py-1 text-left text-[11px] font-semibold text-slate-400" {...rest}>
        {children}
      </th>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td({ children, ...rest }: any) {
    return (
      <td className="border-b border-slate-800/40 px-2 py-1 text-slate-300" {...rest}>{children}</td>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blockquote({ children, ...rest }: any) {
    return (
      <blockquote className="my-2 border-l-2 border-cyan-700/50 pl-3 text-slate-400 italic" {...rest}>
        {children}
      </blockquote>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strong({ children, ...rest }: any) {
    return <strong className="font-semibold text-white" {...rest}>{children}</strong>;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hr(rest: any) {
    return <hr className="my-3 border-slate-700/60" {...rest} />;
  },
};

/* ------------------------------------------------------------------ */
/* Widget                                                              */
/* ------------------------------------------------------------------ */

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Provider state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [providersLoaded, setProvidersLoaded] = useState(false);

  // Panel size — persisted in localStorage
  const [panelW, setPanelW] = useState(DEFAULT_W);
  const [panelH, setPanelH] = useState(DEFAULT_H);
  const resizing = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Current view context plus optional attached items from page controls.
  const {
    pageContext,
    items: contextItems,
    removeItem,
    clearAll,
    onItemAdded,
  } = useChatContext();

  // Auto-open when an item is attached while the panel is minimized
  useEffect(() => {
    const off = onItemAdded(() => setOpen(true));
    return off;
  }, [onItemAdded]);

  // Load persisted size on mount
  useEffect(() => {
    const { w, h } = loadSize();
    setPanelW(w);
    setPanelH(h);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Fetch providers when panel first opens
  useEffect(() => {
    if (!open || providersLoaded) return;
    authFetch(`${API_BASE}/api/ai/providers`)
      .then((r) => r.json())
      .then((data) => {
        const list: ProviderInfo[] = (data.providers ?? []).filter(
          (p: ProviderInfo) => p.enabled && !p.kind.includes("embedding"),
        );
        setProviders(list);
        if (list.length > 0 && !selectedProvider) {
          const saved =
            typeof window !== "undefined"
              ? localStorage.getItem("chat:provider")
              : null;
          const pick = list.find((p) => p.id === saved) ?? list[0];
          setSelectedProvider(pick.id);
        }
        setProvidersLoaded(true);
      })
      .catch(() => setProvidersLoaded(true));
  }, [open, providersLoaded, selectedProvider]);

  // ---- Resize handlers ----
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: panelW,
        startH: panelH,
      };

      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const { startX, startY, startW, startH } = resizing.current;
        const newW = Math.max(MIN_W, Math.min(MAX_W, startW - (ev.clientX - startX)));
        const newH = Math.max(MIN_H, Math.min(MAX_H, startH - (ev.clientY - startY)));
        setPanelW(newW);
        setPanelH(newH);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (resizing.current) {
          // Read final size from the latest state via DOM measurement
          const el = document.getElementById("chat-panel");
          if (el) {
            saveSize(el.offsetWidth, el.offsetHeight);
          }
          resizing.current = null;
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelW, panelH],
  );

  // ---- Chat handlers ----
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !selectedProvider || streaming) return;

    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    let sentAttachedIds: string[] = [];
    try {
      const attachedItems = contextItems.map((i) => ({
        kind: i.kind,
        label: i.label,
        data: i.data,
      }));
      sentAttachedIds = contextItems.map((i) => i.id);
      const pageContextPayload: Record<string, unknown> = {};
      if (pageContext) {
        pageContextPayload.page = {
          kind: pageContext.kind,
          label: pageContext.label,
          data: pageContext.data,
        };
      }
      if (attachedItems.length > 0) {
        pageContextPayload.items = attachedItems;
      }

      for await (const event of streamChat(
        selectedProvider,
        text,
        sessionId,
        pageContextPayload,
      )) {
        if (event.type === "session") {
          setSessionId(event.id);
        } else if (event.type === "token") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: last.content + event.text,
              };
            }
            return next;
          });
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream failed");
    } finally {
      setStreaming(false);
      for (const id of sentAttachedIds) {
        removeItem(id);
      }
    }
  }, [
    input,
    selectedProvider,
    sessionId,
    streaming,
    contextItems,
    pageContext,
    removeItem,
  ]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
  }, []);

  const handleProviderChange = useCallback(
    (id: string) => {
      setSelectedProvider(id);
      if (typeof window !== "undefined") {
        localStorage.setItem("chat:provider", id);
      }
      handleNewChat();
    },
    [handleNewChat],
  );

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === selectedProvider),
    [providers, selectedProvider],
  );

  /* ---------------------------------------------------------------- */
  /* Render — collapsed icon                                           */
  /* ---------------------------------------------------------------- */
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 text-white shadow-lg shadow-cyan-900/40 transition hover:scale-105 hover:shadow-cyan-800/50"
        title="Open AI Assistant"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render — expanded panel                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div
      id="chat-panel"
      className="fixed bottom-0 right-0 z-50 flex flex-col rounded-tl-2xl border-l border-t border-slate-800 bg-slate-950 shadow-2xl shadow-black/60"
      style={{ width: panelW, height: panelH }}
    >
      {/* Resize handle — top-left corner */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute -left-px -top-px z-10 h-5 w-5 cursor-nw-resize"
        title="Drag to resize"
      >
        <svg viewBox="0 0 10 10" className="h-full w-full text-slate-600 opacity-60 hover:opacity-100 transition">
          <path d="M0 10L10 0M0 6L6 0M0 2L2 0" stroke="currentColor" strokeWidth={1.2} fill="none" />
        </svg>
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded bg-gradient-to-br from-cyan-600 to-blue-700 flex shrink-0 items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">AI Assistant</div>
            {activeProvider && (
              <div className="text-[10px] text-slate-500 truncate">
                {activeProvider.name} &middot; {activeProvider.model}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="rounded px-2 py-1 text-[10px] text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
            title="New chat"
          >
            New
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded px-1.5 py-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
            title="Minimize"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5">
              <path d="M5 10h10" stroke="currentColor" strokeWidth={2} fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Provider picker */}
      {providers.length > 1 && (
        <div className="shrink-0 border-b border-slate-800/60 px-4 py-1.5">
          <select
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full appearance-none rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 focus:border-cyan-600/60 focus:outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No providers */}
      {providersLoaded && providers.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <div className="text-sm text-slate-400">No AI providers configured</div>
            <div className="mt-2 text-xs text-slate-600">
              Add an LLM provider in Settings to start chatting.
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      {providers.length > 0 && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && !streaming && (
            <div className="flex h-full items-center justify-center text-center text-xs text-slate-600 px-4">
              Ask anything about Fortinet &mdash; FortiOS, FMG, policies, troubleshooting.
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Context summary */}
      {providers.length > 0 && (pageContext || contextItems.length > 0) && (
        <ContextPanel
          pageContext={pageContext}
          items={contextItems}
          onRemove={removeItem}
          onClearAll={clearAll}
        />
      )}

      {/* Input */}
      {providers.length > 0 && (
        <div className="shrink-0 border-t border-slate-800 px-3 py-2.5">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask a question..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-600/60 focus:outline-none"
              disabled={streaming}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming || !selectedProvider}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-700/80 text-white transition hover:bg-cyan-600 disabled:bg-slate-800 disabled:text-slate-600"
            >
              {streaming ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
              ) : (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Context panel                                                       */
/* ------------------------------------------------------------------ */

function ContextPanel({
  pageContext,
  items,
  onRemove,
  onClearAll,
}: {
  pageContext: ChatPageContext | null;
  items: ChatContextItem[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-cyan-400/80">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501-.002.002a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            {pageContext ? "Current view included" : ""}
            {pageContext && items.length > 0 ? " · " : ""}
            {items.length > 0
              ? `${items.length} attached · sent with next message`
              : ""}
          </span>
        </div>
        {items.length > 1 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-[10px] text-slate-500 transition hover:text-cyan-300"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pageContext && (
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-800/50 bg-emerald-900/25 py-0.5 px-2 text-[11px] text-emerald-100">
            <span className="text-[9px] uppercase tracking-wide text-emerald-500/80">
              viewing
            </span>
            <span className="max-w-[260px] truncate">
              {pageContext.label}
            </span>
          </span>
        )}
        {items.map((i) => (
          <span
            key={i.id}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-cyan-800/50 bg-cyan-900/30 py-0.5 pr-1 pl-2 text-[11px] text-cyan-100"
          >
            <span className="text-[9px] uppercase tracking-wide text-cyan-500/80">
              {i.kind}
            </span>
            <span className="max-w-[220px] truncate">{i.label}</span>
            <button
              type="button"
              onClick={() => onRemove(i.id)}
              title="Remove from context"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-cyan-400/80 transition hover:bg-cyan-800/60 hover:text-white"
            >
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
                <path
                  d="M2 2L8 8M8 2L2 8"
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              </svg>
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message bubble                                                      */
/* ------------------------------------------------------------------ */

function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl bg-cyan-900/40 px-3 py-2 text-[13px] leading-relaxed text-cyan-100">
          {msg.content}
        </div>
      </div>
    );
  }

  // Assistant message — render markdown
  if (!msg.content) {
    return (
      <div className="flex justify-start">
        <div className="rounded-xl bg-slate-800/60 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-slate-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 [animation-delay:150ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-xl bg-slate-800/60 px-4 py-3 text-[13px] leading-relaxed text-slate-200">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {msg.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
