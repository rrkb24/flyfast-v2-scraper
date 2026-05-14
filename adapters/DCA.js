const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDCA() {
  const airportCode = 'DCA';
  const sourceUrl = 'https://www.flyreagan.com/travel-information/security-information';

  console.log(`[DCA Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[DCA Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      const rows = document.querySelectorAll('.resp-table-row');
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('.table-body-cell');
        if (cells.length >= 2) {
          const rawName = cells[0].innerText.trim().toUpperCase();
          let name = '';
          
          if (rawName.includes('TERMINAL 1')) {
            name = 'Terminal 1';
          } else if (rawName.includes('TERMINAL 2 SOUTH')) {
            name = 'Terminal 2 South';
          } else if (rawName.includes('TERMINAL 2 NORTH')) {
            name = 'Terminal 2 North';
          }
          
          if (!name) return; // Not a recognized checkpoint row

          // General Wait Time (Column 1)
          const generalText = cells[1].innerText.trim().toUpperCase();
          let generalWait = null;
          let generalStatus = 'Active';
          
          if (generalText.includes('CLOSED') || generalText === 'X') {
            generalStatus = 'Closed';
          } else {
            const match = generalText.match(/(\d+)/);
            if (match) generalWait = parseInt(match[1], 10);
            else if (generalText.includes('<')) generalWait = 0;
            else generalStatus = 'Closed';
          }

          data.push({
            name: `${name} - Standard`,
            waitMinutes: generalWait,
            status: generalStatus
          });

          // TSA PreCheck Wait Time (Column 2) - Only exists for Terminal 2
          if (cells.length >= 3 && name !== 'Terminal 1') {
            const preText = cells[2].innerText.trim().toUpperCase();
            let preWait = null;
            let preStatus = 'Active';
            
            if (preText.includes('CLOSED') || preText === 'X') {
              preStatus = 'Closed';
            } else {
              const match = preText.match(/(\d+)/);
              if (match) preWait = parseInt(match[1], 10);
              else if (preText.includes('<')) preWait = 0;
              else preStatus = 'Closed';
            }

            // The competitor site seems to only track PreCheck for Terminal 2 North/South
            data.push({
              name: `${name} - TSA PreCheck`,
              waitMinutes: preWait,
              status: preStatus
            });
          }
        }
      });
      
      return data;
    });

    console.log(`[DCA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DCA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DCA Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[DCA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDCA().then(() => process.exit(0));
}

module.exports = { scrapeDCA };
