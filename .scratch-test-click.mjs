import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("http://localhost:4567/", { waitUntil: "networkidle" });

await page.evaluate(() => {
  window.__clickLog = [];
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      window.__clickLog.push({
        tag: t.tagName,
        cls: t.className,
        dataDry: t.getAttribute && t.getAttribute("data-dry"),
        closestDry: t.closest && t.closest("[data-dry]")?.getAttribute("data-dry"),
        defaultPrevented: e.defaultPrevented,
        time: Date.now(),
      });
    },
    true,
  );
});

await page.evaluate(() => {
  document.querySelector(".tech__tile img").scrollIntoView({ block: "center" });
});
await page.waitForTimeout(300);

for (let i = 0; i < 5; i++) {
  const box = await page.evaluate(() => {
    const el = document.querySelector(".tech__tile img");
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log(`sample ${i}`, box);
  await page.waitForTimeout(100);
}

const box = await page.evaluate(() => {
  const el = document.querySelector(".tech__tile img");
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const x = box.x + box.w / 2;
const y = box.y + box.h / 2;
console.log("clicking at", x, y);

await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.up();

await page.waitForTimeout(200);
const log = await page.evaluate(() => window.__clickLog);
console.log(JSON.stringify(log, null, 2));

await page.screenshot({ path: ".scratch-screenshot.png" });

await browser.close();
