/**
 * Default policy rules — shipped with the Bridge.
 *
 * Rules are DATA, not code (AC2.2.8) and are unit-tested in engine.test.ts.
 *
 * Tool names are matched against `_meta.kiro.toolName` from the agent when
 * available (real kiro-cli reports e.g. "shell"), falling back to the ACP tool
 * `kind` (e.g. "execute", "read", "edit"). Both naming schemes are listed so
 * the defaults work against kiro-cli and any other ACP agent.
 * Verified against kiro-cli 2.18.1 — see docs/acp-findings.md.
 */

import type { Policy } from '@aibou/protocol';

/** Tool identifiers that only ever read state. */
export const READ_ONLY_TOOLS: string[] = [
  // Kiro tool names
  'fs_read',
  'read_file',
  'read_files',
  'read_code',
  'grep_search',
  'file_search',
  'list_directory',
  'get_diagnostics',
  // ACP tool kinds
  'read',
  'search',
];

/** Tool identifiers that modify files. */
export const WRITE_TOOLS: string[] = [
  // Kiro tool names
  'fs_write',
  'str_replace',
  'fs_append',
  // ACP tool kinds
  'write',
  'edit',
];

/** Tool identifiers that execute commands. */
export const COMMAND_TOOLS: string[] = [
  // Kiro tool names
  'shell',
  'execute_bash',
  'execute_pwsh',
  'execute_command',
  // ACP tool kinds
  'execute',
  'command',
];

/**
 * Regex fragments matching dangerous shell commands.
 * Anchored and combined by the engine.
 */
export const DANGEROUS_COMMAND_PATTERNS: string[] = [
  'rm\\s+-[a-zA-Z]*[rf]',
  'sudo\\s+',
  'chmod\\s+777',
  'chown\\s+-R',
  'git\\s+push\\s+--force',
  'git\\s+push\\s+-f\\b',
  'git\\s+reset\\s+--hard',
  'git\\s+clean\\s+-[a-zA-Z]*f',
  '\\|\\s*(sh|bash|zsh|cmd|powershell)\\b',
  'curl\\s+[^|]*\\|',
  'wget\\s+[^|]*\\|',
  'dd\\s+if=',
  '\\bmkfs',
  '>\\s*/dev/',
  'npm\\s+publish',
  'yarn\\s+publish',
  'pnpm\\s+publish',
  'cargo\\s+publish',
  'pip\\s+upload',
  'twine\\s+upload',
  'format\\s+[a-zA-Z]:',
  'del\\s+/[sS]\\b',
  'rmdir\\s+/[sS]\\b',
  'Remove-Item\\s+.*-Recurse',
  '\\bshutdown\\b',
  '\\breboot\\b',
  'kill\\s+-9',
  'iptables\\s+-F',
];

/**
 * Regex fragments matching paths that hold secrets or credentials.
 */
export const SECRET_PATH_PATTERNS: string[] = [
  '\\.env(\\.|$)',
  '\\.pem$',
  '\\.key$',
  '\\.p12$',
  '\\.pfx$',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  '\\.ssh[/\\\\]',
  '\\.aws[/\\\\]',
  '\\.gnupg[/\\\\]',
  '\\.kube[/\\\\]',
  '\\.netrc',
  'credentials',
  'secrets?\\.',
  'keystore',
  '\\.docker[/\\\\]config\\.json',
  '\\.npmrc',
  '\\.pypirc',
];

/** Join fragments into a single alternation for the engine's regex matcher. */
function alternation(patterns: string[]): string {
  return patterns.join('|');
}

export const defaultPolicy: Policy = {
  version: 1,
  rules: [
    // ── Hard deny: the agent must never rewrite Aibou's own configuration.
    {
      id: 'deny-aibou-self-modification',
      when: { pathRegex: '[/\\\\]\\.aibou[/\\\\]' },
      then: 'deny',
      reason: 'Agent cannot modify Aibou configuration or policy.',
    },

    // ── Escalate: secrets, regardless of tool.
    {
      id: 'escalate-secret-paths',
      when: { pathRegex: alternation(SECRET_PATH_PATTERNS) },
      then: 'escalate',
      reason: 'Touches a credential or secret file — needs your approval.',
    },

    // ── Escalate: dangerous commands. Deliberately does not constrain `tool`,
    //    so a dangerous command is caught whatever the agent calls the tool.
    {
      id: 'escalate-dangerous-commands',
      when: { commandMatches: alternation(DANGEROUS_COMMAND_PATTERNS) },
      then: 'escalate',
      reason: 'Potentially destructive shell command — needs your approval.',
    },

    // ── Escalate: any file write outside the session's working directory.
    {
      id: 'escalate-writes-outside-cwd',
      when: { tool: WRITE_TOOLS, pathIn: 'outside_cwd' },
      then: 'escalate',
      reason: 'Writes outside the project directory — needs your approval.',
    },

    // ── Allow: reads are safe.
    {
      id: 'allow-read-only-tools',
      when: { tool: READ_ONLY_TOOLS },
      then: 'allow',
      reason: 'Read-only operation.',
    },

    // ── Allow: writes inside the project directory.
    {
      id: 'allow-writes-in-cwd',
      when: { tool: WRITE_TOOLS, pathIn: 'cwd' },
      then: 'allow',
      reason: 'Write inside the project directory.',
    },

    // Anything not matched above falls through to `escalate` in the engine
    // (fail closed, AC2.2.2). Command tools with a safe-looking command land
    // here on purpose: running commands always deserves a human decision
    // unless the user explicitly allow-lists them.
  ],
};

/** Exported for tests and documentation. */
export const COMMAND_TOOL_NAMES = COMMAND_TOOLS;
