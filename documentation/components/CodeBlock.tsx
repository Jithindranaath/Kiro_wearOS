'use client';

import { useState } from 'react';

interface CodeBlockProps {
  code: string;
  /** Shown as a small label in the header strip, e.g. "bash" or "~/.aibou/policy.json". */
  filename?: string;
  /** Prefix each line with `$` styling for shell transcripts. */
  shell?: boolean;
}

export function CodeBlock({ code, filename, shell = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is still selectable */
    }
  };

  return (
    <div className="glass group relative overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-glow/70" />
          {filename ?? (shell ? 'terminal' : 'code')}
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-400 transition-colors hover:border-violet-glow/40 hover:text-white"
          aria-label="Copy code to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12.5px] leading-relaxed">
        <code className="font-mono text-neutral-300">
          {code.split('\n').map((line, i) => (
            <span key={i} className="block">
              {shell && line.trim() !== '' && !line.startsWith('#') && (
                <span className="select-none text-violet-glow/70">$ </span>
              )}
              <span className={line.startsWith('#') ? 'text-neutral-600' : undefined}>{line}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
