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
    
    // CLT may load wait times dynamically
    await new Promise(r => setTimeout(r, 3000));
    
    console.log(`[CLT Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // Strategy 1: Look for structured wait time elements
      const waitEls = document.querySelectorAll('[class*="wait-time"], [class*="waitTime"], [class*="WaitTime"], [class*="checkpoint"]');
      
      waitEls.forEach(el => {
        const nameEl = el.querySelector('h2, h3, h4, [class*="name"], [class*="title"]');
        const timeEl = el.querySelector('[class*="time"], [class*="minute"]');
        
        if (nameEl && timeEl) {
          const name = nameEl.innerText.trim();
          const timeText = timeEl.innerText.trim();
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
      
      // Strategy 2: Look for table-based layout
      if (data.length === 0) {
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
          const rows = table.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td, th');
            if (cells.length >= 2) {
              const name = cells[0].innerText.trim();
              const timeText = cells[cells.length - 1].innerText.trim();
              
              if (name && timeText.match(/\d+/)) {
                const numbers = timeText.match(/(\d+)/g);
                if (numbers) {
                  data.push({
                    name,
                    waitMinutes: Math.max(...numbers.map(n => parseInt(n, 10))),
                    status: 'Active'
                  });
                }
              }
            }
          });
        });
      }
      
      // Strategy 3: Raw text pattern matching
      if (data.length === 0) {
        const body = document.body.innerText.replace(/\s+/g, ' ');
        const patterns = [
          /(?:Checkpoint|Gate|Terminal)\s+([A-Z0-9\s]+?)[\s:]+(\d+)\s*(?:min|minute)/gi,
        ];
        
        for (const regex of patterns) {
          let match;
          while ((match = regex.exec(body)) !== null) {
            data.push({
              name: match[1].trim(),
              waitMinutes: parseInt(match[2], 10),
              status: 'Active'
            });
          }
        }
      }
      
      return data;
    });

    console.log(`[CLT Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[CLT Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[CLT Adapter] No checkpoints found. Page structure may have changed.");
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
