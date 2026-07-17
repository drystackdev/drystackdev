import { chromium } from "playwright";

const html = `
<!doctype html><html><body>
<div id="cloud" style="width:300px;height:300px;position:relative;">
  <span id="tile" style="position:absolute;top:50px;left:50px;width:60px;height:60px;background:red;" data-dry="foo" data-dry-kind="image"></span>
</div>
<script>
  const cloud = document.getElementById('cloud');
  cloud.addEventListener('pointerdown', (e) => {
    cloud.setPointerCapture(e.pointerId);
  });
  cloud.addEventListener('pointerup', (e) => {
    cloud.releasePointerCapture(e.pointerId);
  });
  window.__clickLog = [];
  document.addEventListener('click', (e) => {
    window.__clickLog.push({ id: e.target.id, tag: e.target.tagName });
  }, true);
</script>
</body></html>
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);

const box = await page.evaluate(() => {
  const r = document.getElementById('tile').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const x = box.x + box.w / 2;
const y = box.y + box.h / 2;

await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(100);
console.log(await page.evaluate(() => window.__clickLog));
await browser.close();
