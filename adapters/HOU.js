const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeHOU() {
  const airportCode = 'HOU';
  const sourceUrl = 'https://fly2houston.com/hou/security/';
  
  console.log(`[HOU Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[HOU Adapter] Page loaded. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // Strategy 1: Look for structured cards
      const cards = document.querySelectorAll('[class*="checkpoint"], [class*="Checkpoint"], .card, [class*="security-card"]');
      
      cards.forEach(card => {
        const heading = card.querySelector('h2, h3, h4, .title, [class*="name"], [class*="Name"]');
        if (!heading) return;
        
        const name = heading.innerText.trim();
        const timeEl = card.querySelector('[class*="time"], [class*="Time"], [class*="wait"], [class*="Wait"]');
        
        if (timeEl) {
          const timeText = timeEl.innerText.trim();
          const numbers = timeText.match(/(\d+)/g);
          if (numbers) {
            const waitMinutes = Math.max(...numbers.map(n => parseInt(n, 10)));
            data.push({ name, waitMinutes, status: 'Active' });
          }
        }
      });
      
      // Strategy 2: Raw text extraction fallback
      if (data.length === 0) {
        const body = document.body.innerText.replace(/\s+/g, ' ');
        
        const patterns = [
          /(?:Terminal|Checkpoint|Gate|Security)\s+([A-Z0-9]+)[^0-9]*?(\d+)\s*(?:min|minute)/gi,
          /((?:North|South|East|West|Main|Central)\s+(?:Checkpoint|Security))[^0-9]*?(\d+)\s*(?:min|minute)/gi,
        ];
        
        for (const regex of patterns) {
          let match;
          while ((match = regex.exec(body)) !== null) {
            data.push({
              name: match[1].trim(),
              waitMinutes: parseInt(match[2], 10),
              status: 'Active'
            });
          }
        }
      }
      
      return data;
    });

    console.log(`[HOU Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[HOU Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn(`[HOU Adapter] No checkpoints found. Page structure may have changed.`);
    }
    
  } catch (err) {
    console.error(`[HOU Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeHOU().then(() => process.exit(0));
}

module.exports = { scrapeHOU };
