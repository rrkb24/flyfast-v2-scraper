const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDFW() {
  const airportCode = 'DFW';
  const sourceUrl = 'https://www.dfwairport.com/security/';
  
  console.log(`[DFW Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // Dismiss cookie banner if present
    await page.click('button[aria-label="Deny"]').catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    
    console.log(`[DFW Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // DFW uses buttons with aria-label containing checkpoint info
      // e.g. "B30 checkpoint - General - current wait time 0 minutes"
      const buttons = document.querySelectorAll('button[aria-label*="checkpoint"]');
      
      buttons.forEach(btn => {
        const label = btn.getAttribute('aria-label') || '';
        
        // Parse: "B30 checkpoint - General - current wait time 0 minutes"
        const match = label.match(/^(\S+)\s+checkpoint\s*-\s*(.+?)\s*-\s*current wait time\s+(\d+)\s*minutes?/i);
        
        if (match) {
          const gate = match[1];
          const type = match[2].trim();
          const waitMinutes = parseInt(match[3], 10);
          
          data.push({
            name: `${gate} - ${type}`,
            waitMinutes,
            status: 'Active'
          });
        }
      });
      
      return data;
    });

    console.log(`[DFW Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DFW Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DFW Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[DFW Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDFW().then(() => process.exit(0));
}

module.exports = { scrapeDFW };
