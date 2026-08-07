import { expect, test } from "@playwright/test";

const viewports = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`model capabilities fit and remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/tests/fixtures/image-studio-model-picker.html");

    const picker = page.getByTestId("model-picker");
    const enabled = page.getByTestId("model-general");
    const alternate = page.getByTestId("model-replicate-flux-dev-lora");
    const video = page.getByTestId("model-atlas-video");
    await expect(picker).toBeVisible();
    await expect(enabled).toBeEnabled();
    await expect(alternate).toBeDisabled();
    await expect(video).toBeDisabled();
    await expect(alternate).toContainText("not honored");
    await expect(video).toContainText("Video generation is not available");

    const geometry = await page.evaluate(() => {
      const ids = [
        "model-general",
        "model-replicate-flux-dev-lora",
        "model-atlas-video",
      ];
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        controls: ids.map((id) => {
          const element = document.querySelector<HTMLElement>(`[data-testid='${id}']`);
          const rect = element?.getBoundingClientRect();
          return {
            id,
            left: rect?.left ?? -1,
            right: rect?.right ?? -1,
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
          };
        }),
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    for (const control of geometry.controls) {
      expect(control.width, control.id).toBeGreaterThan(0);
      expect(control.height, control.id).toBeGreaterThan(0);
      expect(control.left, control.id).toBeGreaterThanOrEqual(0);
      expect(control.right, control.id).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    }

    await page.getByTestId("model-mode-table").click();
    await expect(page.getByTestId("model-row-general")).toBeVisible();
    await expect(page.getByTestId("model-row-replicate-flux-dev-lora"))
      .toHaveAttribute("aria-disabled", "true");
    const tableGeometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      hasLocalHorizontalScroller: Array.from(document.querySelectorAll("div"))
        .some((element) => element.scrollWidth > element.clientWidth),
    }));
    expect(tableGeometry.documentWidth).toBeLessThanOrEqual(tableGeometry.viewportWidth + 1);
    if (viewport.width < 720) {
      expect(tableGeometry.hasLocalHorizontalScroller).toBe(true);
    }
  });
}
