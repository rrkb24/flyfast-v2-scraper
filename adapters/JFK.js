const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeJFK() {
  const airportCode = 'JFK';
  const sourceUrl = 'https://www.jfkairport.com/';

  console.log(`[JFK Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[JFK Adapter] Page loaded. Extracting data...`);
    
    // Use standard setTimeout instead of deprecated page.waitForTimeout
    await new Promise(r => setTimeout(r, 4000));

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const rows = document.querySelectorAll('.terminal-row, .wait-time-row, tr, [class*="terminal"]');
      
      rows.forEach(row => {
        const text = row.innerText.trim().toUpperCase();
        
        if (!text.includes('TERMINAL 1') && 
            !text.includes('TERMINAL 4') && 
            !text.includes('TERMINAL 5') && 
            !text.includes('TERMINAL 7') && 
            !text.includes('TERMINAL 8')) {
          return;
        }

        let nameRaw = '';
        if (text.includes('TERMINAL 1')) nameRaw = 'Terminal 1';
        else if (text.includes('TERMINAL 4')) nameRaw = 'Terminal 4';
        else if (text.includes('TERMINAL 5')) nameRaw = 'Terminal 5';
        else if (text.includes('TERMINAL 7')) nameRaw = 'Terminal 7';
        else if (text.includes('TERMINAL 8')) nameRaw = 'Terminal 8';
        
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

    console.log(`[JFK Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[JFK Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[JFK Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[JFK Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeJFK().then(() => process.exit(0));
}

module.exports = { scrapeJFK };
