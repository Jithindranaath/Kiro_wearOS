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

export class PolicyEngine {
  private policy: Policy;
  private paranoid: boolean;

  constructor(paranoid = false) {
    this.paranoid = paranoid;
    this.policy = this.loadPolicy();
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
   * Reload policy from disk.
   */
  reload(): void {
    this.policy = this.loadPolicy();
  }

  get currentPolicy(): Policy {
    return this.policy;
  }

  private loadPolicy(): Policy {
    const policyPath = join(homedir(), '.aibou', 'policy.json');

    if (!existsSync(policyPath)) {
      return defaultPolicy;
    }

    try {
      const raw = readFileSync(policyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = Policy.safeParse(parsed);

      if (!validated.success) {
        console.error(
          `[policy] Malformed policy.json: ${validated.error.message}. Falling back to paranoid mode.`,
        );
        // Malformed policy → paranoid fallback (AC2.2.7)
        this.paranoid = true;
        return defaultPolicy;
      }

      return validated.data;
    } catch (err) {
      console.error(
        `[policy] Failed to read policy.json: ${err}. Falling back to paranoid mode.`,
      );
      this.paranoid = true;
      return defaultPolicy;
    }
  }

  private ruleMatches(rule: PolicyRule, ctx: ToolContext): boolean {
    const { when } = rule;

    // Match tool name
    if (when.tool) {
      const tools = Array.isArray(when.tool) ? when.tool : [when.tool];
      const matches = tools.some((pattern) => this.globMatch(pattern, ctx.toolName));
      if (!matches) return false;
    }

    // Match path (pathIn: cwd or outside_cwd)
    if (when.pathIn) {
      const filePath = this.extractPath(ctx.rawInput);
      if (!filePath) return false;

      if (when.pathIn === 'cwd') {
        if (!this.isInsideCwd(filePath, ctx.cwd)) return false;
      } else if (when.pathIn === 'outside_cwd') {
        if (this.isInsideCwd(filePath, ctx.cwd)) return false;
      }
    }

    // Match path pattern
    if (when.pathMatches) {
      const filePath = this.extractPath(ctx.rawInput);
      if (!filePath) return false;
      if (!this.globMatch(when.pathMatches, filePath)) return false;
    }

    // Match command pattern (regex)
    if (when.commandMatches) {
      const command = this.extractCommand(ctx.rawInput);
      if (!command) return false;
      try {
        const regex = new RegExp(when.commandMatches);
        if (!regex.test(command)) return false;
      } catch {
        // Invalid regex in rule — skip this match criterion
        return false;
      }
    }

    return true;
  }

  private globMatch(pattern: string, value: string): boolean {
    // Simple glob: * matches anything, fs_* matches fs_read, fs_write, etc.
    if (pattern === '*') return true;
    const regexStr = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    try {
      return new RegExp(regexStr).test(value);
    } catch {
      return pattern === value;
    }
  }

  private isInsideCwd(filePath: string, cwd: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();
    return normalizedPath.startsWith(normalizedCwd);
  }

  private extractPath(rawInput: unknown): string | undefined {
    if (!rawInput || typeof rawInput !== 'object') return undefined;
    const input = rawInput as Record<string, unknown>;
    // Common field names for file paths in tool inputs
    if (typeof input.path === 'string') return input.path;
    if (typeof input.file === 'string') return input.file;
    if (typeof input.targetFile === 'string') return input.targetFile;
    if (typeof input.filePath === 'string') return input.filePath;
    return undefined;
  }

  private extractCommand(rawInput: unknown): string | undefined {
    if (!rawInput || typeof rawInput !== 'object') return undefined;
    const input = rawInput as Record<string, unknown>;
    if (typeof input.command === 'string') return input.command;
    if (typeof input.cmd === 'string') return input.cmd;
    return undefined;
  }
}
