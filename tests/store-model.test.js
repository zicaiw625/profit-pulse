import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Prisma } from '@prisma/client';

import prisma from '../app/db.server.js';
import {
  ensureMerchantAndStore,
  isUniqueConstraintError,
} from '../app/models/store.server.js';

describe('isUniqueConstraintError', () => {
  it('identifies Prisma unique constraint errors', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`shopDomain`)',
      {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion?.client ?? 'test',
        meta: { target: ['shopDomain'] },
      },
    );

    assert.equal(isUniqueConstraintError(prismaError), true);
  });

  it('returns false for other errors', () => {
    const otherPrismaError = new Prisma.PrismaClientKnownRequestError('Missing', {
      code: 'P2001',
      clientVersion: Prisma.prismaVersion?.client ?? 'test',
    });

    assert.equal(isUniqueConstraintError(otherPrismaError), false);
    assert.equal(isUniqueConstraintError(new Error('boom')), false);
    assert.equal(isUniqueConstraintError(null), false);
  });
});

describe('ensureMerchantAndStore', () => {
  it('returns the existing store when a unique constraint is hit concurrently', async () => {
    const shopDomain = 'acme.myshopify.com';
    const merchant = {
      id: 'merchant-1',
      ownerEmail: 'owner@example.com',
      primaryCurrency: 'USD',
      primaryTimezone: 'UTC',
      subscription: { plan: 'BASIC', storeLimit: 5, orderLimit: 500 },
    };
    const existingStore = {
      id: 'store-1',
      shopDomain,
      merchantId: merchant.id,
      merchant,
    };

    const originalStore = prisma.store;
    const originalMerchant = prisma.merchantAccount;
    const originalSubscription = prisma.subscription;

    let findUniqueCalls = 0;
    prisma.store = {
      async findUnique() {
        findUniqueCalls += 1;
        if (findUniqueCalls === 1) {
          return null;
        }
        return existingStore;
      },
      async create() {
        const uniqueError = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`shopDomain`)',
          {
            code: 'P2002',
            clientVersion: Prisma.prismaVersion?.client ?? 'test',
          },
        );
        throw uniqueError;
      },
      async count() {
        return 0;
      },
    };
    prisma.merchantAccount = {
      async findFirst() {
        return merchant;
      },
      async create() {
        throw new Error('should not create a merchant when one already exists');
      },
    };
    prisma.subscription = {
      async findUnique() {
        return {
          plan: 'BASIC',
          orderLimit: 500,
          storeLimit: 5,
        };
      },
    };

    try {
      const result = await ensureMerchantAndStore(shopDomain, 'owner@example.com');
      assert.equal(result, existingStore);
      assert.equal(findUniqueCalls >= 2, true);
    } finally {
      prisma.store = originalStore;
      prisma.merchantAccount = originalMerchant;
      prisma.subscription = originalSubscription;
    }
  });

  it('re-throws unexpected persistence errors', async () => {
    const shopDomain = 'broken.myshopify.com';
    const failure = new Error('database offline');
    const originalStore = prisma.store;
    const originalMerchant = prisma.merchantAccount;
    const originalSubscription = prisma.subscription;

    prisma.store = {
      async findUnique() {
        return null;
      },
      async create() {
        throw failure;
      },
      async count() {
        return 0;
      },
    };
    prisma.merchantAccount = {
      async findFirst() {
        return null;
      },
      async create() {
        return {
          id: 'merchant-err',
          ownerEmail: 'new-owner@example.com',
          primaryCurrency: 'USD',
          primaryTimezone: 'UTC',
        };
      },
    };
    prisma.subscription = {
      async findUnique() {
        return {
          plan: 'BASIC',
          orderLimit: 500,
          storeLimit: 1,
        };
      },
    };

    try {
      await assert.rejects(
        () => ensureMerchantAndStore(shopDomain, 'new-owner@example.com'),
        (error) => {
          assert.equal(error, failure);
          return true;
        },
      );
    } finally {
      prisma.store = originalStore;
      prisma.merchantAccount = originalMerchant;
      prisma.subscription = originalSubscription;
    }
  });
});
