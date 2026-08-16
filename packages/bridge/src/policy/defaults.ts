/**
 * Default policy rules — shipped with the Bridge.
 *
 * Rules are DATA, not code (AC2.2.8).
 * See policy/engine.test.ts for the required test table.
 */

import type { Policy } from '@aibou/protocol';

/**
 * Patterns matching dangerous shell commands.
 */
export const DANGEROUS_COMMAND_PATTERNS: string[] = [
  'rm\\s+-rf\\s+/',
  'rm\\s+-rf\\s+~',
  'rm\\s+-rf\\s+\\.\\./',
  'sudo\\s+',
  'chmod\\s+777',
  'git\\s+push\\s+--force',
  'git\\s+push\\s+-f',
  '\\|\\s*(sh|bash|zsh|cmd)',
  'curl\\s+.*\\|\\s*(sh|bash)',
  'wget\\s+.*\\|\\s*(sh|bash)',
  'dd\\s+',
  'mkfs',
  '>/dev/',
  'npm\\s+publish',
  'yarn\\s+publish',
  'pnpm\\s+publish',
  'cargo\\s+publish',
  'pip\\s+upload',
  'twine\\s+upload',
  'format\\s+[a-zA-Z]:',
  'del\\s+/[sS]\\s+/[qQ]',
];

/**
 * Patterns matching paths to sensitive/secret files.
 */
export const SECRET_PATH_PATTERNS: string[] = [
  '\\.env',
  '\\.env\\.',
  '.*\\.pem$',
  '.*\\.key$',
  'id_rsa',
  'id_ed25519',
  '\\.aws/',
  '\\.ssh/',
  'credentials',
  '\\.netrc',
  'token',
  'secret',
  '\\.gnupg/',
  'keystore',
  '\\.docker/config\\.json',
];

export const defaultPolicy: Policy = {
  version: 1,
  rules: [
    // Allow read-only tools
    {
      id: 'default-allow-reads',
      when: { tool: ['read_file', 'read_files', 'read_code', 'grep_search', 'file_search', 'list_directory', 'get_diagnostics'] },
      then: 'allow',
      reason: 'Read-only operations are safe by default.',
    },
    // Allow writes inside the project (cwd)
    {
      id: 'default-allow-cwd-writes',
      when: { tool: ['fs_write', 'str_replace', 'fs_append'], pathIn: 'cwd' },
      then: 'allow',
      reason: 'Writes inside the project directory are allowed.',
    },
    // Escalate writes outside cwd
    {
      id: 'default-escalate-outside-writes',
      when: { tool: ['fs_write', 'str_replace', 'fs_append'], pathIn: 'outside_cwd' },
      then: 'escalate',
      reason: 'File write outside project directory requires approval.',
    },
    // Escalate dangerous shell commands
    {
      id: 'default-escalate-dangerous-commands',
      when: { tool: ['execute_pwsh', 'execute_command', 'shell'], commandMatches: DANGEROUS_COMMAND_PATTERNS.join('|') },
      then: 'escalate',
      reason: 'Potentially dangerous shell command requires approval.',
    },
    // Escalate secret file access
    {
      id: 'default-escalate-secret-paths',
      when: { tool: '*', pathMatches: `*(${SECRET_PATH_PATTERNS.join('|')})` },
      then: 'escalate',
      reason: 'Access to sensitive file requires approval.',
    },
    // Deny self-modification of .aibou config
    {
      id: 'default-deny-self-modification',
      when: { tool: '*', pathMatches: '*.aibou/*' },
      then: 'deny',
      reason: 'Agent cannot modify Aibou configuration.',
    },
  ],
};
