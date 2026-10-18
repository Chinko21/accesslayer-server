import { z } from 'zod';

export const BondStateSchema = z.enum(['deposited', 'released', 'forfeited']);
export type BondState = z.infer<typeof BondStateSchema>;

export const BondStatusResponseSchema = z.object({
  key_id: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a non-negative numeric string'),
  state: BondStateSchema,
  creator: z.string().min(1),
  currency: z.literal('XLM'),
  last_synced_at: z.string().datetime(),
  cached: z.boolean(),
  stale: z.boolean(),
});
export type BondStatusResponse = z.infer<typeof BondStatusResponseSchema>;

export const ForfeitureRecordSchema = z.object({
  id: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a non-negative numeric string'),
  reason: z.string().min(1),
  timestamp: z.string().datetime(),
  ledger: z.number().int().nonnegative().nullable(),
  tx_hash: z.string().nullable(),
});
export type ForfeitureRecord = z.infer<typeof ForfeitureRecordSchema>;

export const BondHistoryQuerySchema = z.object({
  limit: z.coerce(z.number().int().min(1).max(100)).default(20),
  cursor: z.string().min(1).optional(),
});
export type BondHistoryQuery = z.infer<typeof BondHistoryQuerySchema>;

export const BondHistoryResponseSchema = z.object({
  key_id: z.string().min(1),
  creator: z.string().min(1),
  forfeitures: z.array(ForfeitureRecordSchema),
  next_cursor: z.string().nullable(),
});
export type BondHistoryResponse = z.infer<typeof BondHistoryResponseSchema>;

export const BondKeyParamsSchema = z.object({
  key_id: z.string().min(1),
});
export type BondKeyParams = z.infer<typeof BondKeyParamsSchema>;

// Aliases for controller imports.
export const bondHistoryQuerySchema = BondHistoryQuerySchema;
export const bondKeyParamsSchema = BondKeyParamsSchema;
