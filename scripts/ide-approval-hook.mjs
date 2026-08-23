/**
 * DISABLED — this hook no longer gates anything.
 *
 * Why it was removed
 * ------------------
 * This script used to block a Kiro IDE `preToolUse` call while a Wear OS watch
 * showed the approval. It never once worked, and it could not have:
 *
 *   const raw = await readStdin();   // ← hung here, forever
 *
 * `readStdin()` did `for await (const chunk of process.stdin)`, which only
 * finishes when stdin reaches EOF. Kiro IDE hands a hook a stdin that is not a
 * TTY and is never closed, so the loop never ended. The `AbortController` that
 * bounded the wait guarded only the `fetch` further down — code that was never
 * reached. And `.kiro/hooks/aibou-watch-approval.kiro.hook` set `"timeout": 0`,
 * so the IDE never killed it either.
 *
 * Net effect: every shell command in the editor blocked indefinitely, no
 * approval was ever raised, and the watch never saw anything. Observed: a 35
 * minute hang, then "Command timed out with no output captured".
 *
 * It exits 0 immediately so a cached copy of the hook cannot block the editor.
 *
 * The real-time approval path is the Bridge's own ACP session, where permission
 * requests come from the agent itself and a tap on the watch genuinely allows or
 * blocks the tool. See scripts/watch-live.mjs and `pnpm run watch:live`.
 */

console.log('ALLOWED (not gated): the IDE approval hook is disabled — see scripts/watch-live.mjs');
process.exit(0);
