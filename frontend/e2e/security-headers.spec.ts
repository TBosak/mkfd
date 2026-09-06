// TDD slice: p2-csp-security-headers
//
// Browser-observable coverage for the effects the requirements brief calls
// out as only provable in a real browser: an injected inline (and a remote,
// cross-origin) script not executing under the SPA's script-src (requirement
// 2), the app refusing to be framed by a foreign origin (requirement 3), and
// the login page issuing no request to any third-party host (requirement
// 4). Header-string presence and the exact CSP directive values are already
// covered deterministically at the integration level in
// tests/security-headers-baseline.test.ts,
// tests/security-headers-hsts.test.ts, and
// tests/security-headers-playground-csp-unchanged.test.ts — this file
// exists specifically for the parts a header-string assertion cannot prove.
//
// Uses the existing authenticated fixture (./fixtures, locked) where a
// session is needed for the SPA-script tests, and the plain, unauthenticated
// Playwright `page` fixture for the login-page and framing tests, per the
// brief's explicit instruction that the login page itself must be tested
// unauthenticated.
import { test as authedTest, expect as authedExpect } from './fixtures';
import { test as anonTest, expect as anonExpect } from '@playwright/test';

interface MkfdInlineScriptWindow extends Window {
  __mkfdInlineExecuted?: boolean;
}

interface MkfdRemoteScriptWindow extends Window {
  __mkfdRemoteExecuted?: boolean;
}

// ---------------------------------------------------------------------------
// Requirement 2 — the SPA's CSP forbids inline and remote script (behavioral)
// ---------------------------------------------------------------------------

authedTest.describe('SPA script-src forbids inline and remote script (requirement 2)', () => {
  authedTest('an inline <script> injected into the running app does not execute', async ({ authenticatedPage }) => {
    // Uses page.evaluate (a CDP-driven function call, not a page-level DOM
    // API) purely as the harness to inject the element and await its
    // outcome — the thing actually under test is whether *the browser's own
    // CSP enforcement* lets this dynamically-created inline script run, not
    // how it got onto the page. A CSP-compliant document blocks inline
    // scripts regardless of insertion method.
    const executed = await authenticatedPage.evaluate(() => {
      return new Promise<void>((resolve) => {
        const script = document.createElement('script');
        script.textContent = 'window.__mkfdInlineExecuted = true;';
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () => resolve());
        document.head.appendChild(script);
        // Belt-and-suspenders: a blocked inline script's error event should
        // fire promptly, but this guarantees the promise still settles even
        // if a particular engine's event timing differs.
        setTimeout(resolve, 500);
      }).then(() => (window as unknown as MkfdInlineScriptWindow).__mkfdInlineExecuted === true);
    });

    authedExpect(executed).toBe(false);
  });

  authedTest(
    'a <script src> pointing at a foreign origin is neither requested nor executed',
    async ({ authenticatedPage }) => {
      let foreignHostRequested = false;
      await authenticatedPage.route('http://mkfd-e2e-hostile-script.example/**', (route) => {
        foreignHostRequested = true;
        route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'window.__mkfdRemoteExecuted = true;',
        });
      });

      const executed = await authenticatedPage.evaluate(() => {
        return new Promise<void>((resolve) => {
          const script = document.createElement('script');
          script.src = 'http://mkfd-e2e-hostile-script.example/payload.js';
          script.addEventListener('load', () => resolve());
          script.addEventListener('error', () => resolve());
          document.head.appendChild(script);
          setTimeout(resolve, 800);
        }).then(() => (window as unknown as MkfdRemoteScriptWindow).__mkfdRemoteExecuted === true);
      });

      authedExpect(executed).toBe(false);
      // script-src 'self' must refuse the request outright — CSP is
      // enforced before the network fetch is issued — not merely refuse to
      // run a script that did arrive.
      authedExpect(foreignHostRequested).toBe(false);
    },
  );

  authedTest('sanity control: the app\'s own self-hosted module script did execute (the page actually rendered)', async ({
    authenticatedPage,
  }) => {
    // If this failed, the two negative tests above would be meaningless —
    // they would only be proving that no script whatsoever can run on this
    // page, not that script-src 'self' specifically discriminates between
    // the app's own module and injected inline/remote scripts.
    await authedExpect(authenticatedPage.locator('#root')).toBeVisible();
    await authedExpect(authenticatedPage.getByRole('button', { name: 'Web Scraping', exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Requirement 3 — the app refuses to be framed by a foreign origin
// ---------------------------------------------------------------------------

anonTest.describe('Framing is refused from a foreign origin (requirement 3)', () => {
  anonTest('a hostile page embedding the login page in an iframe never sees it render', async ({ page, baseURL }) => {
    anonExpect(baseURL).toBeTruthy();
    const appOrigin = new URL(baseURL ?? '').origin;
    const framedUrl = `${appOrigin}/passkey`;

    // A hostile page served from an entirely different origin. Routed
    // rather than fetched from a real third-party host, so this never makes
    // a live network request to anything outside this test's own control —
    // the same technique frontend/e2e/selector-playground-isolation.spec.ts
    // already uses for its own page.route() interceptions.
    await page.route('http://mkfd-e2e-hostile-frame.example/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html><html><body><iframe id="hostile" src="${framedUrl}"></iframe></body></html>`,
      }),
    );
    await page.goto('http://mkfd-e2e-hostile-frame.example/');

    const iframeHandle = await page.waitForSelector('#hostile');
    const frame = await iframeHandle.contentFrame();
    // Give a genuinely-permitted navigation ample time to load, so a false
    // "blocked" result can't be attributed to the assertion running early.
    await page.waitForTimeout(1500);
    const frameTitle = frame ? await frame.title().catch(() => '') : '';
    const frameUrl = frame ? frame.url() : '';

    // A successfully-loaded /passkey document's title is exactly "Enter
    // Passkey" (frontend/e2e/fixtures.ts depends on this exact title
    // elsewhere, so it is a reliable positive signal). A refusal is a
    // browser-generated event, not a console API call, so it never reaches
    // page.on('console') — the frame's own URL is the only signal a
    // real refusal reliably produces: a browser that blocks framing
    // replaces the document with its own internal error page (e.g.
    // Chromium's "chrome-error://chromewebdata/") rather than committing
    // the navigation to `framedUrl`, whereas a permitted load's frame.url()
    // is exactly `framedUrl`. Asserting both the title and the URL, rather
    // than the title alone, is what rules out "the frame never loaded for
    // some unrelated reason" (e.g. a route/network hiccup would also leave
    // the title empty) — the positive control below independently proves
    // /passkey itself loads and titles correctly when not framed, so this
    // pair of assertions can only be explained by framing having been
    // refused, not by /passkey being broken.
    anonExpect(frameTitle).not.toBe('Enter Passkey');
    anonExpect(frameUrl).not.toBe(framedUrl);
  });

  anonTest('positive control: the same page loads normally when navigated to directly (not framed)', async ({ page, baseURL }) => {
    // Proves the previous test's failure mode is specifically about
    // framing, not that /passkey is broken or unreachable outright.
    const appOrigin = new URL(baseURL ?? '').origin;
    await page.goto(`${appOrigin}/passkey`);
    await anonExpect(page).toHaveTitle('Enter Passkey');
  });
});

// ---------------------------------------------------------------------------
// Requirement 4 — the login page has no third-party dependency
// ---------------------------------------------------------------------------

anonTest.describe('Login page has no third-party dependency (requirement 4)', () => {
  anonTest('issues no request to any host other than the app\'s own while loading', async ({ page, baseURL }) => {
    anonExpect(baseURL).toBeTruthy();
    const appOrigin = new URL(baseURL ?? '').origin;
    const appHost = new URL(appOrigin).host;

    const foreignRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('about:')) return;
      const host = new URL(url).host;
      if (host !== appHost) foreignRequests.push(url);
    });

    await page.goto(`${appOrigin}/passkey`);
    await anonExpect(page).toHaveTitle('Enter Passkey');
    // Give any stray async resource load (e.g. a CDN stylesheet's own
    // sub-fetches) a moment to surface before asserting.
    await page.waitForTimeout(500);

    anonExpect(foreignRequests).toEqual([]);
  });

  anonTest('remains legible and usable without the third-party stylesheet', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL ?? '').origin;
    await page.goto(`${appOrigin}/passkey`);
    await anonExpect(page.getByRole('heading', { name: 'Enter Passkey' })).toBeVisible();
    await anonExpect(page.locator('input[name="passkey"]')).toBeVisible();
    await anonExpect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  });

  anonTest('the locked login contract (title "Enter Passkey", input[name="passkey"]) still completes a real login', async ({
    page,
    baseURL,
  }) => {
    // Independent, from-scratch proof that frontend/e2e/fixtures.ts's own
    // login flow still works end to end after this slice's changes — every
    // other spec file's authenticatedPage fixture also exercises this path,
    // but this test exists specifically so a login regression is visible
    // here, scoped to this slice, rather than surfacing as unrelated
    // failures across the rest of the suite.
    const passkey = process.env.MKFD_E2E_PASSKEY;
    anonExpect(passkey).toBeTruthy();
    const appOrigin = new URL(baseURL ?? '').origin;

    await page.goto(`${appOrigin}/`);
    await page.waitForFunction(() => document.title !== '');
    await anonExpect(page).toHaveTitle('Enter Passkey');

    await page.fill('input[name="passkey"]', passkey ?? '');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/public/');
    await anonExpect(page.locator('#root')).toBeVisible();
  });
});
