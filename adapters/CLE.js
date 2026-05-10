const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeCLE() {
  const airportCode = 'CLE';
  const sourceUrl = 'https://www.clevelandairport.com/airport/tsa-security';
  
  console.log(`[CLE Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // CLE may load wait times via API/JS
    await new Promise(r => setTimeout(r, 3000));
    
    console.log(`[CLE Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // CLE uses .tsa-checkpoint cards or similar
      const cards = document.querySelectorAll('[class*="checkpoint"], [class*="Checkpoint"], [class*="tsa"], [class*="wait-time"]');
      
      cards.forEach(card => {
        const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="title"], [class*="Name"], [class*="Title"]');
        const timeEl = card.querySelector('[class*="time"], [class*="Time"], [class*="wait"], [class*="Wait"], [class*="minute"]');
        
        if (nameEl && timeEl) {
          const name = nameEl.innerText.trim();
          const timeText = timeEl.innerText.trim();
          const numbers = timeText.match(/(\d+)/g);
          if (numbers) {
            data.push({
              name,
              waitMinutes: Math.max(...numbers.map(n => parseInt(n, 10))),
              status: 'Active'
            });
          }
        }
      });
      
      // Fallback: look for any element with checkpoint + minutes pattern
      if (data.length === 0) {
        const body = document.body.innerText;
        const regex = /(?:Checkpoint|Concourse|Terminal|Gate)\s+([A-Z0-9\-]+)[^0-9]*?(\d+)\s*(?:min|minute)/gi;
        let match;
        while ((match = regex.exec(body)) !== null) {
          data.push({
            name: match[1].trim(),
            waitMinutes: parseInt(match[2], 10),
            status: 'Active'
          });
        }
      }
      
      return data;
    });

    console.log(`[CLE Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[CLE Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[CLE Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[CLE Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeCLE().then(() => process.exit(0));
}

module.exports = { scrapeCLE };
