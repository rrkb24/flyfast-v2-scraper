const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDFW() {
  const airportCode = 'DFW';
  const sourceUrl = 'https://www.dfwairport.com/security/';

  console.log(`[DFW Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[DFW Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(async () => {
      const data = [];
      const parsedKeys = new Set();
      
      // Helper to extract data from current view
      const extractView = () => {
        // Find all elements that look like a map checkpoint pin
        const pins = document.querySelectorAll('[aria-label*="checkpoint"]');
        pins.forEach(pin => {
          const ariaText = pin.getAttribute('aria-label');
          if (!ariaText) return;
          
          // Pattern: "A21 checkpoint - General - current wait time 2 minutes"
          // Or: "A21 checkpoint - General - Closed"
          const parts = ariaText.split('-');
          if (parts.length >= 3) {
            const cpRaw = parts[0].replace(/checkpoint/i, '').trim(); // e.g., "A21"
            const laneRaw = parts[1].trim(); // e.g., "General", "TSA Pre√", "Priority"
            const waitRaw = parts[2].trim().toLowerCase(); // e.g., "current wait time 2 minutes"
            
            // Normalize lane types
            let laneType = '';
            if (laneRaw.toUpperCase().includes('GENERAL')) laneType = 'General';
            else if (laneRaw.toUpperCase().includes('PRE')) laneType = 'TSA PreCheck';
            else if (laneRaw.toUpperCase().includes('PRIORITY')) laneType = 'Priority';
            
            if (!laneType) return; 

            const name = `${cpRaw.toUpperCase()} - ${laneType}`;
            
            // Prevent duplicates since the DOM might have multiple elements
            if (parsedKeys.has(name)) return;
            parsedKeys.add(name);

            let waitMinutes = null;
            let status = 'Active';

            if (waitRaw.includes('closed') || waitRaw === 'x') {
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
          }
        });
      };

      // Wait for tabs to render
      await new Promise(r => setTimeout(r, 2000));

      // 1. Extract default view (usually General)
      extractView();

      // 2. Click TSA PreCheck tab to load those times
      const tabs = Array.from(document.querySelectorAll('.MuiTab-wrapper, [role="tab"]'));
      let precheckTab = tabs.find(t => t.innerText && t.innerText.includes('Pre'));
      
      if (precheckTab) {
        precheckTab.click();
        // Pause to let React/DOM update
        await new Promise(r => setTimeout(r, 1500));
        extractView();
      }

      // 3. Click Priority tab
      let priorityTab = tabs.find(t => t.innerText && t.innerText.includes('Priority'));
      if (priorityTab) {
        priorityTab.click();
        await new Promise(r => setTimeout(r, 1500));
        extractView();
      }

      // 4. Click General tab again just to be safe if default was something else
      let generalTab = tabs.find(t => t.innerText && t.innerText.includes('General'));
      if (generalTab) {
        generalTab.click();
        await new Promise(r => setTimeout(r, 1500));
        extractView();
      }

      return data;
    });

    console.log(`[DFW Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DFW Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DFW Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[DFW Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDFW().then(() => process.exit(0));
}

module.exports = { scrapeDFW };
