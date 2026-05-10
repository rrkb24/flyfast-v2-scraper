const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeLAS() {
  const airportCode = 'LAS';
  // Navigate directly to the Zensors embed to avoid cookie banners
  const sourceUrl = 'https://www.harryreidairport.com/security-wait-times';
  
  console.log(`[LAS Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // Dismiss cookie banner if present
    await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    
    console.log(`[LAS Adapter] Page loaded. Looking for Zensors iframe...`);
    
    // Wait for the Zensors iframe
    await page.waitForSelector('iframe', { timeout: 15000 });
    
    const iframeHandle = await page.evaluateHandle(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.includes('zensors.live')) return iframe;
      }
      return null;
    });
    
    const frame = await iframeHandle.contentFrame();
    if (!frame) {
      console.warn('[LAS Adapter] Could not access Zensors iframe.');
      await browser.close();
      return;
    }
    
    console.log(`[LAS Adapter] Inside Zensors iframe. Extracting checkpoint data...`);
    
    // Wait for dropdown
    await frame.waitForSelector('select', { timeout: 10000 });
    
    const options = await frame.evaluate(() => {
      const select = document.querySelector('select');
      if (!select) return [];
      return Array.from(select.options).map((opt, i) => ({
        index: i,
        value: opt.value,
        text: opt.text.trim()
      }));
    });
    
    console.log(`[LAS Adapter] Found ${options.length} checkpoints in dropdown.`);
    
    const checkpointsData = [];
    
    for (const opt of options) {
      await frame.select('select', opt.value);
      await new Promise(r => setTimeout(r, 2000));
      
      const waitData = await frame.evaluate(() => {
        const results = [];
        const allText = document.body.innerText;
        
        // Look for "Standard" followed by a number and "min"
        const standardMatch = allText.match(/Standard[\s\S]*?(\d+)\s*min/i);
        const precheckMatch = allText.match(/(?:TSA\s*)?Pre\s*(?:Check|✓)[\s\S]*?(\d+)\s*min/i);
        
        if (standardMatch) results.push({ type: 'Standard', minutes: parseInt(standardMatch[1], 10) });
        if (precheckMatch) results.push({ type: 'TSA PreCheck', minutes: parseInt(precheckMatch[1], 10) });
        
        return results;
      });
      
      for (const wd of waitData) {
        checkpointsData.push({
          name: `${opt.text} - ${wd.type}`,
          waitMinutes: wd.minutes,
          status: 'Active'
        });
      }
    }

    console.log(`[LAS Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[LAS Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[LAS Adapter] No checkpoints found. Zensors widget may have changed.");
    }
    
  } catch (err) {
    console.error(`[LAS Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeLAS().then(() => process.exit(0));
}

module.exports = { scrapeLAS };
