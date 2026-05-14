const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function run() {
  const browser = await puppeteer.launch({headless: "new", args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    
    // We only want to log XHR and fetch requests to find the API
    page.on('response', async (response) => {
        const req = response.request();
        if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
            console.log("API URL:", req.url());
        }
    });

    try {
      await page.goto('https://www.fly2houston.com/iah/security/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch(e) {}
    
    await new Promise(r => setTimeout(r, 5000));
  } catch(e) {
  } finally {
    await browser.close();
  }
}
run();
