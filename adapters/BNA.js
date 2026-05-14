const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeBNA() {
  const airportCode = 'BNA';
  const sourceUrl = 'https://flynashville.com/';
  
  console.log(`[BNA Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[BNA Adapter] Page loaded. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // The BNA website has a single centralized TSA Wait Times section in the top container
      const waitTimeSpan = document.querySelector('div.top h4 span');
      
      if (waitTimeSpan) {
        const text = waitTimeSpan.innerText.trim();
        let waitMinutes = null;
        let status = 'Active';

        // Extract numbers from something like "Less than 10 minutes" or "15 minutes"
        const numbers = text.match(/(\d+)/);
        
        if (text.toUpperCase().includes('CLOSED') || text.toUpperCase() === 'X') {
          status = 'Closed';
        } else if (numbers) {
          waitMinutes = parseInt(numbers[1], 10);
        } else {
          status = 'Closed'; // If we find no numbers and it doesn't say closed, assume unavailable
        }

        // BNA has a single consolidated security checkpoint now
        data.push({
          name: 'Main Checkpoint',
          waitMinutes: waitMinutes,
          status: status
        });
      }
      
      return data;
    });

    console.log(`[BNA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[BNA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[BNA Adapter] No checkpoints found. DOM verification failed.");
    }
    
  } catch (err) {
    console.error(`[BNA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeBNA().then(() => process.exit(0));
}

module.exports = { scrapeBNA };
