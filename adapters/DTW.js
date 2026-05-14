const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDTW() {
  const airportCode = 'DTW';
  const sourceUrl = 'https://www.metroairport.com/';

  console.log(`[DTW Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[DTW Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // DTW has Evans and McNamara terminals. The times are shown in simplified widgets.
      const evansBlock = document.querySelector('.number-block__evans');
      const mcnamaraBlock = document.querySelector('.number-block__mcnamara');
      
      const processBlock = (block, name) => {
        if (!block) return;
        const figureEl = block.querySelector('.number-block__figure');
        if (!figureEl) return;
        
        const text = figureEl.innerText.trim().toUpperCase();
        let waitMinutes = null;
        let status = 'Active';

        if (text.includes('CLOSED') || text === 'X') {
          status = 'Closed';
        } else {
          const match = text.match(/(\d+)/);
          if (match) waitMinutes = parseInt(match[1], 10);
          else if (text.includes('<')) waitMinutes = 0;
          else status = 'Closed';
        }
        
        // DTW publishes a single wait time per terminal
        data.push({
          name: `${name} - General`,
          waitMinutes,
          status
        });
      };

      processBlock(evansBlock, 'Evans Terminal');
      processBlock(mcnamaraBlock, 'McNamara Terminal');
      
      return data;
    });

    console.log(`[DTW Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DTW Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DTW Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[DTW Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDTW().then(() => process.exit(0));
}

module.exports = { scrapeDTW };
