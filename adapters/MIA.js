const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeMIA() {
  const airportCode = 'MIA';
  const sourceUrl = 'https://www.miami-airport.com/tsa-waittimes.asp';

  console.log(`[MIA Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log(`[MIA Adapter] Page loaded. Extracting data...`);
    
    await new Promise(r => setTimeout(r, 4000));

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const rows = document.querySelectorAll('tr, .row, .checkpoint-row');
      
      rows.forEach(row => {
        const text = row.innerText.trim().toUpperCase();
        
        if (!text.includes('CHECKPOINT')) return;

        // Match Checkpoint 1, Checkpoint 2, etc.
        const cpMatch = text.match(/CHECKPOINT\s*(\d+)/);
        if (!cpMatch) return;

        const nameRaw = `Checkpoint ${cpMatch[1]}`;

        let laneType = 'Standard';
        if (text.includes('PRECHECK') || text.includes('PRE')) {
          laneType = 'TSA PreCheck';
        }

        const name = `${nameRaw} - ${laneType}`;
        
        if (parsedKeys.has(name)) return;

        let waitMinutes = null;
        let status = 'Active';

        if (text.includes('CLOSED') || text.includes('X')) {
          status = 'Closed';
        } else {
          const match = text.match(/(\d+)\s*(?:MIN|M|-)/);
          if (match) {
            waitMinutes = parseInt(match[1], 10);
          } else {
             const numMatch = text.match(/(\d+)/);
             if (numMatch) waitMinutes = parseInt(numMatch[1], 10);
             else status = 'Closed';
          }
        }

        parsedKeys.add(name);
        data.push({
          name,
          waitMinutes,
          status
        });
      });

      return data;
    });

    console.log(`[MIA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[MIA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[MIA Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[MIA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeMIA().then(() => process.exit(0));
}

module.exports = { scrapeMIA };
