const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeMIA() {
  const airportCode = 'MIA';
  const sourceUrl = 'https://www.miami-airport.com/tsa-waittimes.asp';
  
  console.log(`[MIA Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // MIA uses an ag-grid table that loads dynamically
    await page.waitForSelector('.ag-body-viewport, table, [class*="wait"]', { timeout: 15000 }).catch(() => {
      console.warn('[MIA Adapter] Grid/table not found within timeout, proceeding anyway.');
    });
    
    // Extra wait for dynamic data
    await new Promise(r => setTimeout(r, 3000));
    
    console.log(`[MIA Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // Strategy 1: ag-grid rows
      const agRows = document.querySelectorAll('.ag-row');
      
      agRows.forEach(row => {
        const cells = row.querySelectorAll('.ag-cell');
        if (cells.length >= 2) {
          const checkpoint = cells[0].innerText.trim();
          const waitText = cells[cells.length - 1].innerText.trim();
          
          if (!checkpoint || !waitText) return;
          
          const numbers = waitText.match(/(\d+)/g);
          if (numbers) {
            data.push({
              name: checkpoint,
              waitMinutes: Math.max(...numbers.map(n => parseInt(n, 10))),
              status: 'Active'
            });
          }
        }
      });
      
      // Strategy 2: Standard HTML table fallback
      if (data.length === 0) {
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
          const rows = table.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              const name = cells[0].innerText.trim();
              const timeText = cells[cells.length - 1].innerText.trim();
              
              if (!name || !timeText.match(/\d/)) return;
              // Skip header rows
              if (name.toLowerCase().includes('checkpoint') && name.toLowerCase().includes('time')) return;
              
              const numbers = timeText.match(/(\d+)/g);
              if (numbers) {
                data.push({
                  name,
                  waitMinutes: Math.max(...numbers.map(n => parseInt(n, 10))),
                  status: 'Active'
                });
              }
            }
          });
        });
      }
      
      // Strategy 3: Raw text pattern matching
      if (data.length === 0) {
        const body = document.body.innerText;
        const regex = /(?:Concourse|Terminal|Checkpoint|Gate)\s+([A-Z0-9]+)[^0-9]*?(\d+)\s*(?:min|minute)/gi;
        let match;
        while ((match = regex.exec(body)) !== null) {
          data.push({
            name: `Concourse ${match[1]}`,
            waitMinutes: parseInt(match[2], 10),
            status: 'Active'
          });
        }
      }
      
      return data;
    });

    console.log(`[MIA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[MIA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[MIA Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[MIA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeMIA().then(() => process.exit(0));
}

module.exports = { scrapeMIA };
