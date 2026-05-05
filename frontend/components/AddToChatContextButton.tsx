"use client";

import { useCallback } from "react";
import { useChatContext, type ChatContextItem } from "@/components/ChatContext";

interface Props {
  item: ChatContextItem;
  className?: string;
  /** Optional override tooltip (defaults to "Ask AI about this"). */
  title?: string;
  size?: "sm" | "md";
}

/**
 * Icon-only button for attaching an item to the AI chat context.
 *
 * Click to attach; click again to detach. Shows a subtle filled state
 * when the same `id` is already attached.
 */
export default function AddToChatContextButton({
  item,
  className = "",
  title,
  size = "sm",
}: Props) {
  const { addItem, removeItem, hasItem } = useChatContext();
  const attached = hasItem(item.id);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (attached) removeItem(item.id);
      else addItem(item);
    },
    [attached, addItem, removeItem, item],
  );

  const dim = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const iconDim = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  const tooltip =
    title ?? (attached ? "Remove from AI context" : "Ask AI about this");

  return (
    <button
      type="button"
      onClick={toggle}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={attached}
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-md border transition ${
        attached
          ? "border-cyan-600/50 bg-cyan-900/40 text-cyan-300 hover:bg-cyan-800/50"
          : "border-slate-700/60 bg-slate-900/40 text-slate-500 hover:border-cyan-700/50 hover:bg-slate-800 hover:text-cyan-300"
      } ${className}`}
    >
      {attached ? (
        <svg viewBox="0 0 20 20" fill="currentColor" className={iconDim}>
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 010 1.42l-8 8a1 1 0 01-1.42 0l-4-4a1 1 0 111.42-1.42L8 12.58l7.29-7.29a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={iconDim}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v2m0 0v2m0-2h2m-2 0h-2"
            transform="translate(6 -3)"
          />
        </svg>
      )}
    </button>
  );
}
