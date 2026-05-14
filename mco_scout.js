const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function run() {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.goto('https://flymco.com/security/', {waitUntil: 'domcontentloaded', timeout: 30000});
  await new Promise(r => setTimeout(r, 4000));
  const html = await page.evaluate(() => document.body.innerHTML);
  require('fs').writeFileSync('mco_dom.html', html);
  await browser.close();
  console.log("Wrote mco_dom.html");
}
run();
