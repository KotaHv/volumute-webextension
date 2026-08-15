import { describe, expect, it } from 'vitest'
import { computeMultiplier, isAutoMuted } from './priority'

describe('computeMultiplier', () => {
  it('returns default 1x when nothing is configured', () => {
    expect(computeMultiplier({}, {}, '/p', 'example.com')).toBe(1)
  })

  it('prefers page volume over site volume', () => {
    const pageVolumes = { 'https://example.com/p': { multiplier: 2, created: 1, lastUsed: 1 } }
    const siteVolumes = { 'example.com': { multiplier: 0.5, created: 1, lastUsed: 1 } }
    expect(computeMultiplier(pageVolumes, siteVolumes, 'https://example.com/p', 'example.com')).toBe(2)
  })

  it('falls back to site volume when no page volume matches', () => {
    const siteVolumes = { 'example.com': { multiplier: 0.25, created: 1, lastUsed: 1 } }
    expect(computeMultiplier({}, siteVolumes, 'https://example.com/other', 'example.com')).toBe(0.25)
  })

  it('page volume does not leak to other pages of the same site', () => {
    const pageVolumes = { 'https://example.com/a': { multiplier: 2, created: 1, lastUsed: 1 } }
    expect(computeMultiplier(pageVolumes, {}, 'https://example.com/b', 'example.com')).toBe(1)
  })

  it('clamps out-of-range values', () => {
    expect(computeMultiplier({ 'https://x/': { multiplier: 99, created: 1, lastUsed: 1 } }, {}, 'https://x/', 'x')).toBe(5)
    expect(computeMultiplier({ 'https://x/': { multiplier: -3, created: 1, lastUsed: 1 } }, {}, 'https://x/', 'x')).toBe(0)
    expect(computeMultiplier({ 'https://x/': { multiplier: NaN, created: 1, lastUsed: 1 } }, {}, 'https://x/', 'x')).toBe(1)
  })
})

describe('isAutoMuted', () => {
  it('true when the host is muted', () => {
    expect(isAutoMuted({ 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'a' } }, 'example.com')).toBe(true)
  })

  it('false when the entry exists but is disabled', () => {
    expect(isAutoMuted({ 'example.com': { enabled: false, created: 1, lastUsed: 1, deviceId: 'a' } }, 'example.com')).toBe(false)
  })

  it('false when the host is not configured', () => {
    expect(isAutoMuted({}, 'example.com')).toBe(false)
  })
})
