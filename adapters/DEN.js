const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDEN() {
  const airportCode = 'DEN';
  const sourceUrl = 'https://www.flydenver.com/security/';
  
  console.log(`[DEN Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // DEN loads wait times via JavaScript — wait for the .tsa cards to populate
    await page.waitForSelector('.tsa .wait-num', { timeout: 15000 }).catch(() => {
      console.warn('[DEN Adapter] .wait-num not found within timeout, proceeding anyway.');
    });
    
    console.log(`[DEN Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // DEN uses .tsa cards: each has .name (e.g. "East Security") and .wait-time-main entries
      const tsaCards = document.querySelectorAll('.tsa');
      
      tsaCards.forEach(card => {
        const nameEl = card.querySelector('.name');
        if (!nameEl) return;
        const checkpointName = nameEl.innerText.trim();
        
        // Each card has multiple .wait-time-main divs (Standard, PreCheck)
        const waitEntries = card.querySelectorAll('.wait-time-main');
        
        waitEntries.forEach(entry => {
          const typeEl = entry.querySelector('.wait-type');
          const numEl = entry.querySelector('.wait-num');
          
          if (!typeEl || !numEl) return;
          
          const waitType = typeEl.innerText.trim();
          const waitText = numEl.innerText.trim();
          
          // Parse ranges like "1-5" → take the higher number, or single "4" → 4
          const numbers = waitText.match(/(\d+)/g);
          if (!numbers) return;
          
          const waitMinutes = Math.max(...numbers.map(n => parseInt(n, 10)));
          
          data.push({
            name: `${checkpointName} - ${waitType}`,
            waitMinutes,
            status: 'Active'
          });
        });
      });
      
      return data;
    });

    console.log(`[DEN Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DEN Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DEN Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[DEN Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDEN().then(() => process.exit(0));
}

module.exports = { scrapeDEN };
