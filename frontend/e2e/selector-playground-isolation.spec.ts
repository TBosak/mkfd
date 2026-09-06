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

/**
 * Deliberately transport-agnostic: the requirements brief does not specify
 * how the parent hands the per-session nonce to the playground document, and
 * the lead's ruling is explicit that the tests must observe the contract,
 * not the transport. This document reports every plausible carrier back to
 * the test via window.__mkfdCaptureNonceCandidate:
 *   - a same-request query-string parameter whose key contains "nonce"
 *     (extracted server-side, from the intercepted request, and embedded
 *     here) — the "the parent... delivers it when it creates the iframe"
 *     path, since the src URL is the only channel available at creation
 *     time before the child has loaded and could receive a handshake;
 *   - any parent -> child postMessage received after load, whether it is a
 *     bare string or an object carrying a "nonce"-ish key — the handshake
 *     path.
 * Either transport (or both) will surface a candidate here.
 */
function nonceCaptureDocument(nonceFromUrl: string | null): string {
  return `<!DOCTYPE html><html><body>nonce-capture target document
    <script>
      (function () {
        // window.__mkfdCaptureNonceCandidate is injected by Playwright's
        // exposeFunction into this frame's execution context, but that
        // injection is not guaranteed to have completed before this
        // synchronous, load-time script runs (unlike the async callbacks
        // elsewhere in this file, which have a network round-trip's worth of
        // headroom). Retry briefly rather than assuming it is present yet.
        function report(nonce, attempt) {
          attempt = attempt || 0;
          if (typeof window.__mkfdCaptureNonceCandidate === 'function') {
            window.__mkfdCaptureNonceCandidate(nonce);
          } else if (attempt < 50) {
            setTimeout(function () { report(nonce, attempt + 1); }, 20);
          }
        }
        var urlNonce = ${JSON.stringify(nonceFromUrl)};
        if (urlNonce) report(urlNonce);
        window.addEventListener('message', function (event) {
          var data = event.data;
          var candidate = null;
          if (typeof data === 'string') {
            candidate = data;
          } else if (data && typeof data === 'object') {
            if (typeof data.nonce === 'string') {
              candidate = data.nonce;
            } else {
              for (var key in data) {
                if (/nonce/i.test(key) && typeof data[key] === 'string') {
                  candidate = data[key];
                  break;
                }
              }
            }
          }
          if (candidate) report(candidate);
        });
      })();
    </script>
  </body></html>`;
}

/** Extracts the first query-string value whose key contains "nonce", case-insensitively. */
function nonceQueryParam(requestUrl: string): string | null {
  const params = new URL(requestUrl).searchParams;
  for (const [key, value] of params.entries()) {
    if (/nonce/i.test(key)) return value;
  }
  return null;
}

/**
 * Same nonce-discovery logic as nonceCaptureDocument, but once a nonce
 * candidate is found, the document itself posts a genuine selectorUpdated
 * message to window.parent — i.e. the message originates *inside* the
 * iframe, so event.source on the receiving end is the real iframe window.
 * This is required for a positive-path proof of requirement 5: the parent's
 * `event.source === iframe.contentWindow` check can only ever be satisfied
 * by a message the iframe sent, never one posted into it from outside.
 *
 * `selector` is deliberately typed `unknown`: reused both for a genuine
 * string selector (the positive round-trip) and for schema-invalid values
 * (an object, an oversized string) sent alongside a *correctly* discovered
 * nonce, so that a rejection in the latter case can only be attributed to
 * schema validation rather than an incidental nonce mismatch.
 *
 * Does not depend on Playwright's exposeFunction — that binding's injection
 * into a brand-new, uniquely opaque-origin execution context is not
 * guaranteed to finish before this document's own synchronous, load-time
 * script runs, and the message-send itself (the actual thing under test)
 * must not be gated on it.
 */
function autoSendSelectorUpdatedDocument(nonceFromUrl: string | null, selector: unknown): string {
  return `<!DOCTYPE html><html><body>nonce-round-trip target document
    <script>
      (function () {
        var sent = false;
        function send(nonce) {
          if (sent) return;
          sent = true;
          window.parent.postMessage({ type: 'selectorUpdated', selector: ${JSON.stringify(selector)}, nonce: nonce }, '*');
        }
        var urlNonce = ${JSON.stringify(nonceFromUrl)};
        if (urlNonce) send(urlNonce);
        window.addEventListener('message', function (event) {
          var data = event.data;
          var candidate = null;
          if (typeof data === 'string') {
            candidate = data;
          } else if (data && typeof data === 'object') {
            if (typeof data.nonce === 'string') {
              candidate = data.nonce;
            } else {
              for (var key in data) {
                if (/nonce/i.test(key) && typeof data[key] === 'string') {
                  candidate = data[key];
                  break;
                }
              }
            }
          }
          if (candidate) send(candidate);
        });
      })();
    </script>
  </body></html>`;
}

/**
 * Sends a fixed, pre-chosen selectorUpdated payload to window.parent as soon
 * as the document loads, ignoring whatever this session's own transport
 * would otherwise have supplied. The message still genuinely originates
 * from this (real, currently-open) iframe's own window — satisfying the
 * source check — while carrying an arbitrary caller-chosen payload. Used
 * both to replay a stale nonce from a closed session, and to send a
 * well-formed selector with a missing/wrong nonce so that layer can be
 * tested in isolation from schema validation.
 */
function autoPostMessageDocument(message: unknown): string {
  return `<!DOCTYPE html><html><body>fixed-payload target document
    <script>
      window.parent.postMessage(${JSON.stringify(message)}, '*');
    </script>
  </body></html>`;
}

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
    // The opaque-origin fetch may either be refused outright (no body ever
    // produced, so apiBodyLooksLikeFeedJson stays undefined and apiError is
    // set) or complete but land on a non-authenticated response (e.g. the
    // passkey HTML page, so apiBodyLooksLikeFeedJson is false). Both are
    // valid isolation outcomes — only actually obtaining authenticated feed
    // JSON is a leak.
    expect(result.apiBodyLooksLikeFeedJson).not.toBe(true);
    const requestWasIsolatedFromApi = Boolean(result.apiError) || result.apiBodyLooksLikeFeedJson === false;
    expect(requestWasIsolatedFromApi).toBe(true);
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

  // Both sub-cases below must originate genuinely from inside the current
  // iframe (event.source === iframe.contentWindow), exactly like the
  // rogue-window test above needs a message that genuinely does NOT — a
  // message posted *into* the iframe from the parent/test context never
  // reaches the parent's own message listener at all, which would make
  // either sub-case pass vacuously regardless of nonce handling.
  test('a selectorUpdated message from the real iframe with a missing or wrong nonce is ignored', async ({ authenticatedPage }) => {
    await routeProxyWith(
      authenticatedPage,
      autoPostMessageDocument({ type: 'selectorUpdated', selector: '.no-nonce' }),
    );
    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Missing Nonce Test Feed');
    await openPlayground(authenticatedPage);
    await authenticatedPage.waitForTimeout(500);
    expect(await itemSelectorValue(authenticatedPage)).not.toBe('.no-nonce');

    await authenticatedPage.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(authenticatedPage.locator('iframe[title="Selector Playground"]')).toHaveCount(0);

    await authenticatedPage.route('**/proxy**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: autoPostMessageDocument({
          type: 'selectorUpdated',
          selector: '.wrong-nonce',
          nonce: 'stale-or-guessed-nonce',
        }),
      });
    });
    await openPlayground(authenticatedPage);
    await authenticatedPage.waitForTimeout(500);
    expect(await itemSelectorValue(authenticatedPage)).not.toBe('.wrong-nonce');
  });

  // Sent alongside a nonce this specific session's own transport actually
  // supplied (discovered the same transport-agnostic way as the positive
  // round-trip below), so a rejection here can only be attributed to schema
  // validation of the selector itself, not an incidental nonce mismatch —
  // the round-trip test below independently proves this exact delivery
  // mechanism succeeds when the selector is a well-formed string.
  test('a malformed selectorUpdated payload (non-string or oversized selector) is discarded even with a correctly nonced message', async ({ authenticatedPage }) => {
    await authenticatedPage.route('**/proxy**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: autoSendSelectorUpdatedDocument(nonceQueryParam(route.request().url()), { evil: true }),
      });
    });
    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Malformed Payload Test Feed');
    await openPlayground(authenticatedPage);
    await authenticatedPage.waitForTimeout(500);
    expect(await itemSelectorValue(authenticatedPage)).toBe('');

    await authenticatedPage.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(authenticatedPage.locator('iframe[title="Selector Playground"]')).toHaveCount(0);

    const oversized = '.a'.repeat(50000);
    await authenticatedPage.route('**/proxy**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: autoSendSelectorUpdatedDocument(nonceQueryParam(route.request().url()), oversized),
      });
    });
    await openPlayground(authenticatedPage);
    await authenticatedPage.waitForTimeout(500);
    expect(await itemSelectorValue(authenticatedPage)).not.toBe(oversized);
  });

  test('a legitimately nonced message originating from the real iframe is accepted and can be applied to a destination (positive round-trip)', async ({ authenticatedPage }) => {
    await authenticatedPage.route('**/proxy**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: autoSendSelectorUpdatedDocument(nonceQueryParam(route.request().url()), '.legit-choice'),
      });
    });

    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Nonce Round Trip Test Feed');
    await openPlayground(authenticatedPage);

    // The document sends its selectorUpdated message autonomously as soon as
    // it discovers its own nonce (via the URL or a handshake), so this polls
    // by repeatedly clicking "Item" and reading the field back — the click
    // itself is idempotent (it just re-applies whatever the parent's
    // currently-known selector is) and any extra "No selector chosen yet!"
    // dialogs along the way are auto-dismissed by the beforeEach above.
    await expect.poll(
      () => itemSelectorValue(authenticatedPage),
      {
        timeout: 10000,
        message:
          'the iframe never observed a nonce (no query-string parameter, no handshake ' +
          'postMessage) or the parent never accepted its own iframe-originated, ' +
          'correctly-nonced message — the positive nonce path could not be exercised',
      },
    ).toBe('.legit-choice');
  });

  test('a nonce captured from a previous playground session is rejected after the playground is closed and reopened (stale nonce)', async ({ authenticatedPage }) => {
    const capturedNonces: string[] = [];
    await authenticatedPage.exposeFunction('__mkfdCaptureNonceCandidate', (candidate: string) => {
      capturedNonces.push(candidate);
    });
    await authenticatedPage.route('**/proxy**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: nonceCaptureDocument(nonceQueryParam(route.request().url())),
      });
    });

    await fillBasicAndReachSelectorsStep(authenticatedPage, 'Stale Nonce Test Feed');
    await openPlayground(authenticatedPage);
    await expect.poll(
      () => capturedNonces.length,
      {
        timeout: 10000,
        message: 'the first playground session never observed a nonce to later replay as stale',
      },
    ).toBeGreaterThan(0);
    const staleNonce = capturedNonces[0];

    await authenticatedPage.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(authenticatedPage.locator('iframe[title="Selector Playground"]')).toHaveCount(0);

    // The second session's document ignores whatever nonce its own
    // transport would supply and instead sends the first session's
    // (stale) nonce, from its own window — genuinely satisfying the
    // source check while carrying a nonce that belongs to a closed session.
    await authenticatedPage.route('**/proxy**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: autoPostMessageDocument({
          type: 'selectorUpdated',
          selector: '.stale-nonce-selector',
          nonce: staleNonce,
        }),
      });
    });

    await openPlayground(authenticatedPage);

    // Rejection is a stable end-state (nothing will eventually flip it to
    // accepted), so this waits for the auto-sent message to have had time
    // to arrive and be processed, then asserts once. Same idempotent-click
    // pattern as the positive test, without expecting the value to change.
    await authenticatedPage.waitForTimeout(500);
    expect(await itemSelectorValue(authenticatedPage)).not.toBe('.stale-nonce-selector');
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
