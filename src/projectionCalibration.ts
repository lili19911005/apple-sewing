export type CalibrationCorner = { x: number; y: number }

export const defaultCalibrationCorners: CalibrationCorner[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
]

export function isRectangle(corners: CalibrationCorner[]) {
  return Math.abs(corners[0].y - corners[1].y) < 1e-8
    && Math.abs(corners[1].x - corners[2].x) < 1e-8
    && Math.abs(corners[2].y - corners[3].y) < 1e-8
    && Math.abs(corners[3].x - corners[0].x) < 1e-8
}

export function isValidCalibration(corners: CalibrationCorner[]) {
  if (corners.length !== 4 || corners.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return false
  // Preserve clockwise, convex corners. Crossed or collapsed edges produce a singular homography.
  return corners.every((a, index) => {
    const b = corners[(index + 1) % 4]
    const c = corners[(index + 2) % 4]
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 1e-6
  })
}

export function moveCalibrationCorner(corners: CalibrationCorner[], index: number, point: CalibrationCorner, perspective: boolean) {
  if (perspective) return corners.map((corner, i) => i === index ? point : corner)
  const opposite = corners[(index + 2) % 4]
  const left = index === 0 || index === 3 ? point.x : opposite.x
  const right = index === 1 || index === 2 ? point.x : opposite.x
  const top = index < 2 ? point.y : opposite.y
  const bottom = index >= 2 ? point.y : opposite.y
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
}

export function correctMeasuredSize(corners: CalibrationCorner[], targetWidth: number, targetHeight: number, measuredWidth: number, measuredHeight: number) {
  if (![targetWidth, targetHeight, measuredWidth, measuredHeight].every((value) => Number.isFinite(value) && value > 0)) return null
  const origin = corners[0]
  const corrected = corners.map((corner) => ({
    x: origin.x + (corner.x - origin.x) * targetWidth / measuredWidth,
    y: origin.y + (corner.y - origin.y) * targetHeight / measuredHeight,
  }))
  return isValidCalibration(corrected) ? corrected : null
}
