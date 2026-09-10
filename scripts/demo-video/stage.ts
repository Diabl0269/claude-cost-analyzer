/**
 * The stage: a synthetic cursor, full-screen title cards, and the small set of paced
 * interactions a scene is allowed to use. Everything here is deliberately forgiving — a missing
 * element logs and returns, because a demo recording that aborts halfway is worth nothing.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * A 22 px pointer that follows real mousemove events, plus a ripple on mousedown.
 * Injected as an init script so it survives every navigation, and `pointer-events: none` so it
 * can never intercept the click it is drawing.
 */
export const CURSOR_INIT = `(() => {
  const ID = '__cca_demo_cursor';
  const install = () => {
    if (!document.body || document.getElementById(ID)) return;
    const el = document.createElement('div');
    el.id = ID;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:22px', 'height:22px',
      'pointer-events:none', 'z-index:2147483646', 'opacity:0',
      'transition:opacity 180ms ease', 'will-change:transform',
      'transform:translate3d(-40px,-40px,0)',
    ].join(';');
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><filter id="__cca_cur_sh" x="-60%" y="-60%" width="240%" height="240%">'
      + '<feDropShadow dx="0.6" dy="1.2" stdDeviation="1.1" flood-color="#000" flood-opacity="0.42"/>'
      + '</filter></defs>'
      + '<path filter="url(#__cca_cur_sh)" d="M3.2 1.6 L3.2 16.6 L7.4 12.6 L10.2 19.9 L13.1 18.7 L10.3 11.6 L16.4 11.5 Z"'
      + ' fill="#FFFFFF" stroke="#14120D" stroke-width="1.15" stroke-linejoin="round"/></svg>';
    document.body.appendChild(el);

    let shown = false;
    document.addEventListener('mousemove', (event) => {
      const node = document.getElementById(ID);
      if (!node) return;
      node.style.transform = 'translate3d(' + event.clientX + 'px,' + event.clientY + 'px,0)';
      if (!shown) { shown = true; node.style.opacity = '1'; }
    }, true);

    document.addEventListener('mousedown', (event) => {
      const ring = document.createElement('div');
      ring.setAttribute('aria-hidden', 'true');
      ring.style.cssText = [
        'position:fixed', 'left:' + (event.clientX - 21) + 'px', 'top:' + (event.clientY - 21) + 'px',
        'width:42px', 'height:42px', 'border-radius:50%', 'pointer-events:none',
        'z-index:2147483644', 'border:2px solid rgba(20,18,13,0.55)',
        'background:radial-gradient(circle,rgba(255,255,255,0.55),rgba(255,255,255,0))',
      ].join(';');
      document.body.appendChild(ring);
      const anim = ring.animate(
        [
          { transform: 'scale(0.35)', opacity: 0.95 },
          { transform: 'scale(1.25)', opacity: 0 },
        ],
        { duration: 520, easing: 'cubic-bezier(0.2,0.7,0.3,1)' },
      );
      anim.finished.then(() => ring.remove(), () => ring.remove());
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})()`;

/**
 * A title card drawn inside the page, so it inherits the app's fonts and palette.
 * Built as a source string rather than a function: `tsconfig.node.json` has no DOM lib, and this
 * code only ever runs inside the browser.
 */
export function cardSource(kind: 'intro' | 'outro', title: string, tagline: string): string {
  return `(() => {
  const ID = '__cca_demo_card';
  const existing = document.getElementById(ID);
  if (existing) existing.remove();
  const card = document.createElement('div');
  card.id = ID;
  card.setAttribute('aria-hidden', 'true');
  card.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'pointer-events:none',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:14px', 'background:var(--paper,#F4EFE6)', 'color:var(--ink,#17150F)',
    'opacity:0', 'transition:opacity 420ms ease', 'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = ${JSON.stringify(title)};
  title.style.cssText = [
    'font-family:var(--font-display, Georgia, serif)',
    'font-size:${kind === 'intro' ? '58px' : '48px'}',
    'font-weight:600', 'letter-spacing:-0.02em', 'line-height:1.05', 'max-width:24ch',
  ].join(';');

  const rule = document.createElement('div');
  rule.style.cssText = 'width:64px;height:2px;background:var(--cost,#B42318);opacity:0.85';

  const tagline = document.createElement('div');
  tagline.textContent = ${JSON.stringify(tagline)};
  tagline.style.cssText = [
    'font-family:var(--font-ui, system-ui, sans-serif)',
    'font-size:20px', 'letter-spacing:0.02em', 'color:var(--ink-2,#4A453B)',
  ].join(';');

  card.appendChild(title);
  card.appendChild(rule);
  card.appendChild(tagline);
  document.body.appendChild(card);
  requestAnimationFrame(() => { card.style.opacity = '1'; });
})()`;
}

export const CARD_FADE_SOURCE = `(() => {
  const card = document.getElementById('__cca_demo_card');
  if (!card) return;
  card.style.opacity = '0';
  setTimeout(() => { card.remove(); }, 520);
})()`;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

/** The pacing and pointer helpers a scene gets. Every one of them swallows its own failures. */
export class Stage {
  private sceneEnd = 0;

  constructor(
    readonly page: Page,
    readonly base: string,
    private readonly logLine: (message: string) => void,
  ) {}

  log(message: string): void {
    this.logLine(message);
  }

  setSceneEnd(at: number): void {
    this.sceneEnd = at;
  }

  private resolve(target: Locator | string): Locator {
    return typeof target === 'string' ? this.page.locator(target) : target;
  }

  /** Runs `fn`, and on any failure logs it and carries on. Never rethrows. */
  async safe(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logLine(`  skip ${label}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }

  async goto(pathname: string): Promise<void> {
    await this.page.goto(`${this.base}${pathname}`, { waitUntil: 'networkidle', timeout: 20_000 });
    await sleep(250);
  }

  /** Centre of the first match, after scrolling it into view. Null when there is nothing to point at. */
  private async centre(target: Locator | string): Promise<{ x: number; y: number } | null> {
    const locator = this.resolve(target).first();
    if ((await locator.count()) === 0) return null;
    await locator.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
    const box = await locator.boundingBox();
    if (!box || box.width === 0 || box.height === 0) return null;
    const size = this.page.viewportSize();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (!size) return { x, y };
    if (x < 2 || y < 2 || x > size.width - 2 || y > size.height - 2) return null;
    return { x, y };
  }

  /** Glides the pointer to an element and holds there. Logs and returns if it is not on screen. */
  async hover(target: Locator | string, holdMs = 900, label = 'hover'): Promise<void> {
    const point = await this.centre(target);
    if (!point) {
      this.logLine(`  skip ${label}: nothing to hover`);
      return;
    }
    await this.page.mouse.move(point.x, point.y, { steps: 32 });
    await sleep(holdMs);
  }

  async click(target: Locator | string, label = 'click'): Promise<void> {
    const point = await this.centre(target);
    if (!point) {
      this.logLine(`  skip ${label}: nothing to click`);
      return;
    }
    await this.page.mouse.move(point.x, point.y, { steps: 28 });
    await sleep(220);
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
    await sleep(420);
  }

  async typeInto(target: Locator | string, text: string, label = 'type'): Promise<void> {
    const locator = this.resolve(target).first();
    if ((await locator.count()) === 0) {
      this.logLine(`  skip ${label}: no field`);
      return;
    }
    await this.click(locator, label);
    await locator.fill('').catch(() => undefined);
    await this.page.keyboard.type(text, { delay: 55 });
  }

  /** Small wheel increments so the recording shows motion rather than a jump cut. */
  async wheel(totalDy: number, steps = 12, gapMs = 70): Promise<void> {
    const step = totalDy / steps;
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, step);
      await sleep(gapMs);
    }
  }

  async card(kind: 'intro' | 'outro', title: string, tagline: string): Promise<void> {
    await this.page.evaluate(cardSource(kind, title, tagline));
  }

  async fadeCard(): Promise<void> {
    await this.page.evaluate(CARD_FADE_SOURCE);
    await sleep(560);
  }

  /** `document.documentElement.dataset.theme`, read without a DOM lib in this tsconfig. */
  async currentTheme(): Promise<string> {
    const value: unknown = await this.page.evaluate("document.documentElement.dataset.theme || ''");
    return typeof value === 'string' ? value : '';
  }

  async pause(ms: number): Promise<void> {
    await sleep(ms);
  }

  /** Idles out whatever is left of the scene's slot, so the next narration lands on cue. */
  async holdUntilEnd(): Promise<void> {
    await sleep(this.sceneEnd - Date.now());
  }
}
