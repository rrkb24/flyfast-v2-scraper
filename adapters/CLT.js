const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeCLT() {
  const airportCode = 'CLT';
  const sourceUrl = 'https://www.cltairport.com/airport-info/security/';

  console.log(`[CLT Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[CLT Adapter] Page loaded. Extracting Standard lane data...`);

    // Helper function to extract wait times from the current view
    const extractCurrentView = async (laneType) => {
      return await page.evaluate((type) => {
        const results = [];
        const cards = document.querySelectorAll('.css-scy3i, [class*="css-"]');
        
        cards.forEach(card => {
          // Identify cards that look like checkpoints
          const headers = card.querySelectorAll('h3');
          if (headers.length >= 2) {
            const cpNameText = headers[0].innerText.trim();
            const timeText = headers[1].innerText.trim().toUpperCase();
            
            if (cpNameText.toLowerCase().includes('checkpoint')) {
              let name = cpNameText;
              // Format exactly like competitor: 'Checkpoint 1 – Standard'
              if (name === 'Checkpoint A') name = 'Checkpoint 1';
              if (name === 'Checkpoint E') name = 'Checkpoint 3';
              
              // Normalize checkpoint names if needed to match 1, 2, 3
              if (cpNameText.includes('1')) name = 'Checkpoint 1';
              if (cpNameText.includes('2')) name = 'Checkpoint 2';
              if (cpNameText.includes('3')) name = 'Checkpoint 3';

              let waitMinutes = null;
              let status = 'Active';

              if (timeText === 'X' || timeText.includes('CLOSED')) {
                status = 'Closed';
              } else {
                const match = timeText.match(/(\d+)/);
                if (match) {
                  waitMinutes = parseInt(match[1], 10);
                } else if (timeText.includes('<')) {
                  waitMinutes = 0; // Less than 10 mins etc.
                } else {
                  status = 'Closed';
                }
              }

              results.push({
                name: `${name} – ${type}`,
                waitMinutes,
                status
              });
            }
          }
        });
        
        return results;
      }, laneType);
    };

    // 1. Extract Standard lanes (Default view: "All checkpoints")
    const standardData = await extractCurrentView('Standard');

    // 2. Click the TSA PreCheck button
    console.log(`[CLT Adapter] Switching to TSA PreCheck view...`);
    const precheckClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const precheckBtn = buttons.find(b => b.innerText.toUpperCase().includes('TSA PRE'));
      if (precheckBtn) {
        precheckBtn.click();
        return true;
      }
      return false;
    });

    const checkpointsData = [...standardData];

    if (precheckClicked) {
      // Wait for React to re-render the list
      await new Promise(r => setTimeout(r, 1500));
      
      const precheckData = await extractCurrentView('TSA Pre√');
      
      // CLT Checkpoint 2 is the primary TSA PreCheck lane
      precheckData.forEach(cp => {
        if (!checkpointsData.find(existing => existing.name === cp.name)) {
          checkpointsData.push(cp);
        }
      });
    }

    console.log(`[CLT Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[CLT Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[CLT Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[CLT Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeCLT().then(() => process.exit(0));
}

module.exports = { scrapeCLT };
