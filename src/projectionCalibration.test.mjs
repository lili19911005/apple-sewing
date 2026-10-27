import test from 'node:test'
import assert from 'node:assert/strict'
import { correctMeasuredSize, defaultCalibrationCorners as rectangle, isRectangle, isValidCalibration, moveCalibrationCorner } from './projectionCalibration.ts'

test('a 9.8 × 9.9 cm projection is enlarged independently to reach 10 × 10 cm', () => {
  const corrected = correctMeasuredSize(rectangle, 10, 10, 9.8, 9.9)
  assert.ok(Math.abs(corrected[1].x * 9.8 - 10) < 1e-10)
  assert.ok(Math.abs(corrected[2].y * 9.9 - 10) < 1e-10)
  assert.ok(isRectangle(corrected))
})

test('measurement correction preserves the anchor and scales large patterns consistently', () => {
  const offset = rectangle.map(({ x, y }) => ({ x: x + 0.2, y: y + 0.3 }))
  const corrected = correctMeasuredSize(offset, 10, 10, 12, 8)
  assert.deepEqual(corrected[0], offset[0])
  assert.ok(Math.abs((corrected[1].x - corrected[0].x) * 12 * 5 - 50) < 1e-10)
  for (const invalid of [0, -1, NaN, Infinity]) assert.equal(correctMeasuredSize(offset, 10, 10, invalid, 10), null)
})

test('moving each rectangle corner keeps parallel edges and the opposite anchor', () => {
  for (let index = 0; index < 4; index++) {
    const point = { x: rectangle[index].x + 0.1 / 420, y: rectangle[index].y - 0.1 / 420 }
    const result = moveCalibrationCorner(rectangle, index, point, false)
    assert.ok(isRectangle(result))
    assert.ok(isValidCalibration(result))
    assert.deepEqual(result[index], point)
    assert.deepEqual(result[(index + 2) % 4], rectangle[(index + 2) % 4])
  }
})

test('perspective mode moves only the selected corner and rejects crossed/degenerate quads', () => {
  const changed = moveCalibrationCorner(rectangle, 0, { x: 0.05, y: 0.1 }, true)
  assert.ok(!isRectangle(changed))
  assert.ok(isValidCalibration(changed))
  assert.deepEqual(changed.slice(1), rectangle.slice(1))
  assert.ok(!isValidCalibration([rectangle[0], rectangle[2], rectangle[1], rectangle[3]]))
  assert.ok(!isValidCalibration(rectangle.map(() => ({ x: 0, y: 0 }))))
  assert.ok(!isValidCalibration([]))
})
