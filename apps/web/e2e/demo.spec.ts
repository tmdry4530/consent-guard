// The 5 demo scenes, in order, on one page (each scene builds on the previous one's state).
import { expect, test, type Page } from "@playwright/test";
import { mockAnchorRpc, waitForAnchorStatus } from "./anchorMock.ts";

test.describe.configure({ mode: "serial" });

let page: Page;

const badge = (id: string) => page.getByTestId(`feed-${id}`).locator(".badge");
const aiCards = () => page.locator('[data-testid^="ai-card-"]');

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await mockAnchorRpc(page, "match"); // offline: no NEAR RPC traffic
  await page.goto("/");
  await expect(page.getByTestId("request-feed")).toBeVisible();
});

test.afterAll(async () => {
  await page.close();
});

test("scene 1: initial feed — card allowed with merchant masked, recorded AI", async () => {
  await expect(page.getByTestId("demo-clock")).toHaveText("2026-11-20 20:00 KST");

  await expect(badge("req-card-budget")).toHaveText("허용");
  await expect(badge("req-allergy-diet")).toHaveText("허용");
  await expect(badge("req-medical-full")).toHaveText("대기");
  await expect(badge("req-account-raw")).toHaveText("거부");

  await expect(page.getByTestId("feed-req-card-budget")).toContainText("grant-card-budget 권한으로 허용");
  await expect(page.getByTestId("feed-req-card-budget")).toContainText("(가림: merchant)");
  await expect(page.getByTestId("feed-req-allergy-diet")).toContainText("grant-allergy-diet 권한으로 허용");
  await expect(page.getByTestId("feed-req-medical-full")).toContainText("민감 데이터셋(medical_record)은 소유자 승인이 필요함");

  const released = page.getByTestId("released-data");
  await expect(released.locator("th")).toContainText(["category", "amount", "merchant"]);
  await expect(released.locator("td.masked").first()).toHaveText("***");
  await expect(released).toContainText("식비");
  await expect(released).toContainText("12,000");
  await expect(released).not.toContainText("강남김밥");

  for (const id of ["req-card-budget", "req-allergy-diet"]) {
    await expect(page.getByTestId(`ai-card-${id}`).locator(".badge")).toHaveText("recorded");
  }
  await expect(page.getByTestId("ai-card-req-card-budget")).toContainText("budget-agent");
  await expect(page.getByTestId("ai-card-req-allergy-diet")).toContainText("diet-agent");
  await expect(page.getByTestId("ai-card-req-account-raw")).toHaveCount(0);
  await expect(page.getByTestId("ai-card-req-medical-full")).toHaveCount(0);
  await expect(aiCards()).toHaveCount(2);

  await waitForAnchorStatus(page, "match");
});

test("scene 2: raw account_number request denied, adapter not called", async () => {
  const feed = page.getByTestId("feed-req-account-raw");
  await expect(badge("req-account-raw")).toHaveText("거부");
  await expect(feed).toContainText("원문 금지 필드 요청: account_number");
  await expect(page.getByTestId("ai-card-req-account-raw")).toHaveCount(0);
  await expect(page.getByTestId("released-data")).not.toContainText("tax-agent");
});

test("scene 3: approve pending medical request", async () => {
  await page.getByTestId("approve-req-medical-full").click();

  await expect(badge("req-medical-full")).toHaveText("허용");
  await expect(page.getByTestId("feed-req-medical-full")).toContainText("사용자 승인");
  await expect(page.getByTestId("ai-card-req-medical-full").locator(".badge")).toHaveText("recorded");
  await expect(aiCards()).toHaveCount(3);
  await expect(page.getByTestId("ai-card-req-account-raw")).toHaveCount(0);

  const queue = page.getByTestId("approval-queue");
  await expect(queue).toContainText("대기 중인 요청 없음");
  await expect(queue.locator(".count")).toHaveText("0");
  await expect(page.getByTestId("approve-req-medical-full")).toHaveCount(0);
});

test("scene 4: +10분 expires the diet grant", async () => {
  await page.getByTestId("advance-clock").click();

  await expect(page.getByTestId("demo-clock")).toHaveText("2026-11-20 20:10 KST");
  const dietGrant = page.getByTestId("grant-list").locator("li", { hasText: "diet-agent" });
  await expect(dietGrant.locator(".badge")).toHaveText("만료");
  await expect(page.getByTestId("revoke-grant-allergy-diet")).toHaveCount(0);

  await expect(badge("req-allergy-after-expire")).toHaveText("거부");
  await expect(page.getByTestId("feed-req-allergy-after-expire")).toContainText(
    "diet-agent/medical_record: grant-allergy-diet 권한이 만료됨",
  );
  await expect(page.getByTestId("ai-card-req-allergy-after-expire")).toHaveCount(0);
  await expect(page.getByTestId("ai-card-req-allergy-diet")).toBeVisible();
  await expect(aiCards()).toHaveCount(3);

  await expect(page.getByTestId("revoke-grant-card-budget")).toBeVisible();
  await expect(page.getByTestId("revoke-grant-card-budget")).toBeEnabled();
});

test("scene 5: revoke card grant, re-request denied, audit chain verified", async () => {
  await page.getByTestId("revoke-grant-card-budget").click();

  await expect(badge("req-card-after-revoke")).toHaveText("거부");
  await expect(page.getByTestId("feed-req-card-after-revoke")).toContainText(
    "budget-agent/card_tx: grant-card-budget 권한이 철회됨",
  );
  await expect(page.getByTestId("ai-card-req-card-after-revoke")).toHaveCount(0);
  await expect(aiCards()).toHaveCount(3);

  const cardGrant = page.getByTestId("grant-list").locator("li", { hasText: "budget-agent" });
  await expect(cardGrant.locator(".badge")).toHaveText("철회됨");
  await expect(page.getByTestId("revoke-grant-card-budget")).toBeDisabled();

  await expect(page.getByTestId("chain-status")).toHaveText("해시 체인 검증 ✓");
  const audit = page.getByTestId("audit-log");
  await expect(audit).toBeVisible();
  const kinds = await audit.locator(".kind").allTextContents();
  for (const k of ["권한 부여", "접근", "거부", "철회"]) expect(kinds).toContain(k);
  await waitForAnchorStatus(page, "match");
});
