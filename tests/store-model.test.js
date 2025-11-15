import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Prisma } from '@prisma/client';

import { isUniqueConstraintError } from '../app/models/store.server.js';

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
