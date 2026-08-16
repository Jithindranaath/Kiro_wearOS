/**
 * Policy Engine — evaluates permission requests against configurable rules.
 *
 * Evaluation order:
 * 1. Collect ALL matching rules
 * 2. If any deny → deny (deny always wins)
 * 3. If any escalate → escalate
 * 4. If any allow → allow
 * 5. If nothing matched → escalate (fail closed, AC2.2.2)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Policy, type PolicyRule } from '@aibou/protocol';
import { defaultPolicy } from './defaults.js';

export type PolicyDecision = 'allow' | 'deny' | 'escalate';

export interface PolicyEvaluation {
  decision: PolicyDecision;
  matchedRules: PolicyRule[];
  ruleId?: string;
  reason?: string;
}

export interface ToolContext {
  toolName: string;
  rawInput: unknown;
  cwd: string;
}

export interface PolicyEngineOptions {
  /** Escalate everything, ignoring all allow rules (AC2.2.5). */
  paranoid?: boolean;
  /**
   * Use this policy instead of reading from disk. Lets tests run
   * deterministically regardless of the developer's ~/.aibou/policy.json.
   */
  policy?: Policy;
  /** Override the policy file location. */
  policyPath?: string;
}

/** Where the active policy came from. */
export type PolicySource = 'default' | 'file' | 'invalid';

export class PolicyEngine {
  private policy: Policy;
  private paranoid: boolean;
  private source: PolicySource = 'default';
  private loadError: string | null = null;
  /** True when --paranoid was requested explicitly, not caused by an error. */
  private readonly paranoidRequested: boolean;

  private readonly injectedPolicy: Policy | null;
  private readonly policyPath: string;

  constructor(options: boolean | PolicyEngineOptions = false) {
    const opts: PolicyEngineOptions =
      typeof options === 'boolean' ? { paranoid: options } : options;

    this.paranoidRequested = opts.paranoid ?? false;
    this.paranoid = this.paranoidRequested;
    this.injectedPolicy = opts.policy ?? null;
    this.policyPath = opts.policyPath ?? join(homedir(), '.aibou', 'policy.json');
    this.policy = this.loadPolicy();
  }

  /** Human-readable description of the active policy, for startup output. */
  describe(): string {
    if (this.source === 'invalid') {
      return `INVALID policy.json — paranoid mode (${this.loadError ?? 'unknown error'})`;
    }
    if (this.paranoidRequested) {
      return 'paranoid mode (--paranoid): everything escalates';
    }
    if (this.source === 'file') {
      return `custom policy.json (${this.policy.rules.length} rules)`;
    }
    return `built-in defaults (${this.policy.rules.length} rules)`;
  }

  get isParanoid(): boolean {
    return this.paranoid;
  }

  get policySource(): PolicySource {
    return this.source;
  }

  get error(): string | null {
    return this.loadError;
  }

  /**
   * Evaluate a tool call against the policy.
   */
  evaluate(ctx: ToolContext): PolicyEvaluation {
    // Paranoid mode: escalate everything regardless of rules
    if (this.paranoid) {
      return {
        decision: 'escalate',
        matchedRules: [],
        reason: 'Paranoid mode active — all actions require human approval.',
      };
    }

    const matchedRules = this.policy.rules.filter((rule) => this.ruleMatches(rule, ctx));

    if (matchedRules.length === 0) {
      // Fail closed: unmatched → escalate (AC2.2.2)
      return {
        decision: 'escalate',
        matchedRules: [],
        reason: 'No matching policy rule — escalating to human.',
      };
    }

    // Deny always wins (AC2.2.3)
    const denyRule = matchedRules.find((r) => r.then === 'deny');
    if (denyRule) {
      return {
        decision: 'deny',
        matchedRules,
        ruleId: denyRule.id,
        reason: denyRule.reason,
      };
    }

    // Escalate next priority
    const escalateRule = matchedRules.find((r) => r.then === 'escalate');
    if (escalateRule) {
      return {
        decision: 'escalate',
        matchedRules,
        ruleId: escalateRule.id,
        reason: escalateRule.reason,
      };
    }

    // Allow (all matching rules are allow)
    const allowRule = matchedRules[0];
    return {
      decision: 'allow',
      matchedRules,
      ruleId: allowRule.id,
      reason: allowRule.reason,
    };
  }

  /**
   * Reload policy from disk. Resets the degraded state so a fixed file
   * can restore normal operation without restarting the Bridge.
   */
  reload(): void {
    this.paranoid = this.paranoidRequested;
    this.loadError = null;
    this.source = 'default';
    this.policy = this.loadPolicy();
  }

  get currentPolicy(): Policy {
    return this.policy;
  }

  private loadPolicy(): Policy {
    // An explicitly injected policy wins and never touches the filesystem,
    // so tests are independent of the developer's ~/.aibou/policy.json.
    if (this.injectedPolicy) {
      this.source = 'file';
      return this.injectedPolicy;
    }

    const policyPath = this.policyPath;

    if (!existsSync(policyPath)) {
      this.source = 'default';
      return defaultPolicy;
    }

    try {
      // Strip a UTF-8 BOM if present. Windows editors (Notepad, PowerShell
      // Set-Content -Encoding utf8) add one, and JSON.parse rejects it.
      const raw = readFileSync(policyPath, 'utf-8').replace(/^\uFEFF/, '');

      if (raw.trim().length === 0) {
        this.degrade(`policy.json at ${policyPath} is empty`);
        return defaultPolicy;
      }

      const parsed: unknown = JSON.parse(raw);
      const validated = Policy.safeParse(parsed);

      if (!validated.success) {
        const detail = validated.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        this.degrade(`policy.json failed validation — ${detail}`);
        return defaultPolicy;
      }

      this.source = 'file';
      this.loadError = null;
      return validated.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.degrade(`policy.json could not be parsed — ${message}`);
      return defaultPolicy;
    }
  }

  /**
   * Fail closed: an unusable policy file must never widen permissions.
   * Switch to paranoid mode and record why, so the operator can see it.
   */
  private degrade(reason: string): void {
    this.paranoid = true;
    this.source = 'invalid';
    this.loadError = reason;
    console.error(`[policy] ${reason}. Falling back to paranoid mode (everything escalates).`);
  }

  private ruleMatches(rule: PolicyRule, ctx: ToolContext): boolean {
    const { when } = rule;

    // A rule with no conditions would match everything; treat as non-matching
    // so a malformed rule cannot silently allow or deny the whole system.
    const hasCondition =
      when.tool !== undefined ||
      when.pathIn !== undefined ||
      when.pathMatches !== undefined ||
      when.pathRegex !== undefined ||
      when.commandMatches !== undefined;
    if (!hasCondition) return false;

    // Match tool name / ACP kind
    if (when.tool !== undefined) {
      const tools = Array.isArray(when.tool) ? when.tool : [when.tool];
      const matches = tools.some((pattern) => globMatch(pattern, ctx.toolName));
      if (!matches) return false;
    }

    // Match path location relative to cwd
    if (when.pathIn !== undefined) {
      const filePath = extractPath(ctx.rawInput);
      if (!filePath) return false;
      const inside = isInsideCwd(filePath, ctx.cwd);
      if (when.pathIn === 'cwd' && !inside) return false;
      if (when.pathIn === 'outside_cwd' && inside) return false;
    }

    // Match path glob
    if (when.pathMatches !== undefined) {
      const filePath = extractPath(ctx.rawInput);
      if (!filePath) return false;
      if (!globMatch(when.pathMatches, filePath)) return false;
    }

    // Match path regex (unanchored, case-insensitive)
    if (when.pathRegex !== undefined) {
      const filePath = extractPath(ctx.rawInput);
      if (!filePath) return false;
      const regex = compileRegex(when.pathRegex);
      // An invalid regex must not silently widen the rule.
      if (!regex || !regex.test(filePath)) return false;
    }

    // Match command regex (unanchored, case-insensitive)
    if (when.commandMatches !== undefined) {
      const command = extractCommand(ctx.rawInput);
      if (!command) return false;
      const regex = compileRegex(when.commandMatches);
      if (!regex || !regex.test(command)) return false;
    }

    return true;
  }
}

// ─── Matching helpers ────────────────────────────────────────────────────────

/** Cache compiled regexes so evaluation stays cheap on hot paths. */
const regexCache = new Map<string, RegExp | null>();

function compileRegex(source: string): RegExp | null {
  const cached = regexCache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(source, 'i');
  } catch {
    console.error(`[policy] Invalid regex in rule, ignoring condition: ${source}`);
    compiled = null;
  }
  regexCache.set(source, compiled);
  return compiled;
}

/** Escape regex metacharacters except `*` and `?`, which become glob wildcards. */
function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  const regex = compileRegex(source);
  if (!regex) return pattern === value;
  return regex.test(value);
}

/** Normalize separators and case so Windows and POSIX paths compare equally. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * True when `filePath` is inside `cwd`. Compares on a path-segment boundary so
 * `/project-secrets` is not treated as inside `/project`.
 */
function isInsideCwd(filePath: string, cwd: string): boolean {
  if (!cwd) return false;
  const p = normalizePath(filePath);
  const base = normalizePath(cwd);
  if (p === base) return true;
  return p.startsWith(base + '/');
}

/** Pull a filesystem path out of a tool input, across known field names. */
function extractPath(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== 'object') return undefined;
  const input = rawInput as Record<string, unknown>;
  const keys = [
    'path',
    'file',
    'files',
    'file_path',
    'filePath',
    'targetFile',
    'target_file',
    'destinationPath',
    'sourcePath',
    'directory',
    'dir',
  ];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
    // Some tools pass an array of paths; match against the first entry.
    if (Array.isArray(value)) {
      const first = value.find((v) => typeof v === 'string' && v.length > 0);
      if (typeof first === 'string') return first;
    }
  }
  return undefined;
}

/** Pull a command string out of a tool input, across known field names. */
function extractCommand(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== 'object') return undefined;
  const input = rawInput as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script', 'commandLine']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
