import { test } from '@japa/runner'

import { nextPosition, normalisedPositions, positionBetween, POSITION_GAP } from '#todos/position'

/**
 * Sparse ordering (plan §5.6): positions 100 apart, so dropping a row between
 * two others is one write rather than a renumber of everything below it.
 */
test.group('Sparse positions', () => {
  test('the first row starts at the gap', ({ assert }) => {
    assert.equal(nextPosition([]), POSITION_GAP)
  })

  test('appending leaves a gap behind it', ({ assert }) => {
    assert.equal(nextPosition([100, 200, 300]), 400)
  })

  test('appending ignores order', ({ assert }) => {
    assert.equal(nextPosition([300, 100, 200]), 400)
  })

  test('dropping between two rows takes the midpoint', ({ assert }) => {
    assert.equal(positionBetween(100, 200), 150)
    assert.equal(positionBetween(100, 300), 200)
  })

  test('dropping at the end appends', ({ assert }) => {
    assert.equal(positionBetween(300, null), 400)
  })

  test('dropping at the top halves the first position', ({ assert }) => {
    assert.equal(positionBetween(null, 100), 50)
    assert.equal(positionBetween(null, 50), 25)
  })

  test('an empty list gets the gap', ({ assert }) => {
    assert.equal(positionBetween(null, null), POSITION_GAP)
  })

  /**
   * The condition NormalizePositionsJob exists for: enough drops in the same
   * slot and the neighbours become adjacent integers.
   */
  test('reports when there is no room left', ({ assert }) => {
    assert.isNull(positionBetween(100, 101))
    assert.isNull(positionBetween(100, 100))
    assert.isNull(positionBetween(null, 1))
  })

  test('halving runs out eventually', ({ assert }) => {
    let position: number | null = 100

    for (let i = 0; i < 10 && position !== null; i++) {
      position = positionBetween(null, position)
    }

    assert.isNull(position, 'and the job is what puts the gaps back')
  })

  test('renumbering spreads rows evenly', ({ assert }) => {
    assert.deepEqual(normalisedPositions(3), [100, 200, 300])
    assert.deepEqual(normalisedPositions(0), [])
  })
})
