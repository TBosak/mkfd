import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Specifies the representative authenticated accessibility contract from the
// `p1-dependency-ci-security-baseline` requirements brief, requirement 6:
// axe-core coverage for the application shell plus My Feeds, Builder,
// Health, and Settings, failing on serious/critical violations with a
// useful route/violation failure message. Deliberately does not call
// `.disableRules(...)`/`.withTags(...)` to narrow the rule set - a broad
// exclusion would manufacture green without fixing real violations, which
// the brief explicitly forbids.
//
// Every route is reached via real in-app client-side navigation from the
// authenticated start page, never via `page.goto()` to a client route: the
// app has no SPA deep-link fallback (`index.ts` only maps `GET /` to
// `index.html` and serves `/public/*` as static files, so a direct
// navigation to e.g. `/public/feeds` 404s). Only the base URL the
// `authenticatedPage` fixture already lands on is ever fetched directly.
// ---------------------------------------------------------------------------

// Below the `lg:` Tailwind breakpoint (1024px), Sidebar.tsx (which has the
// Health/Settings links, and labels the feeds link exact "Feeds") is
// CSS-hidden, and BottomNav.tsx - which exposes only My Feeds, a Build Feed
// button, and Catalog, and labels the feeds link "My Feeds" - renders
// instead.
async function isMobileViewport(page: Page): Promise<boolean> {
  const size = page.viewportSize();
  return !!size && size.width < 1024;
}

interface RouteUnderTest {
  name: string;
  /** Navigates from the authenticated start page ("/") via a real in-app click. Only called when the route is reachable on the current project (see `mobileUnreachableReason`). */
  navigate: (page: Page) => Promise<void>;
  /**
   * When set, this route has no navigation path in the current UI at the
   * mobile (390px) viewport - a genuine, recorded product gap (Health and
   * Settings are Sidebar-only, and Sidebar is `lg:`-hidden), not something
   * this slice invents a workaround for. The mobile-project test is
   * dynamically skipped with this reason; the desktop-project test still
   * runs and still covers the route.
   */
  mobileUnreachableReason?: string;
  waitForReady: (page: Page) => Promise<void>;
}

const ROUTES: RouteUnderTest[] = [
  {
    name: 'Builder (application shell + /)',
    // The authenticatedPage fixture already lands on "/" - no navigation needed.
    navigate: async () => {},
    waitForReady: async (page) => {
      await expect(page.getByRole('button', { name: 'Web Scraping', exact: true })).toBeVisible({ timeout: 15000 });
    },
  },
  {
    name: 'My Feeds',
    navigate: async (page) => {
      const link = (await isMobileViewport(page))
        ? page.getByRole('link', { name: 'My Feeds', exact: true })
        : page.getByRole('link', { name: 'Feeds', exact: true });
      await link.click();
    },
    waitForReady: async (page) => {
      await expect(page.getByRole('heading', { name: 'Feeds', exact: true })).toBeVisible();
    },
  },
  {
    name: 'Health',
    navigate: async (page) => {
      await page.getByRole('link', { name: 'Health', exact: true }).click();
    },
    mobileUnreachableReason:
      'Health has no mobile navigation entry point at 390px - BottomNav.tsx exposes only My Feeds, Build Feed, and Catalog, and the only Health link (Sidebar.tsx) is lg:-hidden. Recorded product gap for Packet 4 / the UI Redesign Correction Pass, not this slice\'s to fix.',
    waitForReady: async (page) => {
      await expect(page.getByRole('heading', { name: 'Health Dashboard' })).toBeVisible();
    },
  },
  {
    name: 'Settings',
    navigate: async (page) => {
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
    },
    mobileUnreachableReason:
      'Settings has no mobile navigation entry point at 390px - BottomNav.tsx exposes only My Feeds, Build Feed, and Catalog, and the only Settings link (Sidebar.tsx) is lg:-hidden. Recorded product gap for Packet 4 / the UI Redesign Correction Pass, not this slice\'s to fix.',
    waitForReady: async (page) => {
      await expect(page.getByText('Security', { exact: true })).toBeVisible();
    },
  },
];

// Bounded so a large violation set stays readable, while still naming the
// concrete elements the lead needs to act on the failure without re-running
// with ad-hoc instrumentation.
const MAX_NODES_PER_VIOLATION = 5;
const MAX_FAILURE_SUMMARY_LENGTH = 200;

interface AxeNodeLike {
  target?: unknown;
  failureSummary?: string | null;
  html?: string;
}

interface AxeViolationLike {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNodeLike[];
}

function formatNodeTarget(target: unknown): string {
  if (Array.isArray(target)) return target.join(' ');
  return String(target ?? '(unknown target)');
}

function formatFailureSummary(summary: string | null | undefined): string {
  if (!summary) return '';
  const firstLine = summary.split('\n')[0].trim();
  return firstLine.length > MAX_FAILURE_SUMMARY_LENGTH ? `${firstLine.slice(0, MAX_FAILURE_SUMMARY_LENGTH)}...` : firstLine;
}

function formatViolation(v: AxeViolationLike): string {
  const shown = v.nodes.slice(0, MAX_NODES_PER_VIOLATION);
  const nodeLines = shown.map((node) => {
    const target = formatNodeTarget(node.target);
    const summary = formatFailureSummary(node.failureSummary);
    return summary ? `    - ${target}: ${summary}` : `    - ${target}`;
  });
  const remaining = v.nodes.length - shown.length;
  if (remaining > 0) nodeLines.push(`    ... and ${remaining} more node(s)`);
  return [`- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -> ${v.helpUrl}`, ...nodeLines].join('\n');
}

test.describe('Accessibility (axe-core, serious+critical gate)', () => {
  for (const route of ROUTES) {
    test(`${route.name} has no serious/critical accessibility violations`, async ({ authenticatedPage }) => {
      const mobile = await isMobileViewport(authenticatedPage);
      test.skip(mobile && !!route.mobileUnreachableReason, route.mobileUnreachableReason);

      await route.navigate(authenticatedPage);
      await route.waitForReady(authenticatedPage);

      const results = await new AxeBuilder({ page: authenticatedPage }).analyze();
      const violations = results.violations as AxeViolationLike[];
      const seriousOrCritical = violations.filter((v: AxeViolationLike) => v.impact === 'serious' || v.impact === 'critical');

      if (seriousOrCritical.length > 0) {
        const details = seriousOrCritical.map(formatViolation).join('\n');
        throw new Error(
          `Route '${route.name}' on project '${test.info().project.name}' has ` +
            `${seriousOrCritical.length} serious/critical accessibility violation(s):\n${details}`,
        );
      }

      expect(seriousOrCritical).toEqual([]);
    });
  }
});
