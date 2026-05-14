const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

async function scrapeMCO() {
  const airportCode = 'MCO';
  const sourceUrl = 'https://flymco.com/security/';

  console.log(`[MCO Dumper] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log(`[MCO Dumper] Page loaded. Extracting data...`);
    
    await new Promise(r => setTimeout(r, 6000));

    const html = await page.evaluate(() => document.body.innerHTML);
    fs.writeFileSync('mco_dom_dump.html', html);
    
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('mco_text_dump.txt', text);
    
    console.log("[MCO Dumper] DUMP COMPLETE! Saved to mco_dom_dump.html and mco_text_dump.txt");

  } catch (err) {
    console.error(`[MCO Dumper] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

scrapeMCO();
