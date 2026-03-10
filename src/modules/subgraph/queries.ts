/**
 * GraphQL query constants for subgraph integration.
 * Aave V3 + Uniswap V2 (KaspaCom DEX) subgraphs.
 */
export const QUERIES = {
  // ---------------------------------------------------------------------------
  // Aave V3 — Borrower Discovery
  // ---------------------------------------------------------------------------

  /** Get all users with active borrows (for liquidation monitoring). */
  ACTIVE_BORROWERS: `
    query GetActiveBorrowers($first: Int!, $skip: Int!) {
      users(
        where: { borrowedReservesCount_gt: 0 }
        first: $first
        skip: $skip
      ) {
        id
        borrowedReservesCount
      }
    }
  `,

  /** Get reserve configuration for risk assessment. */
  AAVE_RESERVES: `
    query GetReserves {
      reserves(first: 100) {
        id
        symbol
        name
        decimals
        underlyingAsset
        isActive
        isFrozen
        usageAsCollateralEnabled
        borrowingEnabled
        totalLiquidity
        totalATokenSupply
        totalCurrentVariableDebt
        liquidityRate
        variableBorrowRate
        utilizationRate
        price { priceInEth }
        baseLTVasCollateral
        reserveLiquidationThreshold
        reserveLiquidationBonus
      }
      priceOracles(first: 1) { usdPriceEth }
    }
  `,

  // ---------------------------------------------------------------------------
  // Uniswap V2 (DEX) — Pair Discovery
  // ---------------------------------------------------------------------------

  /** Discover all pairs ordered by liquidity. */
  ALL_PAIRS: `
    query GetAllPairs($first: Int!, $skip: Int!) {
      pairs(
        first: $first
        skip: $skip
        orderBy: reserveKAS
        orderDirection: desc
      ) {
        id
        token0 { id symbol decimals }
        token1 { id symbol decimals }
        reserveKAS
        reserve0
        reserve1
        totalSupply
        volumeKAS
      }
    }
  `,

  /** Get daily pair data for volume analysis. */
  PAIR_DAY_DATA: `
    query GetPairDayData($minDate: Int!, $first: Int!, $skip: Int!) {
      pairDayDatas(
        where: { date_gte: $minDate }
        first: $first
        skip: $skip
        orderBy: date
        orderDirection: desc
      ) {
        pairAddress
        date
        dailyVolumeKAS
        dailyTxns
        reserveKAS
      }
    }
  `,
} as const;
