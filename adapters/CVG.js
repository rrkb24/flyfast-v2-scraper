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
    
    // CVG uses SynectIQ-powered widget that loads via JS
    await new Promise(r => setTimeout(r, 5000));
    
    console.log(`[CVG Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // CVG uses SynectIQ iframe or embedded widget
      // Try iframe first
      const iframes = document.querySelectorAll('iframe');
      // If there's no iframe, the data might be directly in the page
      
      // Strategy 1: Look for specific CVG wait time elements
      const waitCards = document.querySelectorAll('[class*="wait"], [class*="Wait"], [class*="security"], [class*="Security"], [class*="checkpoint"]');
      
      waitCards.forEach(card => {
        const text = card.innerText.trim();
        if (text.length > 500 || text.length < 3) return;
        
        // Look for checkpoint name + minutes pattern
        const match = text.match(/((?:Checkpoint|Gate|Terminal|Concourse)\s+[A-Z0-9\s]+?)\s*[:\-–]?\s*(\d+)\s*(?:min|minute)/i);
        if (match) {
          data.push({
            name: match[1].trim(),
            waitMinutes: parseInt(match[2], 10),
            status: 'Active'
          });
        }
      });
      
      // Strategy 2: Table extraction
      if (data.length === 0) {
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
          const rows = table.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              const name = cells[0].innerText.trim();
              const timeText = cells[cells.length - 1].innerText.trim();
              const numbers = timeText.match(/(\d+)/g);
              if (name && numbers) {
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
      
      // Strategy 3: Raw body text
      if (data.length === 0) {
        const body = document.body.innerText;
        const regex = /((?:Main|North|South|East|West|Central|A|B|C|D)\s*(?:Checkpoint|Security)?)\s*[:\-–]?\s*(\d+)\s*(?:min|minute)/gi;
        let match;
        while ((match = regex.exec(body)) !== null) {
          data.push({
            name: match[1].trim(),
            waitMinutes: parseInt(match[2], 10),
            status: 'Active'
          });
        }
      }
      
      return data;
    });

    console.log(`[CVG Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[CVG Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[CVG Adapter] No checkpoints found. Page structure may have changed.");
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
