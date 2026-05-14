const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeMCO() {
  const airportCode = 'MCO';
  const sourceUrl = 'https://flymco.com/security/';

  console.log(`[MCO Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log(`[MCO Adapter] Page loaded. Extracting data...`);
    
    await new Promise(r => setTimeout(r, 4000));

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const containers = document.querySelectorAll('[class*="SecurityWaitTimesCard-CheckpointInfoContainer"]');
      
      containers.forEach(container => {
        const titleEl = container.querySelector('[class*="SWTCardTitle"]');
        if (!titleEl) return;
        const text = titleEl.innerText.trim().toUpperCase();
        
        let nameRaw = '';
        if (text.includes('GATES 1 - 59') || text.includes('GATES 1-59')) nameRaw = 'Terminal A/B - Gates 1-59';
        else if (text.includes('GATES 70 - 129') || text.includes('GATES 70-129')) nameRaw = 'Terminal A/B - Gates 70-129';
        else if (text.includes('C230') || text.includes('TERMINAL C')) nameRaw = 'Terminal C';
        else return;

        const lanes = container.querySelectorAll('[class*="SecurityWaitTimeLaneInfo-TimeContainer"]');
        
        lanes.forEach(lane => {
          const typeEl = lane.querySelector('[class*="LaneTypeTitle"]');
          const timeEl = lane.querySelector('[class*="TimeRange"]');
          
          if (!typeEl || !timeEl) return;
          
          const laneText = typeEl.innerText.trim().toUpperCase();
          const timeText = timeEl.innerText.trim().toUpperCase();
          
          let laneType = 'Standard';
          if (laneText.includes('PRECHECK') || laneText.includes('PRE')) {
            laneType = 'TSA PreCheck';
          }

          const name = `${nameRaw} - ${laneType}`;
          
          if (parsedKeys.has(name)) return;

          let waitMinutes = null;
          let status = 'Active';

          if (timeText.includes('CLOSED') || timeText.includes('X')) {
            status = 'Closed';
          } else {
            // Extract the highest number from ranges like "19 - 22 min"
            const nums = timeText.match(/\d+/g);
            if (nums && nums.length > 0) {
              waitMinutes = parseInt(nums[nums.length - 1], 10);
            } else {
              status = 'Closed';
            }
          }

          parsedKeys.add(name);
          data.push({
            name,
            waitMinutes,
            status
          });
        });
      });

      return data;
    });

    console.log(`[MCO Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[MCO Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[MCO Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[MCO Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeMCO().then(() => process.exit(0));
}

module.exports = { scrapeMCO };
