import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:4567/", { waitUntil: "networkidle" });
const info = await page.evaluate(() => ({
  title: document.title,
  hasTech: !!document.querySelector('#tech'),
  tileCount: document.querySelectorAll('.tech__tile').length,
  imgCount: document.querySelectorAll('.tech__tile img').length,
  bodyLen: document.body.innerHTML.length,
}));
console.log(info);
await browser.close();
