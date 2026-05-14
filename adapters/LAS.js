const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeLAS() {
  const airportCode = 'LAS';
  const sourceUrl = 'https://www.harryreidairport.com/security-wait-times';

  console.log(`[LAS Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[LAS Adapter] Page loaded. Extracting data...`);
    
    // Use standard setTimeout instead of deprecated page.waitForTimeout
    await new Promise(r => setTimeout(r, 4000));

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const rows = document.querySelectorAll('tr, .row, .checkpoint-row, .wait-time-row, [class*="wait-time"]');
      
      rows.forEach(row => {
        const text = row.innerText.trim().toUpperCase();
        
        // LAS usually lists Terminal 1, Terminal 3, A/B/C/D Gates
        if (!text.includes('TERMINAL') && !text.includes('GATES') && !text.includes('CHECKPOINT')) return;

        let nameRaw = '';
        if (text.includes('TERMINAL 1')) nameRaw = 'Terminal 1';
        else if (text.includes('TERMINAL 3')) nameRaw = 'Terminal 3';
        else if (text.includes('A/B GATES')) nameRaw = 'A/B Gates';
        else if (text.includes('C GATES')) nameRaw = 'C Gates';
        else if (text.includes('D GATES')) nameRaw = 'D Gates';
        else if (text.includes('CHECKPOINT')) nameRaw = text.split('\n')[0];
        
        if (!nameRaw) return;

        let laneType = '';
        if (text.includes('PRECHECK') || text.includes('PRE')) {
          laneType = 'TSA PreCheck';
        } else if (text.includes('GENERAL') || text.includes('STANDARD')) {
          laneType = 'Standard';
        } else {
          laneType = 'Standard'; // default fallback
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

    console.log(`[LAS Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[LAS Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[LAS Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[LAS Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeLAS().then(() => process.exit(0));
}

module.exports = { scrapeLAS };
