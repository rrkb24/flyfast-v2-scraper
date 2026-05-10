const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeDEN() {
  const airportCode = 'DEN';
  const sourceUrl = 'https://www.flydenver.com/security/';
  
  console.log(`[DEN Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[DEN Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // DEN uses .wp-block-column cards with .wait-num elements
      const columns = document.querySelectorAll('.wp-block-column');
      
      columns.forEach(col => {
        // Get checkpoint name from header (h2 or h3)
        const header = col.querySelector('h2, h3');
        if (!header) return;
        
        const checkpointName = header.innerText.trim();
        // Only process columns that look like security checkpoints
        if (!checkpointName.toLowerCase().includes('security')) return;
        
        // Find all wait-num elements within this column
        const waitNums = col.querySelectorAll('.wait-num');
        // Find labels (Standard / PreCheck) — they appear as <p> tags before .wait-num
        const paragraphs = col.querySelectorAll('p');
        
        let labels = [];
        paragraphs.forEach(p => {
          const text = p.innerText.trim().toLowerCase();
          if (text.includes('standard') || text.includes('precheck') || text.includes('pre-check') || text.includes('pre✓')) {
            labels.push(p.innerText.trim());
          }
        });
        
        waitNums.forEach((wn, i) => {
          const waitText = wn.innerText.trim();
          // Parse ranges like "1-5" → take the higher number, or single "4" → 4
          const numbers = waitText.match(/(\d+)/g);
          if (!numbers) return;
          
          // Use the max of the range for conservative estimate
          const waitMinutes = Math.max(...numbers.map(n => parseInt(n, 10)));
          const label = labels[i] || (i === 0 ? 'Standard' : 'PreCheck');
          
          data.push({
            name: `${checkpointName} - ${label}`,
            waitMinutes,
            status: 'Active'
          });
        });
      });
      
      return data;
    });

    console.log(`[DEN Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[DEN Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[DEN Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[DEN Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeDEN().then(() => process.exit(0));
}

module.exports = { scrapeDEN };
