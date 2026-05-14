const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeLAX() {
  const airportCode = 'LAX';
  const sourceUrl = 'https://www.flylax.com/wait-times';

  console.log(`[LAX Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[LAX Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const rows = document.querySelectorAll('table.wait-time-table tbody tr');
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) return;

        const terminalRaw = cells[0].innerText.trim();
        const typeRaw = cells[1].innerText.trim().toUpperCase();
        const waitRaw = cells[2].innerText.trim().toUpperCase();
        
        if (!terminalRaw) return;

        let laneType = '';
        if (typeRaw.includes('GENERAL') || typeRaw.includes('STANDARD')) {
          laneType = 'Standard';
        } else if (typeRaw.includes('PRECHECK') || typeRaw.includes('PRE')) {
          laneType = 'TSA PreCheck';
        } else if (typeRaw.includes('PRIORITY')) {
          laneType = 'Priority';
        }

        if (!laneType) return;

        const name = `${terminalRaw} - ${laneType}`;
        
        if (parsedKeys.has(name)) return;
        parsedKeys.add(name);

        let waitMinutes = null;
        let status = 'Active';

        if (waitRaw.includes('CLOSED') || waitRaw === 'X') {
          status = 'Closed';
        } else {
          const match = waitRaw.match(/(\d+)/);
          if (match) waitMinutes = parseInt(match[1], 10);
          else if (waitRaw.includes('<')) waitMinutes = 0;
          else status = 'Closed';
        }

        data.push({
          name,
          waitMinutes,
          status
        });
      });

      return data;
    });

    console.log(`[LAX Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[LAX Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[LAX Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[LAX Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeLAX().then(() => process.exit(0));
}

module.exports = { scrapeLAX };
