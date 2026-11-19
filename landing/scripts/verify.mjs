import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const baseUrl = process.env.TEST_URL || "http://localhost:4173";
const expectedUrl =
  "https://raw.githubusercontent.com/mahdyaralipor/v2all/main/real_sub.txt";
const report = { viewports: [], checks: {}, errors: [] };
const browser = await chromium.launch({ headless: true });
await mkdir("artifacts", { recursive: true });

function trackErrors(page) {
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
}

async function load(page, url = baseUrl) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

function luminance(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

try {
  report.checks.contrast = {};
  for (const [name, color] of Object.entries({
    ink: "#252820",
    muted: "#686b5e",
    accent: "#526638",
  })) {
    const ratio = (luminance("#f4f3ec") + 0.05) / (luminance(color) + 0.05);
    assert.ok(ratio >= 4.5, `${name} contrast is below 4.5:1`);
    report.checks.contrast[name] = `${ratio.toFixed(2)}:1`;
  }
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    const viewportContext = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await viewportContext.newPage();
    trackErrors(page);
    await page.addInitScript(() => {
      window.lcp = 0;
      window.cls = 0;
      new PerformanceObserver((list) => {
        window.lcp = list.getEntries().at(-1).startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (!entry.hadRecentInput) window.cls += entry.value;
        });
      }).observe({ type: "layout-shift", buffered: true });
    });
    await load(page);
    const metrics = await page.evaluate(() => {
      const field = document.querySelector("textarea");
      const button = document.querySelector(".copy-button");
      const canvasHeight = document.documentElement.scrollHeight;
      const accentArea = [...document.querySelectorAll("*")].reduce(
        (area, element) => {
          const style = getComputedStyle(element);
          if (
            Number(style.opacity) === 0 ||
            (style.color !== "rgb(82, 102, 56)" &&
              style.backgroundColor !== "rgb(82, 102, 56)")
          )
            return area;
          const bounds = element.getBoundingClientRect();
          const width = Math.max(
            0,
            Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0),
          );
          return area + width * bounds.height;
        },
        0,
      );
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        urlClipped: field.scrollHeight > field.clientHeight,
        copyTargetHeight: button.getBoundingClientRect().height,
        displaySize: getComputedStyle(document.querySelector("h1")).fontSize,
        blankBandHeight: document
          .querySelector(".hero-pause")
          .getBoundingClientRect().height,
        blankBandMinimum: innerHeight * 0.15,
        fontLoaded: document.fonts.check('600 48px "Space Grotesk"'),
        accentCoverageUpperBound: Number(
          (accentArea / (innerWidth * canvasHeight)).toFixed(4),
        ),
        minimumTapTarget: Math.min(
          ...[...document.querySelectorAll("a, button, textarea")].map(
            (el) => el.getBoundingClientRect().height,
          ),
        ),
        lcpMs: window.lcp,
        cls: window.cls,
        resources: performance.getEntriesByType("resource").map((r) => r.name),
      };
    });
    assert.equal(
      metrics.scrollWidth,
      width,
      `Horizontal overflow at ${width}px`,
    );
    assert.equal(
      metrics.urlClipped,
      false,
      `Subscription is clipped at ${width}px`,
    );
    assert.ok(metrics.copyTargetHeight >= 44, "Copy target is too small");
    assert.ok(
      metrics.minimumTapTarget >= 44,
      "An interactive target is below 44px",
    );
    assert.ok(
      metrics.accentCoverageUpperBound <= 0.1,
      "Accent exceeds 10% of the page",
    );
    assert.equal(
      metrics.resources.length,
      0,
      "The standalone page requests an external asset",
    );
    assert.ok(
      parseFloat(metrics.displaySize) >= 96,
      "Brand loses its display scale",
    );
    assert.ok(
      metrics.blankBandHeight + 1 >= metrics.blankBandMinimum,
      "Blank band is too short",
    );
    assert.ok(
      metrics.lcpMs > 0 && metrics.lcpMs < 1500,
      "Local LCP exceeds 1.5 seconds",
    );
    assert.equal(metrics.fontLoaded, true, "Display font failed to load");
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations,
      [],
      `Accessibility violations at ${width}px`,
    );
    metrics.accessibilityViolations = accessibility.violations.length;
    report.viewports.push(metrics);
    await page.screenshot({
      path: `artifacts/v2all-${width}.png`,
      fullPage: true,
    });
    if (width === 1440)
      await page.screenshot({ path: "artifacts/v2all-desktop-viewport.png" });
    await viewportContext.close();
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  trackErrors(page);
  await load(page);
  await page.locator(".copy-button").click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    expectedUrl,
  );
  assert.equal(await page.locator("[data-copy-label]").textContent(), "Copied");
  assert.match(
    await page.locator("#copy-status").textContent(),
    /Now paste it into your client/,
  );
  assert.equal(
    await page
      .locator("#copy-status")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0.15s",
  );
  assert.equal(
    await page
      .locator(".copy-button")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.equal(
    await page
      .locator(".copy-button")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await page.waitForTimeout(3100);
  assert.equal(
    await page.locator("[data-copy-label]").textContent(),
    "Copy subscription",
  );
  report.checks.clipboard =
    "Exact subscription copied; 150ms confirmation; reset after 3 seconds";

  // A failed second attempt must not retain the first attempt's success label.
  await page.locator(".copy-button").click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    });
    document.execCommand = () => false;
  });
  await page.locator(".copy-button").click();
  assert.equal(
    await page.locator("#copy-status").getAttribute("data-state"),
    "error",
  );
  assert.equal(
    await page.locator("[data-copy-label]").textContent(),
    "Copy subscription",
  );
  const selected = await page.locator("textarea").evaluate((el) => ({
    focused: document.activeElement === el,
    start: el.selectionStart,
    end: el.selectionEnd,
    length: el.value.length,
  }));
  assert.equal(selected.focused, true);
  assert.equal(selected.start, 0);
  assert.equal(selected.end, selected.length);
  report.checks.clipboardFailure =
    "Denied clipboard selects the URL, announces recovery, and clears stale success";
  await context.close();

  const legacyContext = await browser.newContext();
  await legacyContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const legacyPage = await legacyContext.newPage();
  await legacyPage.addInitScript(() => {
    window.originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await load(legacyPage);
  await legacyPage.locator(".copy-button").click();
  assert.equal(
    await legacyPage.locator("#copy-status").getAttribute("data-state"),
    "success",
  );
  assert.equal(
    await legacyPage.evaluate(() => window.originalClipboard.readText()),
    expectedUrl,
  );
  report.checks.legacyClipboard =
    "The native legacy fallback copies the exact URL";
  await legacyContext.close();

  const keyboard = await browser.newPage({ reducedMotion: "reduce" });
  await load(keyboard);
  await keyboard.keyboard.press("Tab");
  assert.equal(
    await keyboard
      .locator(".skip-link")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await keyboard.keyboard.press("Tab");
  assert.equal(
    await keyboard
      .locator(".small-wordmark")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await keyboard.keyboard.press("Tab");
  assert.equal(
    await keyboard
      .locator(".source-link")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await keyboard.keyboard.press("Shift+Tab");
  await keyboard.keyboard.press("Shift+Tab");
  await keyboard.keyboard.press("Enter");
  assert.equal(
    await keyboard
      .locator("main")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await keyboard.keyboard.press("Tab");
  assert.equal(
    await keyboard
      .locator("textarea")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await keyboard.keyboard.press("Tab");
  assert.equal(
    await keyboard
      .locator(".copy-button")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  assert.equal(
    await keyboard
      .locator(".copy-button")
      .evaluate((el) => getComputedStyle(el).outlineWidth),
    "2px",
  );
  const tabPath = [];
  for (let i = 0; i < 3; i++) {
    await keyboard.keyboard.press("Tab");
    tabPath.push(
      await keyboard.evaluate(() => document.activeElement.className),
    );
  }
  assert.deepEqual(tabPath, [
    "text-link setup-link",
    "license-link",
    "text-link back-link",
  ]);
  await keyboard.keyboard.press("Enter");
  await keyboard.waitForTimeout(50);
  assert.equal(
    await keyboard
      .locator("textarea")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  assert.equal(
    await keyboard
      .locator(".wordmark-cursor")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.equal(await keyboard.locator(".will-reveal").count(), 0);
  report.checks.keyboard =
    "Skip link, URL, copy, setup, license, and return link all reachable; 2px focus rings";
  report.checks.reducedMotion =
    "No entrance animation or hidden reveal content";
  await keyboard.close();

  const motion = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await load(motion);
  assert.equal(
    await motion
      .locator(".wordmark-cursor")
      .evaluate((el) => getComputedStyle(el).animationDuration),
    "0.24s",
  );
  assert.ok((await motion.locator(".will-reveal").count()) > 0);
  const pageHeight = await motion.evaluate(
    () => document.documentElement.scrollHeight,
  );
  for (let y = 0; y < pageHeight; y += 400) {
    await motion.evaluate(
      (top) => window.scrollTo({ top, behavior: "instant" }),
      y,
    );
    await motion.waitForTimeout(120);
  }
  await motion.waitForTimeout(350);
  assert.equal(await motion.locator(".will-reveal").count(), 0);
  await motion.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await motion
      .locator(".wordmark-cursor")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  report.checks.motion =
    "240ms cursor and section reveals; all sections reveal on scroll; reduced-motion changes apply immediately";
  await motion.close();

  const noJs = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  await load(noJs);
  assert.equal(await noJs.locator("h1").textContent(), "v2all");
  assert.equal(await noJs.locator("textarea").inputValue(), expectedUrl);
  assert.equal(await noJs.locator(".copy-button").isVisible(), false);
  assert.equal(await noJs.locator(".manual-copy-note").isVisible(), true);
  assert.equal(await noJs.locator("#catch-title").isVisible(), true);
  await noJs.screenshot({
    path: "artifacts/v2all-no-javascript.png",
    fullPage: true,
  });
  report.checks.noJavaScript =
    "All content and the selectable subscription remain available";
  await noJs.close();

  const localFile = await browser.newPage({ reducedMotion: "reduce" });
  trackErrors(localFile);
  await load(localFile, pathToFileURL(resolve("dist/index.html")).href);
  assert.equal(await localFile.locator(".copy-button").isVisible(), true);
  assert.equal(await localFile.locator("textarea").inputValue(), expectedUrl);
  await localFile.locator(".copy-button").click();
  await localFile.locator("#copy-status[data-state]").waitFor();
  assert.equal(
    await localFile.locator("#copy-status").getAttribute("data-state"),
    "success",
  );
  report.checks.standalone =
    "The single HTML file opens and copies over file:// without a server";
  await localFile.close();

  const development = await browser.newPage({ reducedMotion: "reduce" });
  trackErrors(development);
  await load(development, "http://localhost:5173");
  assert.equal(
    await development.locator(".hero-headline").textContent(),
    "Dead configsstay out.",
  );
  assert.equal(await development.locator(".copy-button").isVisible(), true);
  report.checks.reactEntry =
    "Development React entry renders the same page without console errors";
  await development.close();

  const html = await readFile("dist/index.html");
  report.checks.totalBytes = html.byteLength;
  assert.ok(
    html.byteLength < 200_000,
    "The page exceeds the total size budget",
  );
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    "artifacts/verification.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
