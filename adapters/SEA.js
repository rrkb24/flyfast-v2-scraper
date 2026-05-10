const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeSEA() {
  const airportCode = 'SEA';
  const sourceUrl = 'https://www.portseattle.org/page/live-estimated-checkpoint-wait-times';
  
  console.log(`[SEA Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // SEA loads wait times dynamically — wait for the data to populate
    await page.waitForSelector('.wait-time', { timeout: 15000 }).catch(() => {
      console.warn('[SEA Adapter] .wait-time selector not found within timeout, proceeding with what we have.');
    });
    
    console.log(`[SEA Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const items = document.querySelectorAll('.checkpoint-item');
      
      items.forEach(item => {
        const nameEl = item.querySelector('.checkpoint-name');
        const waitEl = item.querySelector('.wait-time');
        
        if (!nameEl || !waitEl) return;
        
        const name = nameEl.innerText.trim();
        const waitText = waitEl.innerText.trim().toLowerCase();
        
        // Skip closed checkpoints
        if (waitText.includes('closed')) {
          data.push({ name, waitMinutes: null, status: 'Closed' });
          return;
        }
        
        // Parse "< 5 min" → 5, "10 min" → 10, etc.
        const waitMatch = waitText.match(/(\d+)/);
        const waitMinutes = waitMatch ? parseInt(waitMatch[1], 10) : 0;
        
        data.push({
          name,
          waitMinutes,
          status: 'Active'
        });
      });
      
      return data;
    });

    console.log(`[SEA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[SEA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[SEA Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[SEA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeSEA().then(() => process.exit(0));
}

module.exports = { scrapeSEA };
