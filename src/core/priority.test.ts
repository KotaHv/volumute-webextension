import { describe, expect, it } from 'vitest'
import { computeMultiplier, isAutoMuted } from './priority'

describe('computeMultiplier', () => {
  it('returns default 1x when nothing is configured', () => {
    expect(computeMultiplier({}, {}, '/p', 'example.com')).toBe(1)
  })

  it('prefers page volume over site volume', () => {
    const pageVolumes = { 'https://example.com/p': { v: 2, t: 1 } }
    const siteVolumes = { 'example.com': { v: 0.5, t: 1 } }
    expect(computeMultiplier(pageVolumes, siteVolumes, 'https://example.com/p', 'example.com')).toBe(2)
  })

  it('falls back to site volume when no page volume matches', () => {
    const siteVolumes = { 'example.com': { v: 0.25, t: 1 } }
    expect(computeMultiplier({}, siteVolumes, 'https://example.com/other', 'example.com')).toBe(0.25)
  })

  it('page volume does not leak to other pages of the same site', () => {
    const pageVolumes = { 'https://example.com/a': { v: 2, t: 1 } }
    expect(computeMultiplier(pageVolumes, {}, 'https://example.com/b', 'example.com')).toBe(1)
  })

  it('clamps out-of-range values', () => {
    expect(computeMultiplier({ 'https://x/': { v: 99, t: 1 } }, {}, 'https://x/', 'x')).toBe(5)
    expect(computeMultiplier({ 'https://x/': { v: -3, t: 1 } }, {}, 'https://x/', 'x')).toBe(0)
    expect(computeMultiplier({ 'https://x/': { v: NaN, t: 1 } }, {}, 'https://x/', 'x')).toBe(1)
  })
})

describe('isAutoMuted', () => {
  it('true when the host is muted', () => {
    expect(isAutoMuted({ 'example.com': { enabled: true, ts: 1, deviceId: 'a' } }, 'example.com')).toBe(true)
  })

  it('false when the entry exists but is disabled', () => {
    expect(isAutoMuted({ 'example.com': { enabled: false, ts: 1, deviceId: 'a' } }, 'example.com')).toBe(false)
  })

  it('false when the host is not configured', () => {
    expect(isAutoMuted({}, 'example.com')).toBe(false)
  })
})
