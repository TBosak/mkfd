// TDD slice: p2-selector-playground-isolation
//
// Browser-side contract for the Selector Playground's origin isolation
// (requirement 1) and postMessage authentication (requirement 5). Both are
// only observable in a real browser: opaque-origin storage/DOM/API access
// consequences are enforced by the browser's own sandboxing implementation,
// and postMessage source/nonce checks require real, distinct window objects.
//
// GET /proxy is intercepted with page.route() so these tests never make a
// live network request (to a third party or otherwise) and never depend on
// the outbound fetch policy, sanitization, or the real SelectorGadget asset —
// those are covered deterministically at the integration level in
// tests/selector-playground-proxy-isolation.test.ts. Intercepting here is
// legitimate specifically because requirement 1's sandbox behavior is a
// property of the <iframe sandbox="..."> attribute itself, independent of
// whatever document ends up inside it — exercising it via a controlled
// response isolates that layer from the sanitization layer, which is the
// point of both existing as independent defenses.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function fillBasicAndReachSelectorsStep(page: Page, feedName: string) {
  await page.getByRole('button', { name: 'Web Scraping', exact: true }).click();
  await expect(page.getByText('Step 01')).toBeVisible();
  await page.getByLabel(/Feed Name/i).fill(feedName);
  await page.getByLabel(/Target URL/i).fill('https://example.com/hostile-target');
  await page.getByText('Step 03').click();
  await expect(page.getByRole('button', { name: /Step 03 Selectors/i })).toBeVisible();
}

async function openPlayground(page: Page) {
  const trigger = page.getByRole('button', { name: 'Selector Playground' });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const iframe = page.locator('iframe[title="Selector Playground"]');
  await expect(iframe).toBeVisible();
  return iframe;
}

async function routeProxyWith(page: Page, body: string) {
  await page.route('**/proxy**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body }),
  );
}

const MINIMAL_TARGET_DOC = '<!DOCTYPE html><html><body>minimal target document</body></html>';

test.describe('Selector Playground iframe origin isolation (requirement 1)', () => {
  test('the iframe sandbox grants allow-scripts but withholds allow-same-origin', async ({ authenticatedPage }) => {
    await routeProxyWith(authenticatedPage, MINIMAL_TARGET_DOC);
    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Sandbox Attribute Test Feed');
    const iframe = await openPlayground(authenticatedPage);

    const sandbox = await iframe.getAttribute('sandbox');
    expect(sandbox).toBeTruthy();
    const tokens = (sandbox ?? '').split(/\s+/).filter(Boolean);
    expect(tokens).toContain('allow-scripts');
    expect(tokens).not.toContain('allow-same-origin');
  });

  test('a hostile target page cannot read app localStorage, cannot access the parent DOM, and cannot reach an authenticated app API with the operator session cookie', async ({ authenticatedPage }) => {
    await authenticatedPage.evaluate(() => {
      localStorage.setItem('mkfd-isolation-canary', 'secret-value');
    });

    // Positive control: the same request, made directly from the real app
    // origin (this page), must succeed and return real feed data — proving
    // that any failure observed from inside the iframe below is caused by
    // the iframe's isolation, not by /api/feeds being broken or requiring
    // something this authenticated session doesn't have.
    const controlBody = await authenticatedPage.evaluate(async () => {
      const res = await fetch('/api/feeds', { credentials: 'include' });
      const text = await res.text();
      return { status: res.status, looksLikeJson: text.trim().startsWith('[') || text.trim().startsWith('{') };
    });
    expect(controlBody.looksLikeJson).toBe(true);

    const results: Array<Record<string, unknown>> = [];
    await authenticatedPage.exposeFunction('__mkfdReportIsolation', (result: Record<string, unknown>) => {
      results.push(result);
    });

    await routeProxyWith(
      authenticatedPage,
      `<!DOCTYPE html><html><body><script>
        (function () {
          var result = {};
          try {
            result.localStorage = window.localStorage.getItem('mkfd-isolation-canary');
          } catch (e) {
            result.localStorageError = e.name;
          }
          try {
            result.parentTitle = window.parent.document.title;
          } catch (e) {
            result.parentDomError = e.name;
          }
          fetch('/api/feeds', { credentials: 'include' })
            .then(function (r) {
              return r.text().then(function (text) {
                result.apiStatus = r.status;
                var trimmed = text.trim();
                result.apiBodyLooksLikeFeedJson = trimmed.startsWith('[') || trimmed.startsWith('{');
                window.__mkfdReportIsolation(result);
              });
            })
            .catch(function (e) {
              result.apiError = String(e);
              window.__mkfdReportIsolation(result);
            });
        })();
      </script></body></html>`,
    );

    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Isolation Consequence Test Feed');
    await openPlayground(authenticatedPage);

    await expect.poll(() => results.length, { timeout: 10000 }).toBeGreaterThan(0);
    const result = results[0];

    expect(result.localStorage).not.toBe('secret-value');
    expect(result.parentDomError).toBeTruthy();
    expect(result.apiBodyLooksLikeFeedJson).toBe(false);
  });
});

test.describe('Selector Playground postMessage authentication (requirement 5)', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Both the accept and reject paths in the current, unfixed component
    // funnel through window.alert(); dismiss unconditionally so a click
    // never hangs the test regardless of which path fires.
    authenticatedPage.on('dialog', (dialog) => {
      dialog.dismiss().catch(() => {});
    });
  });

  async function openMinimalPlayground(page: Page, feedName: string) {
    await routeProxyWith(page, MINIMAL_TARGET_DOC);
    await fillBasicAndReachSelectorsStep(page, feedName);
    await openPlayground(page);
  }

  async function itemSelectorValue(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Item', exact: true }).click();
    return page.locator('#itemSelector').inputValue();
  }

  test('a selectorUpdated message from a window other than the created iframe is ignored', async ({ authenticatedPage }) => {
    await openMinimalPlayground(authenticatedPage, 'Rogue Window Test Feed');

    const before = await itemSelectorValue(authenticatedPage);
    expect(before).not.toBe('.from-rogue-window');

    await authenticatedPage.evaluate(() => {
      const popup = window.open('about:blank');
      popup?.opener?.postMessage({ type: 'selectorUpdated', selector: '.from-rogue-window' }, '*');
      popup?.close();
    });

    const after = await itemSelectorValue(authenticatedPage);
    expect(after).not.toBe('.from-rogue-window');
  });

  test('a selectorUpdated message from the real iframe with a missing or wrong nonce is ignored', async ({ authenticatedPage }) => {
    await openMinimalPlayground(authenticatedPage, 'Missing Nonce Test Feed');

    await authenticatedPage.evaluate(() => {
      const el = document.querySelector('iframe[title="Selector Playground"]') as HTMLIFrameElement | null;
      el?.contentWindow?.postMessage({ type: 'selectorUpdated', selector: '.no-nonce' }, '*');
    });
    expect(await itemSelectorValue(authenticatedPage)).not.toBe('.no-nonce');

    await authenticatedPage.evaluate(() => {
      const el = document.querySelector('iframe[title="Selector Playground"]') as HTMLIFrameElement | null;
      el?.contentWindow?.postMessage(
        { type: 'selectorUpdated', selector: '.wrong-nonce', nonce: 'stale-or-guessed-nonce' },
        '*',
      );
    });
    expect(await itemSelectorValue(authenticatedPage)).not.toBe('.wrong-nonce');
  });

  test('a malformed selectorUpdated payload (non-string or oversized selector) is discarded', async ({ authenticatedPage }) => {
    await openMinimalPlayground(authenticatedPage, 'Malformed Payload Test Feed');

    await authenticatedPage.evaluate(() => {
      const el = document.querySelector('iframe[title="Selector Playground"]') as HTMLIFrameElement | null;
      el?.contentWindow?.postMessage({ type: 'selectorUpdated', selector: { evil: true } }, '*');
    });
    const afterObjectPayload = await itemSelectorValue(authenticatedPage);
    expect(afterObjectPayload).toBe('');

    const oversized = '.a'.repeat(50000);
    await authenticatedPage.evaluate((sel) => {
      const el = document.querySelector('iframe[title="Selector Playground"]') as HTMLIFrameElement | null;
      el?.contentWindow?.postMessage({ type: 'selectorUpdated', selector: sel }, '*');
    }, oversized);
    const afterOversizedPayload = await itemSelectorValue(authenticatedPage);
    expect(afterOversizedPayload).not.toBe(oversized);
  });
});

test.describe('Selector Playground compatibility (requirement 7)', () => {
  test('all 16 selector destinations remain present as visible actions in the playground', async ({ authenticatedPage }) => {
    await routeProxyWith(authenticatedPage, MINIMAL_TARGET_DOC);
    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Sixteen Destinations Test Feed');
    await openPlayground(authenticatedPage);

    const labels = [
      'Item', 'Title', 'Description', 'Link', 'Enclosure', 'Author', 'Date',
      'Content Encoded', 'Summary', 'GUID', 'Item Categories', 'Contributors',
      'Latitude', 'Longitude', 'Source URL', 'Source Title',
    ];
    for (const label of labels) {
      await expect(authenticatedPage.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });
});
