const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

// Houston has two airports sharing the same website pattern
const AIRPORTS = [
  { code: 'IAH', url: 'https://fly2houston.com/iah/security/' },
  { code: 'HOU', url: 'https://fly2houston.com/hou/security/' },
];

async function scrapeHouston() {
  console.log(`[Houston Adapter] Launching Stealth Browser for IAH + HOU...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    for (const airport of AIRPORTS) {
      console.log(`[${airport.code} Adapter] Loading ${airport.url}...`);
      
      await page.goto(airport.url, { waitUntil: 'networkidle2', timeout: 45000 });
      
      console.log(`[${airport.code} Adapter] Page loaded. Extracting data...`);
      
      const checkpointsData = await page.evaluate(() => {
        const data = [];
        
        // fly2houston uses .checkpoint-card or similar card-based layout
        // Try multiple selector strategies
        
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
          
          // Look for patterns like "Terminal A 5 min" or "Checkpoint 1 10 minutes"
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

      console.log(`[${airport.code} Adapter] Extracted ${checkpointsData.length} checkpoints:`);
      console.log(checkpointsData);

      if (checkpointsData.length > 0) {
        await syncAirportData(airport.code, checkpointsData);
        console.log(`[${airport.code} Adapter] Successfully pushed to flyfast-v2 Firebase!`);
      } else {
        console.warn(`[${airport.code} Adapter] No checkpoints found. Page structure may have changed.`);
      }
    }
    
  } catch (err) {
    console.error(`[Houston Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeHouston().then(() => process.exit(0));
}

module.exports = { scrapeHouston };
