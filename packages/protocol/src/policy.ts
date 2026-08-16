import { z } from 'zod';

/**
 * A single policy rule.
 *
 * All present conditions must match for the rule to apply (AND semantics).
 * A rule with an empty `when` matches everything.
 */
export const PolicyRule = z.object({
  id: z.string(),
  when: z.object({
    /** Tool name or ACP tool kind. Supports `*` and `prefix_*` globs. */
    tool: z.union([z.string(), z.array(z.string())]).optional(),
    /** Whether the target path is inside or outside the session cwd. */
    pathIn: z.enum(['cwd', 'outside_cwd']).optional(),
    /** Glob match against the target path, e.g. `*.env`. */
    pathMatches: z.string().optional(),
    /** Regex (unanchored, case-insensitive) match against the target path. */
    pathRegex: z.string().optional(),
    /** Regex (unanchored, case-insensitive) match against the command string. */
    commandMatches: z.string().optional(),
  }),
  then: z.enum(['allow', 'deny', 'escalate']),
  reason: z.string(),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

/**
 * The full policy document stored in ~/.aibou/policy.json
 */
export const Policy = z.object({
  version: z.literal(1),
  rules: z.array(PolicyRule),
});
export type Policy = z.infer<typeof Policy>;
