const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeATL() {
  const airportCode = 'ATL';
  const sourceUrl = 'https://www.atl.com/times/';
  
  console.log(`[ATL Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    // Navigate and wait for the page to fully load past Cloudflare
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[ATL Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // Replace all whitespace (including newlines) with a single space
      const textBody = document.body.innerText.replace(/\s+/g, ' ');
      
      const targets = {
        "DOMESTIC MAIN CHECKPOINT": "Domestic Main Checkpoint",
        "NORTH CHECKPOINT": "Domestic North Checkpoint",
        "LOWER NORTH CHECKPOINT": "Domestic Lower North Checkpoint",
        "SOUTH PRECHECK ONLY CHECKPOINT": "Domestic South Checkpoint (PreCheck)",
        "INT'L MAIN CHECKPOINT": "International Main Checkpoint"
      };
      
      for (const [searchText, displayName] of Object.entries(targets)) {
        // Look for the target text followed by a space and digits
        const regex = new RegExp(`${searchText}\\s*(\\d+)`, 'i');
        const match = textBody.match(regex);
        
        if (match && match[1]) {
          data.push({
            name: displayName,
            waitMinutes: parseInt(match[1], 10),
            status: 'Active'
          });
        }
      }
      return data;
    });

    console.log(`[ATL Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    // Push to strictly flyfast-v2 Firebase
    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[ATL Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[ATL Adapter] Failed to parse wait times from HTML. Might need CSS selector tuning.");
    }
    
  } catch (err) {
    console.error(`[ATL Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

// Allow running standalone for testing
if (require.main === module) {
  scrapeATL().then(() => process.exit(0));
}

module.exports = { scrapeATL };
