const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeCLE() {
  const airportCode = 'CLE';
  const sourceUrl = 'https://www.clevelandairport.com/airport/tsa-security';

  console.log(`[CLE Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[CLE Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // CLE specific selectors
      const checkpointNodes = document.querySelectorAll('.wait-times-status-wrapper .checkpoint');

      checkpointNodes.forEach(node => {
        const labelEl = node.querySelector('.checkpoint-label');
        const timeEl = node.querySelector('.checkpoint-time');
        
        if (labelEl && timeEl) {
          const rawName = labelEl.innerText.trim();
          let name = rawName;
          
          // Normalize to competitor names
          if (rawName.toUpperCase().includes('NORTH')) name = 'North Checkpoint';
          else if (rawName.toUpperCase().includes('CENTRAL')) name = 'Central Checkpoint';
          else if (rawName.toUpperCase().includes('SOUTH')) name = 'South Checkpoint';

          const timeText = timeEl.innerText.trim().toUpperCase();
          
          let waitMinutes = null;
          let status = 'Active';

          if (timeText.includes('CLOSED') || timeText === 'X') {
            status = 'Closed';
          } else {
            const match = timeText.match(/(\d+)/);
            if (match) {
              waitMinutes = parseInt(match[1], 10);
            } else {
              // No numbers, assume closed
              status = 'Closed';
            }
          }

          // Check if parent has a specific closed class just in case
          if (node.classList.contains('closed-checkpoint')) {
            status = 'Closed';
            waitMinutes = null;
          }

          data.push({
            name,
            waitMinutes,
            status
          });
        }
      });
      
      return data;
    });

    console.log(`[CLE Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[CLE Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[CLE Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[CLE Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeCLE().then(() => process.exit(0));
}

module.exports = { scrapeCLE };
