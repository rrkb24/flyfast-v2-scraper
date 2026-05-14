const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

async function scrape() {
  const browser = await puppeteer.launch({headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox']});
  try {
    const page = await browser.newPage();
    
    // Abort useless resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    try {
      await page.goto('https://www.fly2houston.com/iah/security/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch(e) {
      console.log('Goto timed out but continuing');
    }
    
    await new Promise(r => setTimeout(r, 5000));
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('iah_text_dump.txt', text);
    console.log("IAH DUMP COMPLETE");
  } catch(e) {
    console.log(e);
  } finally {
    await browser.close();
  }
}
scrape();
