/**
 * Host-aware theme detection. ChatGPT, Gemini, and Claude all ship
 * in-app theme toggles that override the OS preference, so the OS
 * media query alone is unreliable. Inspect the explicit class/
 * attribute markers those apps use, fall back to measured background
 * luminance, then to the media query. Live switches are observed via
 * attribute mutations + media changes so already-mounted surfaces
 * restyle instantly.
 */

export type ThemeMode = 'dark' | 'light';

export function detectHostTheme(): ThemeMode {
  const html = document.documentElement;
  const body = document.body;

  // 1. Explicit class/attribute markers used by the big three.
  if (
    html.classList.contains('dark') ||
    body?.classList.contains('dark-theme') ||
    body?.classList.contains('dark') ||
    html.getAttribute('data-theme') === 'dark' ||
    html.getAttribute('data-mode') === 'dark' ||
    body?.getAttribute('data-theme') === 'dark' ||
    html.style.colorScheme === 'dark'
  ) {
    return 'dark';
  }

  if (
    html.classList.contains('light') ||
    body?.classList.contains('light-theme') ||
    body?.classList.contains('light') ||
    html.getAttribute('data-theme') === 'light' ||
    html.getAttribute('data-mode') === 'light' ||
    body?.getAttribute('data-theme') === 'light' ||
    html.style.colorScheme === 'light'
  ) {
    return 'light';
  }

  // 2. Fallback: measured luminance of the body background.
  if (body) {
    const bg = window.getComputedStyle(body).backgroundColor;
    const match = bg.match(/\d+/g);
    if (match && match.length >= 3) {
      const [r, g, b] = match.map(Number);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (luminance > 0.6) return 'light';
      if (luminance < 0.4) return 'dark';
    }
  }

  // 3. Final fallback: OS media query.
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Re-notifies on host theme switches (class/data attrs/OS scheme). */
export function observeThemeChanges(onThemeChange: (theme: ThemeMode) => void): void {
  const notify = (): void => onThemeChange(detectHostTheme());

  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-mode', 'style'],
  });
  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
  }

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', notify);
}
