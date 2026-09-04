/**
 * Sparse manual ordering (plan §5.6).
 *
 * Positions are spaced 100 apart, so dropping a row between two others is a
 * single write — set it to the midpoint — rather than renumbering everything
 * below it. The gaps halve with each insert in the same slot, and when they
 * run out `NormalizePositionsJob` spreads everything back out.
 */
export const POSITION_GAP = 100

/**
 * The position for a new row appended to the end.
 */
export function nextPosition(positions: number[]): number {
  if (positions.length === 0) {
    return POSITION_GAP
  }

  return Math.max(...positions) + POSITION_GAP
}

/**
 * The position for a row dropped between two neighbours.
 *
 * Returns `null` when there is no room left — the two neighbours are adjacent
 * integers — which is the signal to renumber the list before retrying.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) {
    return POSITION_GAP
  }

  if (before === null) {
    /**
     * Moving to the very top. Halving keeps the gap sparse without touching
     * any other row, until it reaches 1 and there is nowhere left to go.
     */
    return after! > 1 ? Math.floor(after! / 2) : null
  }

  if (after === null) {
    return before + POSITION_GAP
  }

  if (after - before <= 1) {
    return null
  }

  return before + Math.floor((after - before) / 2)
}

/**
 * Evenly spaced positions for a list in its current order — what the
 * normalisation job writes back.
 */
export function normalisedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_GAP)
}
