const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDEN() {
  const airportCode = 'DEN';
  const sourceUrl = 'https://www.flydenver.com/security/';

  console.log(`[DEN Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[DEN Adapter] Page loaded. Waiting for dynamic content...`);

    // Explicitly wait for the .tsa container to appear, as DEN loads data dynamically
    try {
      await page.waitForSelector('.tsa', { timeout: 15000 });
    } catch (e) {
      console.warn(`[DEN Adapter] Warning: Timed out waiting for .tsa container. Data may be unavailable or blocked.`);
    }

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // FlyDenver uses a container .tsa for each security block
      const containers = document.querySelectorAll('.tsa');
      
      containers.forEach(container => {
        const nameEl = container.querySelector('.name');
        if (!nameEl) return;
        
        const rawName = nameEl.innerText.trim().toUpperCase();
        let name = '';
        
        if (rawName.includes('EAST')) name = 'East Security';
        else if (rawName.includes('WEST')) name = 'West Security';
        
        if (!name) return;

        // Iterate through the wait types within this checkpoint
        const waitItems = container.querySelectorAll('.wait-time-main, .wait');
        
        waitItems.forEach(item => {
          const typeEl = item.querySelector('.wait-type');
          const numEl = item.querySelector('.wait-num');
          
          if (!typeEl || !numEl) return;

          const typeText = typeEl.innerText.trim().toUpperCase();
          const numText = numEl.innerText.trim().toUpperCase();
          
          let laneType = '';
          if (typeText.includes('STANDARD') || typeText.includes('GENERAL')) {
            laneType = 'Standard';
          } else if (typeText.includes('PRECHECK') || typeText.includes('PRE')) {
            laneType = 'PreCheck';
          }
          
          if (!laneType) return;

          let waitMinutes = null;
          let status = 'Active';

          if (numText.includes('CLOSED') || numText === 'X') {
            status = 'Closed';
          } else {
            const match = numText.match(/(\d+)/);
            if (match) waitMinutes = parseInt(match[1], 10);
            else if (numText.includes('<')) waitMinutes = 0;
            else status = 'Closed';
          }

          data.push({
            name: `${name} - ${laneType}`,
            waitMinutes,
            status
          });
        });
      });
      
      return data;
    });

    console.log(`[DEN Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DEN Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DEN Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[DEN Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDEN().then(() => process.exit(0));
}

module.exports = { scrapeDEN };
