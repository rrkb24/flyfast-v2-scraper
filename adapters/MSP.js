const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeMSP() {
  const airportCode = 'MSP';
  const sourceUrl = 'https://www.mspairport.com/airport/security-screening/security-wait-times';
  
  console.log(`[MSP Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[MSP Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // MSP uses .security-wait-time cards with .security-wait-time__checkpoint-name and __time
      const cards = document.querySelectorAll('.security-wait-time');
      
      cards.forEach(card => {
        const nameEl = card.querySelector('.security-wait-time__checkpoint-name');
        const timeEl = card.querySelector('.security-wait-time__time');
        
        if (!nameEl) return;
        
        const name = nameEl.innerText.trim();
        const timeText = timeEl ? timeEl.innerText.trim().toLowerCase() : '';
        
        // Check if closed
        if (timeText.includes('closed') || card.classList.contains('security-wait-time--closed')) {
          data.push({ name, waitMinutes: null, status: 'Closed' });
          return;
        }
        
        // Parse "Less than 5 minutes" → 5, "10-15 minutes" → 15, etc.
        const numbers = timeText.match(/(\d+)/g);
        const waitMinutes = numbers ? Math.max(...numbers.map(n => parseInt(n, 10))) : 0;
        
        data.push({
          name,
          waitMinutes,
          status: 'Active'
        });
      });
      
      return data;
    });

    console.log(`[MSP Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[MSP Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[MSP Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[MSP Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeMSP().then(() => process.exit(0));
}

module.exports = { scrapeMSP };
