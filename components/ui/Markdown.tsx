"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Markdown renderer used by chat messages, reports and research notes.
 * Raw HTML is intentionally not rendered (no rehype-raw), so model output can
 * never inject markup into the app.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          ),
          pre: ({ children: inner }) => <pre className="scroll-area">{inner}</pre>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
