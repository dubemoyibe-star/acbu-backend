/**
 * Government segment: treasury view and statements.
 * For government actors (actorType === 'government'); reuse enterprise-style aggregates.
 */
import { Response, NextFunction } from "express";
import { Prisma, Reserve } from "@prisma/client";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { z } from "zod";

const governmentStatementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function getGovernmentTreasury(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId ?? null;
    const organizationId = req.apiKey?.organizationId ?? null;
    const actorFilter = userId ? { userId } : { user: { organizationId } };
    const minted = await prisma.transaction.aggregate({
      where: {
        type: "mint",
        status: "completed",
        ...actorFilter,
      },
      _sum: { acbuAmount: true },
    });
    const burned = await prisma.transaction.aggregate({
      where: {
        type: "burn",
        status: { in: ["completed", "processing"] },
        ...actorFilter,
      },
      _sum: { acbuAmountBurned: true },
    });
    const totalAcbu =
      (minted._sum.acbuAmount?.toNumber() ?? 0) -
      (burned._sum.acbuAmountBurned?.toNumber() ?? 0);

    const burnsByCurrency: Prisma.TransactionGroupByOutputType[] =
      await prisma.transaction.groupBy({
        by: ["localCurrency"],
        where: {
          type: "burn",
          status: { in: ["completed", "processing"] },
          localCurrency: { not: null },
          ...(userId ? { userId } : { user: { organizationId } }),
        },
        _sum: { localAmount: true, acbuAmountBurned: true },
      });

    const latestReserves = (await prisma.reserve.findMany({
      where: { segment: "transactions" },
      orderBy: { timestamp: "desc" },
      distinct: ["currency"],
    })) as Reserve[];

    const reserveMap = new Map<string, Reserve>(
      latestReserves.map((r) => [r.currency, r]),
    );

    const byCurrency = burnsByCurrency
      .filter(
        (
          b,
        ): b is Prisma.TransactionGroupByOutputType & {
          localCurrency: string;
        } => b.localCurrency !== null,
      )
      .map((b) => {
        const reserve = reserveMap.get(b.localCurrency);
        return {
          currency: b.localCurrency,
          burnedLocalAmount: b._sum?.localAmount?.toNumber() ?? 0,
          acbuBurned: b._sum?.acbuAmountBurned?.toNumber() ?? 0,
          reserveExposure: reserve?.reserveAmount.toNumber() ?? 0,
          reserveValueUsd: reserve?.reserveValueUsd.toNumber() ?? 0,
        };
      });

    res.status(200).json({
      totalBalanceAcbu: totalAcbu,
      byCurrency,
      message:
        "Government treasury view. Investment allocation and yield will appear when implemented.",
    });
  } catch (e) {
    next(e);
  }
}

export async function getGovernmentStatements(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId ?? null;
    const organizationId = req.apiKey?.organizationId ?? null;
    const query = governmentStatementsQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid limit" });
      return;
    }
    const { limit } = query.data;
    const transactions = await prisma.transaction.findMany({
      where: {
        type: { in: ["mint", "burn", "transfer"] },
        ...(userId ? { userId } : { user: { organizationId } }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        acbuAmount: true,
        acbuAmountBurned: true,
        usdcAmount: true,
        localCurrency: true,
        localAmount: true,
        fee: true,
        createdAt: true,
      },
    });
    res.status(200).json({
      statements: transactions,
      limit,
    });
  } catch (e) {
    next(e);
  }
}
