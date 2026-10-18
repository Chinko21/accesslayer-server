// src/modules/creator/creator-bond.integration.test.ts

import request from 'supertest';
import express, { Express } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { CreatorBondService } from './creator-bond.service';
import { CreatorBondController } from './creator-bond.controller';
import { errorHandler, notFoundHandler } from '../../middlewares/error.middleware';

/** In-memory Prisma double covering the subset of the client used. */
interface FakeDb {
   creatorProfile: {
      findUnique: jest.Mock;
   };
   bondForfeiture: {
      findMany: jest.Mock;
      create: jest.Mock;
   };
   creatorBond: {
      upsert: jest.Mock;
   };
   $transaction: jest.Mock;
}

function buildApp(service: CreatorBondService): Express {
   const app = express();
   app.use(express.json());
   const ctrl = new CreatorBondController(service);
   app.get('/keys/:key_id/bond', ctrl.getBondStatus);
   app.get('/keys/:key_id/bond/history', ctrl.getForfeitureHistory);
   app.use(notFoundHandler);
   app.use(errorHandler);
   return app;
}

function makeDb(overrides: Partial<FakeDb> = {}): FakeDb {
   const base: FakeDb = {
      creatorProfile: { findUnique: jest.fn(() => null) },
      bondForfeiture: { findMany: jest.fn(() => []), create: jest.fn(() => ({})) },
      creatorBond: { upsert: jest.fn(() => ({})) },
      $transaction: jest.fn(async (cb: any) =>
         cb({
            bondForfeiture: { create: jest.fn(() => ({})) },
            creatorBond: { upsert: jest.fn(() => ({})) },
         })
      ),
   };
   return { ...base, ...overrides };
}

function makeDbClient(overrides: Record<string, any> = {}): PrismaClient {
   const base = makeDb();
   return {
      creatorProfile: base.creatorProfile,
      bondForfeiture: base.bondForfeiture,
      creatorBond: base.creatorBond,
      $transaction: base.$transaction,
      ...overrides,
   } as unknown as PrismaClient;
}

describe('Creator bond status API', () => {
  const keyId = 'key_abc123';

  it('returns amount, state and creator for a deposited bond', async () => {
    const db = makeDbClient({
      findUnique: jest.fn(() => ({
        id: keyId,
        handle: 'alice',
        bond: {
          id: 'b1',
          amountXlm: new Prisma.Decimal('100'),
          state: 'deposited',
        },
      })),
    });
    const service = new CreatorBondService(db, {
      getBondStatus: async () => ({
        amount_xlm: '100',
        state: 'deposited',
        creator: 'alice',
      }),
    });
    const app = buildApp(service);
    const res = await request(app).get(`/keys/${keyId}/bond`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      key_id: keyId,
      creator: 'alice',
      amount: '100',
      state: 'deposited',
      currency: 'XLM',
    });
  });

  it('returns 404 for keys with no bond record', async () => {
    const db = makeDbClient({
      findUnique: jest.fn(() => ({ id: keyId, handle: 'alice', bond: null })),
    });
    const service = new CreatorBondService(db, {
      getBondStatus: async () => null,
    });
    const app = buildApp(service);
    const res = await request(app).get(`/keys/${keyId}/bond`);
    expect(res.status).toBe(404);
  });

  it('serves stale value while revalidating in the background', async () => {
    const db = makeDbClient();
    let calls = 0;
    const service = new CreatorBondService(db, {
      getBondStatus: async () => {
        calls += 1;
        return { amount_xlm: '100', state: 'deposited', creator: 'alice' };
      },
    });
    const app = buildApp(service);

    const first = await request(app).get(`/keys/${keyId}/bond`);
    expect(first.status).toBe(200);
    expect(calls).toBe(1);

    // Second request hits the fresh cache.
    const second = await request(app).get(`/keys/${keyId}/bond`);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);
    expect(second.body.data.cached).toBe(true);
  });

  it('returns forfeiture history in desc order', async () => {
    const now = Date.now();
    const rows = [
      {
        id: 'f2',
        amountXlm: new Prisma.Decimal('50'),
        reason: 'slash',
        timestamp: new Date(now),
        ledger: 200,
        txHash: '0x2',
      },
      {
        id: 'f1',
        amountXlm: new Prisma.Decimal('25'),
        reason: 'missed',
        timestamp: new Date(now - 1000),
        ledger: 100,
        txHash: '0x1',
      },
    ];
    const db = makeDbClient({
      findUnique: jest.fn(() => ({
        id: keyId,
        handle: 'alice',
        bond: { id: 'b1' },
      })),
    });
    (db.bondForfeiture.findMany as jest.Mock).mockResolvedValue(rows);
    const service = new CreatorBondService(db, {
      getBondStatus: async () => null,
    });
    const app = buildApp(service);
    const res = await request(app).get(`/keys/${keyId}/bond/history`);
    expect(res.status).toBe(200);
    expect(res.body.data.forfeitures).toHaveLength(2);
    expect(res.body.data.forfeitures[0].reason).toBe('slash');
    expect(res.body.data.forfeitures[1].reason).toBe('missed');
  });

  it('indexes BondForfeited events and invalidates cache', async () => {
    const create = jest.fn(() => ({}));
    const upsert = jest.fn(() => ({}));
    const db = makeDbClient({
      findUnique: jest.fn(() => ({
        id: keyId,
        handle: 'alice',
        bond: {
          id: 'b1',
          amountXlm: new Prisma.Decimal('100'),
          state: 'deposited',
        },
      })),
    });
    (db.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb({
        bondForfeiture: { create },
        creatorBond: { upsert },
      })
    );
    const service = new CreatorBondService(db, {
      getBondStatus: async () => ({
        amount_xlm: '100',
        state: 'deposited',
        creator: 'alice',
      }),
    });
    await service.getBondStatus(keyId);
    await service.indexBondForfeited({
      creatorId: keyId,
      amountXlm: '100',
      reason: 'slash',
      timestamp: new Date(),
      ledger: 123,
      txHash: '0xabc',
      eventId: 'exv-1',
    });
    expect(create).toHaveBeenCalled(1);
    expect(upsert).toHaveBeenCalled(1);
  });
});
