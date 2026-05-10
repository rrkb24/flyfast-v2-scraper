const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeOMA() {
  const airportCode = 'OMA';
  const sourceUrl = 'https://www.flyoma.com/passenger-services/security-checkpoint-wait-times/';
  
  console.log(`[OMA Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[OMA Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // OMA uses .tsa-wait-times-element with .tsa-wait-times-element_concourse-list
      const container = document.querySelector('.tsa-wait-times-element');
      if (!container) return data;
      
      const items = container.querySelectorAll('li');
      
      items.forEach(item => {
        const text = item.innerText.trim();
        // Parse "Concourse A (South): 0-5 MINUTES" or "Concourse B (North): 0-5 MINUTES"
        const match = text.match(/(Concourse\s+[A-Z](?:\s*\([^)]+\))?)\s*[:\-–]\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*MINUTES?/i);
        
        if (match) {
          const name = match[1].trim();
          // Take the higher number in the range (e.g., "0-5" → 5)
          const waitMinutes = match[3] ? parseInt(match[3], 10) : parseInt(match[2], 10);
          
          data.push({
            name,
            waitMinutes,
            status: 'Active'
          });
        }
      });
      
      // Fallback: parse raw text of the container
      if (data.length === 0) {
        const rawText = container.innerText;
        const regex = /(Concourse\s+[A-Z](?:\s*\([^)]+\))?)[^0-9]*?(\d+)(?:\s*[-–]\s*(\d+))?\s*MINUTES?/gi;
        let m;
        while ((m = regex.exec(rawText)) !== null) {
          data.push({
            name: m[1].trim(),
            waitMinutes: m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10),
            status: 'Active'
          });
        }
      }
      
      return data;
    });

    console.log(`[OMA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[OMA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[OMA Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[OMA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeOMA().then(() => process.exit(0));
}

module.exports = { scrapeOMA };
