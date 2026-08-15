import { describe, expect, it } from 'vitest';
import { hostnameOf, pathKeyOf } from './url';

describe('hostnameOf', () => {
  it('extracts and lowercases the hostname', () => {
    expect(hostnameOf('https://Example.COM/path?q=1')).toBe('example.com');
    expect(hostnameOf('http://sub.example.com:8080/x')).toBe('sub.example.com');
  });

  it('returns empty string for file:// URLs', () => {
    expect(hostnameOf('file:///Users/x/a.html')).toBe('');
  });

  it('returns null for invalid URLs', () => {
    expect(hostnameOf('not a url')).toBeNull();
    expect(hostnameOf('')).toBeNull();
  });
});

describe('pathKeyOf', () => {
  it('strips query and hash', () => {
    expect(pathKeyOf('https://example.com/article?id=1#top')).toBe('https://example.com/article');
    expect(pathKeyOf('https://example.com/article?ref=2')).toBe('https://example.com/article');
  });

  it('keeps the path when no query/hash present', () => {
    expect(pathKeyOf('https://example.com/a/b')).toBe('https://example.com/a/b');
  });

  it('returns null for invalid URLs', () => {
    expect(pathKeyOf('nope')).toBeNull();
  });
});
