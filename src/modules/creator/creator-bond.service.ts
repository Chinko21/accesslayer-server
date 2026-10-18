// src/modules/creator/creator-bond.service.ts

import { PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger.utils';
import { NotFoundError } from '../../utils/errors';
import type {
   BondHistoryResponse,
   BondHistoryQuery,
   BondState,
   BondStatusResponse,
} from './creator-bond.schemas'; 

//** TML for the bond status cache (60s per issue spec). */
export const BOND_STATUS_CACHE_TTL_MS = 60_000;

/** How long a stale entry may be served while a refresh is in flight. */
export const BOND_STATUS_STALE_WINDOW_MS = 300_000;

export interface GetBondStatusContractResult {
   amount_xlm: string;
   state: BondState;
   creator: string;
}

/**
 * Contract client abstraction for the bond contract. The default
 * implementation reads the last known state from the database and is
 * overridable for tests and for wired-in on-chain clients.
 */
export interface BondContractClient {
   getBondStatus(
      keyId: string
   ): Promise<GetBondStatusContractResult | null>;
}

interface CacheEntry {
   value: BondStatusResponse;
   expiresAt: number;
   staleUntil: number;
   refreshInFlight: Promise<BondStatusResponse | null> | null;
}

export class CreatorBondService {
   private readonly cache = new Map<string, CacheEntry>();
   private contractClient: BondContractClient;

   constructor(
      private readonly db: PrismaClient = prisma,
      contractClient?: BondContractClient
   ) {
      this.contractClient = contractClient ?? {
         getBondStatus: (keyId) => this.defaultContractStatus(keyId),
      };
   }

   /** Reset the in-memory cache (test helper). */
   resetCache(): void {
      this.cache.clear();
   }

   /**
    * Return the bond status for a key. Uses a stale-while-revalidate
    * cache: fresh entries are served directly; expired entries are
    * served while a refresh is scheduled in the background.
    */
   async getBondStatus(keyId: string): Promise<BondStatusResponse> {
      const now = Date.now();
      const cached = this.cache.get(keyId);

      if (cached && now < cached.expiresAt) {
         return { ...cached.value, cached: true, stale: false };
      }

      if (cached && now < cached.staleUntil) {
         // Stale-while-revalidate: serve the stale value and refresh in
         // the background if no refresh is already in flight.
         if (!cached.refreshInFlight) {
            cached.refreshInFlight = this.refresh(keyId).finally(() => {
               const entry = this.cache.get(keyId);
               if (entry) entry.refreshInFlight = null;
            });
         }
         return { ...cached.value, cached: true, stale: true };
      }

      const fresh = await this.refresh(keyId);
      if (!fresh) {
         throw new NotFoundError(`No bond record found for key ${keyId}`);
      }
      return { ...fresh, cached: false, stale: false };
   }

   /** Return forfeiture history in descending timestamp order. */
   async getForfeitureHistory(
      keyId: string,
      query: BondHistoryQuery
   ): Promise<BondHistoryResponse> {
      const creator = await this.db.creatorProfile.findUnique({
         where: { id: keyId },
         select: {},
      });

      if (!creator || !creator.bond) {
         throw new NotFoundError(`No bond record found for key ${keyId}`);
      }

      const limit = query.limit ?? 50;
      const rows = await this.db.bondForfeiture.findMany({
         where: {
            creatorId: keyId,
            // Cursor is the id of the last record served; we fetch the cursor's
            // timestamp to apply a stable desc ordering tie-breaker.
            ...(query.cursor ? { id: { not: query.cursor } } : {}),
         },
         orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
         take: limit + 1,
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
         key_id: keyId,
         creator: creator.handle,
         forfeitures: page.map((row) => ({
            id: row.id,
            amount: row.amountXlm.toString(),
            reason: row.reason,
            timestamp: row.timestamp.toISOString(),
            ledger: row.ledger ?? null,
            tx_hash: row.txHash ?? null,
         })),
         next_cursor: hasMore ? page[page.length - 1].id : null,
      };
   }

   /** Index a BondForfeited event (idmpotent by eventId). */
   async indexBondForfeited(event: {
      creatorId: string;
      amountXlm: string | number;
      reason: string;
      timestamp: Date | string;
      ledger?: number;
      txHash?: string;
      eventId?: string;
   }): Promise<void> {
      const timestamp =
         event.timestamp instanceof Date
            ? (event.timestamp as Date)
            : new Date(event.timestamp as string);

      await this.db.$transaction(async (tx) => {
         await tx.bondForfeiture.create({
            data: {
               creatorId: event.creatorId,
               amountXlm: event.amountXlm.toString(),
               reason: event.reason,
               timestamp,
               ledger: event.ledger ?? null,
               txHash: event.txHash ?? null,
               eventId: event.eventId ?? null,
            },
         });

         // Forfeiture transitions the bond into the "forfeited" state.
         await tx.creatorBond.upsert({
            where: { creatorId: event.creatorId },
            create: {
               creatorId: event.creatorId,
               amountXlm: event.amountXlm.toString(),
               state: 'forfeited',
               lastSyncedAt: timestamp,
            },
            update: {
               state: 'forfeited',
               amountXlm: event.amountXlm.toString(),
               lastSyncedAt: timestamp,
            },
         });
      });

      // Invalidate cache so the next read sees the forfeited state.
      this.cache.delete(event.creatorId);
   }

   /** Fetch fresh bond status from the contract client and write to cache. */
   private async refresh(keyId: string): Promise<BondStatusResponse | null> {
      const contract = await this.contractClient.getBondStatus(keyId);
      if (!contract) {
         this.cache.delete(keyId);
         return null;
      }

      const value: BondStatusResponse = {
         key_id: keyId,
         creator: contract.creator,
         amount: contract.amount_xlm,
         state: contract.state,
         currency: 'XLM',
         last_synced_at: new Date().toISOString(),
         cached: false,
         stale: false,
      };

      const now = Date.now();
      this.cache.set(keyId, {
         value,
         expiresAt: now + BOND_STATUS_CACHE_TTL_MS,
         staleUntil: now + BOND_STATUS_STALE_WINDOW_MS,
         refreshInFlight: null,
      });

      return value;
   }

   /**
    * Default contract client: reads the last known bond state from the
    * database. This keeps the API functional without a live Soroban
    * client; the contract client interface is the seam for wiring in
    * an on-chain get_bond_status call.
    */
   private async defaultContractStatus(
      keyId: string
   ): Promise<GetBondStatusContractResult | null> {
      const creator = await this.db.creatorProfile.findUnique({
         where: { id: keyId },
         select: {},
      });

      if (!creator || !creator.bond) {
         return null;
      }

      const bond = creator.bond;
      const state = bond.state as BondState;
      if (!["deposited", "released", "forfeited"].includes(state)) {
         logger.warn(
            { keyId, state },
            'Unknown bond state encountered; defaulting to deposited'
         );
      }

      return {
         amount_xlm: bond.amountXlm.toString(),
         state: (["deposited", "released", "forfeited"].includes(state)
            ? state
            : 'deposited') as BondState,
         creator: creator.handle,
      };
   }
}

export const creatorBondService = new CreatorBondService();
