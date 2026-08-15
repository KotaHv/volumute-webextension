export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function pathKeyOf(url: string): string | null {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href;
  } catch {
    return null;
  }
}
