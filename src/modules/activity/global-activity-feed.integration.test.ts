// Integration test: global activity feed endpoint returning five most recent transactions (#741)
//
// Acceptance Criteria:
//   - Exactly five entries returned when more than five exist
//   - Entries are the five most recent by timestamp (newest first)
//   - All required fields present: wallet (truncated), action, creator_wallet, key_amount, created_at
//   - Endpoint accessible without authentication (HTTP 200)
//   - Empty array returned when no transactions exist

import supertest from 'supertest';
import app from '../../app';
import { prisma } from '../../utils/prisma.utils';
import { truncateWallet } from '../../utils/wallet-display.utils';

jest.mock('../../utils/prisma.utils', () => ({
   prisma: {
      activity: {
         findMany: jest.fn(),
         count: jest.fn(),
      },
   },
}));

const mockPrisma = prisma as unknown as {
   activity: { findMany: jest.Mock; count: jest.Mock };
};

// ── Test Fixtures ─────────────────────────────────────────────────────────────

const CREATOR_WALLET_1 =
   'GCREATOR11111111111111111111111111111111111111111111111';
const CREATOR_WALLET_2 =
   'GCREATOR22222222222222222222222222222222222222222222222';
const CREATOR_WALLET_3 =
   'GCREATOR33333333333333333333333333333333333333333333333';

const ACTOR_WALLET_1 = 'GACTOR111111111111111111111111111111111111111111111111';
const ACTOR_WALLET_2 = 'GACTOR222222222222222222222222222222222222222222222222';
const ACTOR_WALLET_3 = 'GACTOR333333333333333333333333333333333333333333333333';

// Seven transactions seeded across three creators at distinct timestamps T1 < T2 < ... < T7
const SEEDED_TRANSACTIONS = [
   {
      id: 'tx-1',
      type: 'KEY_BOUGHT',
      actor: ACTOR_WALLET_1,
      creatorId: 'creator-1',
      target: null,
      payload: {
         action: 'buy',
         wallet: truncateWallet(ACTOR_WALLET_1),
         creator_wallet: CREATOR_WALLET_1,
         key_amount: 1,
         amount: 1,
         price_at_trade: '1000000',
      },
      createdAt: new Date('2026-08-17T10:00:00.000Z'),
   },
   {
      id: 'tx-2',
      type: 'KEY_SOLD',
      actor: ACTOR_WALLET_2,
      creatorId: 'creator-2',
      target: null,
      payload: {
         action: 'sell',
         wallet: truncateWallet(ACTOR_WALLET_2),
         creator_wallet: CREATOR_WALLET_2,
         key_amount: 2,
         amount: 2,
         price_at_trade: '1200000',
      },
      createdAt: new Date('2026-08-17T11:00:00.000Z'),
   },
   {
      id: 'tx-3',
      type: 'KEY_BOUGHT',
      actor: ACTOR_WALLET_3,
      creatorId: 'creator-3',
      target: null,
      payload: {
         action: 'buy',
         wallet: truncateWallet(ACTOR_WALLET_3),
         creator_wallet: CREATOR_WALLET_3,
         key_amount: 3,
         amount: 3,
         price_at_trade: '1500000',
      },
      createdAt: new Date('2026-08-17T12:00:00.000Z'),
   },
   {
      id: 'tx-4',
      type: 'KEY_SOLD',
      actor: ACTOR_WALLET_1,
      creatorId: 'creator-2',
      target: null,
      payload: {
         action: 'sell',
         wallet: truncateWallet(ACTOR_WALLET_1),
         creator_wallet: CREATOR_WALLET_2,
         key_amount: 4,
         amount: 4,
         price_at_trade: '1800000',
      },
      createdAt: new Date('2026-08-17T13:00:00.000Z'),
   },
   {
      id: 'tx-5',
      type: 'KEY_BOUGHT',
      actor: ACTOR_WALLET_2,
      creatorId: 'creator-1',
      target: null,
      payload: {
         action: 'buy',
         wallet: truncateWallet(ACTOR_WALLET_2),
         creator_wallet: CREATOR_WALLET_1,
         key_amount: 5,
         amount: 5,
         price_at_trade: '2000000',
      },
      createdAt: new Date('2026-08-17T14:00:00.000Z'),
   },
   {
      id: 'tx-6',
      type: 'KEY_SOLD',
      actor: ACTOR_WALLET_3,
      creatorId: 'creator-3',
      target: null,
      payload: {
         action: 'sell',
         wallet: truncateWallet(ACTOR_WALLET_3),
         creator_wallet: CREATOR_WALLET_3,
         key_amount: 6,
         amount: 6,
         price_at_trade: '2200000',
      },
      createdAt: new Date('2026-08-17T15:00:00.000Z'),
   },
   {
      id: 'tx-7',
      type: 'KEY_BOUGHT',
      actor: ACTOR_WALLET_1,
      creatorId: 'creator-3',
      target: null,
      payload: {
         action: 'buy',
         wallet: truncateWallet(ACTOR_WALLET_1),
         creator_wallet: CREATOR_WALLET_3,
         key_amount: 7,
         amount: 7,
         price_at_trade: '2500000',
      },
      createdAt: new Date('2026-08-17T16:00:00.000Z'),
   },
];

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('GET /api/v1/activity — global activity feed five most recent transactions (#741)', () => {
   beforeEach(() => {
      jest.clearAllMocks();

      mockPrisma.activity.findMany.mockImplementation(async (args: any) => {
         const { take = 20, skip = 0 } = args || {};
         const sorted = [...SEEDED_TRANSACTIONS].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
         );
         return sorted.slice(skip, skip + take);
      });

      mockPrisma.activity.count.mockImplementation(async () => {
         return SEEDED_TRANSACTIONS.length;
      });
   });

   it('accessible without authentication', async () => {
      const res = await supertest(app).get('/api/v1/activity?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
   });

   it('returns exactly five entries when seven transactions exist', async () => {
      const res = await supertest(app).get('/api/v1/activity?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(5);
      expect(res.body.data.meta.total).toBe(7);
   });

   it('returns the five most recent transactions ordered newest first by timestamp', async () => {
      const res = await supertest(app).get('/api/v1/activity?limit=5');

      const items = res.body.data.items;
      expect(items).toHaveLength(5);

      // Expected 5 most recent IDs in descending order: tx-7, tx-6, tx-5, tx-4, tx-3
      const returnedIds = items.map((item: any) => item.id);
      expect(returnedIds).toEqual(['tx-7', 'tx-6', 'tx-5', 'tx-4', 'tx-3']);

      // Assert timestamps are strictly descending
      for (let i = 0; i < items.length - 1; i++) {
         const current = new Date(
            items[i].created_at || items[i].createdAt
         ).getTime();
         const next = new Date(
            items[i + 1].created_at || items[i + 1].createdAt
         ).getTime();
         expect(current).toBeGreaterThan(next);
      }

      // Assert oldest two transactions (tx-1 and tx-2) are excluded
      expect(returnedIds).not.toContain('tx-1');
      expect(returnedIds).not.toContain('tx-2');
   });

   it('includes required fields (wallet, action, creator_wallet, key_amount, created_at) in each entry', async () => {
      const res = await supertest(app).get('/api/v1/activity?limit=5');

      const items = res.body.data.items;
      expect(items).toHaveLength(5);

      for (const item of items) {
         expect(item.wallet).toBeDefined();
         expect(typeof item.wallet).toBe('string');
         expect(item.wallet).toContain('…');

         expect(item.action).toBeDefined();
         expect(['buy', 'sell', 'KEY_BOUGHT', 'KEY_SOLD']).toContain(
            item.action
         );

         expect(item.creator_wallet).toBeDefined();
         expect(typeof item.creator_wallet).toBe('string');

         expect(item.key_amount).toBeDefined();
         expect(typeof item.key_amount).toBe('number');
         expect(item.key_amount).toBeGreaterThan(0);

         expect(item.created_at || item.createdAt).toBeDefined();
         expect(
            new Date(item.created_at || item.createdAt).getTime()
         ).not.toBeNaN();
      }
   });

   it('returns an empty array when no transactions exist', async () => {
      mockPrisma.activity.findMany.mockResolvedValue([]);
      mockPrisma.activity.count.mockResolvedValue(0);

      const res = await supertest(app).get('/api/v1/activity?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.meta.total).toBe(0);
   });
});
