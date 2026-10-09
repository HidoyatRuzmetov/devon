import { describe, expect, it } from 'vitest'
import { elementBounds, movedElement } from '../../src/features/personal/canvas-editor.js'
import type { CanvasElement } from '../../src/features/personal/types.js'

describe('persisted canvas geometry', () => {
  it('bounds a long stroke which still fits the existing scene size limit', () => {
    const drawing: CanvasElement = {
      id: 'long',
      type: 'freehand',
      x: 80,
      y: 80,
      w: 0,
      h: 0,
      color: '#1f2937',
      strokeWidth: 2,
      points: Array.from({ length: 140_000 }, (_, index) => ({
        x: 80 + (index % 100),
        y: 80 + (index % 30),
      })),
    }
    expect(JSON.stringify({ elements: [drawing], appState: {} }).length).toBeLessThan(3_000_000)
    expect(elementBounds(drawing)).toEqual({ x: 80, y: 80, w: 99, h: 29 })
  })

  it('moves absolute stroke points without mutating the snapshot used by undo', () => {
    const drawing: CanvasElement = {
      id: 'stroke',
      type: 'freehand',
      x: 80,
      y: 80,
      w: 0,
      h: 0,
      color: '#1f2937',
      strokeWidth: 2,
      points: [
        { x: 80, y: 80 },
        { x: 130, y: 100 },
      ],
    }
    const next = movedElement(drawing, 20, -10)
    expect(next.points).toEqual([
      { x: 100, y: 70 },
      { x: 150, y: 90 },
    ])
    expect(elementBounds(next)).toEqual({ x: 100, y: 70, w: 50, h: 20 })
    expect(drawing.points).toEqual([
      { x: 80, y: 80 },
      { x: 130, y: 100 },
    ])
  })
})
