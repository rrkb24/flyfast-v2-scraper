const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeCVG() {
  const airportCode = 'CVG';
  const sourceUrl = 'https://www.cvgairport.com/security/';

  console.log(`[CVG Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[CVG Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // CVG separates General and TSA Pre into distinct blocks
      const containers = document.querySelectorAll('div[class*="flexRowCenter"]');
      
      let standardWait = null;
      let standardStatus = 'Closed';
      
      let precheckWait = null;
      let precheckStatus = 'Closed';
      
      containers.forEach(container => {
        const textContent = container.innerText.trim().toUpperCase();
        
        // Find the wait time block
        const waitBlock = container.querySelector('span[class*="StyledInfoBlock"]');
        let waitMinutes = null;
        let stat = 'Active';
        
        if (waitBlock) {
          const blockText = waitBlock.innerText.trim().toUpperCase();
          if (blockText.includes('CLOSED') || blockText === 'X') {
            stat = 'Closed';
          } else {
            const match = blockText.match(/(\d+)/);
            if (match) waitMinutes = parseInt(match[1], 10);
          }
        }
        
        // Check if this container is for TSA Pre or General
        const img = container.querySelector('img');
        const hasPrecheckImg = img && img.alt && img.alt.toUpperCase().includes('TSA PRE');
        
        if (hasPrecheckImg || textContent.includes('TSA PRE')) {
          precheckWait = waitMinutes;
          precheckStatus = stat;
        } else if (textContent.includes('GENERAL') || textContent.includes('STANDARD')) {
          standardWait = waitMinutes;
          standardStatus = stat;
        }
      });
      
      if (standardWait !== null || standardStatus === 'Closed') {
        data.push({
          name: 'CVG Checkpoint – Standard',
          waitMinutes: standardWait,
          status: standardStatus
        });
      }
      
      if (precheckWait !== null || precheckStatus === 'Closed') {
        data.push({
          name: 'CVG Checkpoint – TSA Pre√',
          waitMinutes: precheckWait,
          status: precheckStatus
        });
      }
      
      return data;
    });

    console.log(`[CVG Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[CVG Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[CVG Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[CVG Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeCVG().then(() => process.exit(0));
}

module.exports = { scrapeCVG };
