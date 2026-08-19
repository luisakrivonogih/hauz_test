import { describe, expect, it } from 'vitest'
import { relatedId } from './hauz'

describe('relatedId', () => {
  it('returns the value unchanged when given a plain id string', () => {
    expect(relatedId('abc-123')).toBe('abc-123')
  })

  it('extracts $id when given an expanded related row', () => {
    expect(relatedId({ $id: 'abc-123' })).toBe('abc-123')
  })
})
