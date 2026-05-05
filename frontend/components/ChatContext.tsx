"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ChatContextItem {
  id: string;
  kind: string;
  label: string;
  data: unknown;
}

export interface ChatPageContext {
  id: string;
  kind: string;
  label: string;
  data: unknown;
  updatedAt?: number;
}

interface ChatContextValue {
  pageContext: ChatPageContext | null;
  setPageContext: (context: ChatPageContext | null) => void;
  clearPageContext: (id?: string) => void;
  items: ChatContextItem[];
  addItem: (item: ChatContextItem) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
  hasItem: (id: string) => boolean;
  onItemAdded: (cb: () => void) => () => void;
}

const MAX_ITEMS = 8;

const ChatContextCtx = createContext<ChatContextValue | null>(null);

export function ChatContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pageContext, setPageContextState] = useState<ChatPageContext | null>(
    null,
  );
  const [items, setItems] = useState<ChatContextItem[]>([]);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const setPageContext = useCallback((context: ChatPageContext | null) => {
    setPageContextState(
      context ? { ...context, updatedAt: context.updatedAt ?? Date.now() } : null,
    );
  }, []);

  const clearPageContext = useCallback((id?: string) => {
    setPageContextState((prev) => {
      if (!prev) return prev;
      if (id && prev.id !== id) return prev;
      return null;
    });
  }, []);

  const addItem = useCallback((item: ChatContextItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev;
      const next = [...prev, item];
      return next.length > MAX_ITEMS ? next.slice(next.length - MAX_ITEMS) : next;
    });
    listenersRef.current.forEach((cb) => cb());
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const hasItem = useCallback(
    (id: string) => items.some((i) => i.id === id),
    [items],
  );

  const onItemAdded = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      pageContext,
      setPageContext,
      clearPageContext,
      items,
      addItem,
      removeItem,
      clearAll,
      hasItem,
      onItemAdded,
    }),
    [
      pageContext,
      setPageContext,
      clearPageContext,
      items,
      addItem,
      removeItem,
      clearAll,
      hasItem,
      onItemAdded,
    ],
  );

  return (
    <ChatContextCtx.Provider value={value}>{children}</ChatContextCtx.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContextCtx);
  if (!ctx)
    throw new Error("useChatContext must be used within ChatContextProvider");
  return ctx;
}
