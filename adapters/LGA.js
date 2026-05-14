const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeLGA() {
  const airportCode = 'LGA';
  const sourceUrl = 'https://www.laguardiaairport.com/';

  console.log(`[LGA Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log(`[LGA Adapter] Page loaded. Extracting data...`);
    
    await new Promise(r => setTimeout(r, 4000));

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const rows = document.querySelectorAll('.terminal-row, .wait-time-row, tr, [class*="terminal"]');
      
      rows.forEach(row => {
        const text = row.innerText.trim().toUpperCase();
        
        if (!text.includes('TERMINAL A') && 
            !text.includes('TERMINAL B') && 
            !text.includes('TERMINAL C')) {
          return;
        }

        let nameRaw = '';
        if (text.includes('TERMINAL A')) nameRaw = 'Terminal A';
        else if (text.includes('TERMINAL B')) nameRaw = 'Terminal B';
        else if (text.includes('TERMINAL C')) nameRaw = 'Terminal C';
        
        if (!nameRaw) return;

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

    console.log(`[LGA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[LGA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[LGA Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[LGA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeLGA().then(() => process.exit(0));
}

module.exports = { scrapeLGA };
