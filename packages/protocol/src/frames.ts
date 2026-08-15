import { z } from 'zod';

// ─── Base frame ───────────────────────────────────────────────────────────────

export const BaseFrame = z.object({
  v: z.literal(1),
  t: z.string(),
  id: z.string().optional(),
  ts: z.number(),
});

export type BaseFrame = z.infer<typeof BaseFrame>;

// ─── Client → Server frames ──────────────────────────────────────────────────

export const AuthFrame = BaseFrame.extend({
  t: z.literal('auth'),
  token: z.string(),
});
export type AuthFrame = z.infer<typeof AuthFrame>;

export const SubscribeFrame = BaseFrame.extend({
  t: z.literal('subscribe'),
  sessionId: z.string().optional(),
  since: z.number().optional(),
});
export type SubscribeFrame = z.infer<typeof SubscribeFrame>;

export const SessionCreateFrame = BaseFrame.extend({
  t: z.literal('session.create'),
  cwd: z.string(),
});
export type SessionCreateFrame = z.infer<typeof SessionCreateFrame>;

export const SessionListFrame = BaseFrame.extend({
  t: z.literal('session.list'),
});
export type SessionListFrame = z.infer<typeof SessionListFrame>;

export const PromptSendFrame = BaseFrame.extend({
  t: z.literal('prompt.send'),
  sessionId: z.string(),
  text: z.string(),
  source: z.enum(['text', 'voice']).default('text'),
});
export type PromptSendFrame = z.infer<typeof PromptSendFrame>;

export const PermissionRespondFrame = BaseFrame.extend({
  t: z.literal('permission.respond'),
  approvalId: z.string(),
  decision: z.enum(['allow', 'deny']),
  remember: z.boolean().optional(),
});
export type PermissionRespondFrame = z.infer<typeof PermissionRespondFrame>;

export const SessionInterruptFrame = BaseFrame.extend({
  t: z.literal('session.interrupt'),
  sessionId: z.string(),
});
export type SessionInterruptFrame = z.infer<typeof SessionInterruptFrame>;

export const PongFrame = BaseFrame.extend({
  t: z.literal('pong'),
});
export type PongFrame = z.infer<typeof PongFrame>;

// Union of all client frames
export const ClientFrame = z.discriminatedUnion('t', [
  AuthFrame,
  SubscribeFrame,
  SessionCreateFrame,
  SessionListFrame,
  PromptSendFrame,
  PermissionRespondFrame,
  SessionInterruptFrame,
  PongFrame,
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

// ─── Server → Client frames ──────────────────────────────────────────────────

export const HelloFrame = BaseFrame.extend({
  t: z.literal('hello'),
  bridgeVersion: z.string(),
  protocolVersion: z.literal(1),
  mode: z.enum(['live', 'mock']),
  capabilities: z.array(z.string()),
});
export type HelloFrame = z.infer<typeof HelloFrame>;

export const AckFrame = BaseFrame.extend({
  t: z.literal('ack'),
  ok: z.literal(true),
  result: z.unknown().optional(),
});
export type AckFrame = z.infer<typeof AckFrame>;

export const ErrorFrame = BaseFrame.extend({
  t: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type ErrorFrame = z.infer<typeof ErrorFrame>;

export const SessionStatus = z.enum([
  'idle',
  'working',
  'awaiting_permission',
  'awaiting_input',
  'error',
  'disconnected',
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionStateFrame = BaseFrame.extend({
  t: z.literal('session.state'),
  sessionId: z.string(),
  cwd: z.string(),
  status: SessionStatus,
  statusSource: z.enum(['observed', 'inferred']),
  statusReason: z.string().optional(),
  pendingApprovals: z.number(),
  lastActivity: z.number(),
});
export type SessionStateFrame = z.infer<typeof SessionStateFrame>;

export const RiskTier = z.enum(['low', 'medium', 'high']);
export type RiskTier = z.infer<typeof RiskTier>;

export const PermissionRequestFrame = BaseFrame.extend({
  t: z.literal('permission.request'),
  approvalId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  summary: z.string().max(80),
  toolInput: z.unknown(),
  riskTier: RiskTier,
  expiresAt: z.number(),
});
export type PermissionRequestFrame = z.infer<typeof PermissionRequestFrame>;

export const PermissionResolvedFrame = BaseFrame.extend({
  t: z.literal('permission.resolved'),
  approvalId: z.string(),
  decision: z.enum(['allow', 'deny']),
  resolution: z.enum(['user', 'policy', 'timeout']),
  resolvedBy: z.string().optional(),
  ruleId: z.string().optional(),
});
export type PermissionResolvedFrame = z.infer<typeof PermissionResolvedFrame>;

export const HeartbeatFrame = BaseFrame.extend({
  t: z.literal('heartbeat'),
});
export type HeartbeatFrame = z.infer<typeof HeartbeatFrame>;

// Union of all server frames
export const ServerFrame = z.discriminatedUnion('t', [
  HelloFrame,
  AckFrame,
  ErrorFrame,
  SessionStateFrame,
  PermissionRequestFrame,
  PermissionResolvedFrame,
  HeartbeatFrame,
]);
export type ServerFrame = z.infer<typeof ServerFrame>;
