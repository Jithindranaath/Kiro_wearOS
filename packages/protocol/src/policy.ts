import { z } from 'zod';

/**
 * A single policy rule.
 */
export const PolicyRule = z.object({
  id: z.string(),
  when: z.object({
    tool: z.union([z.string(), z.array(z.string())]).optional(),
    pathIn: z.enum(['cwd', 'outside_cwd']).or(z.string()).optional(),
    pathMatches: z.string().optional(),
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
