// `/?mock=1` offline stand-in: the app itself skips the NEAR RPC (no page.route RPC mock here) and every
// non-127.0.0.1 request is aborted. Adds a 6th e2e test next to the 5 scenes in demo.spec.ts.
import { expect, test } from "@playwright/test";

test("mock mode: offline anchor goes before → match over the 5 scenes, banner always visible", async ({ page }) => {
  const external: string[] = [];
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      external.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  await page.goto("/?mock=1");
  await expect(page.getByTestId("request-feed")).toBeVisible();

  const banner = page.getByTestId("anchor-mock-banner");
  const status = page.getByTestId("anchor-status");
  const label = page.getByTestId("anchor-label");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText("목 RPC · 오프라인 대체");
  await expect(status).toHaveAttribute("data-kind", "before");
  await expect(label).toHaveText(/11건 중 \d+건 · 앵커 전/);

  await page.getByTestId("approve-req-medical-full").click();
  await page.getByTestId("ai-card-req-medical-full").locator(".badge").getByText("recorded").waitFor();
  await page.getByTestId("advance-clock").click();
  await page.getByTestId("demo-clock").getByText("2026-11-20 20:10 KST").waitFor();
  await page.getByTestId("revoke-grant-card-budget").click();

  await expect(page.getByTestId("chain-status")).toHaveText("해시 체인 검증 ✓");
  await expect(status).toHaveAttribute("data-kind", "match");
  await expect(label).toContainText("일치 ✓");
  await expect(status).toContainText("블록 #278,539,285");
  await expect(banner).toBeVisible();
  expect(external).toEqual([]);
});
