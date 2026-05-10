const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeLGA() {
  const airportCode = 'LGA';
  const sourceUrl = 'https://www.laguardiaairport.com';
  
  console.log(`[LGA Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    // Wait for the security table to be present
    await page.waitForSelector('.security-table', { timeout: 15000 }).catch(() => {
      console.warn('[LGA Adapter] .security-table not found within timeout, proceeding anyway.');
    });
    
    console.log(`[LGA Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const table = document.querySelector('.security-table');
      if (!table) return data;
      
      const rows = table.querySelectorAll('tr');
      
      rows.forEach(row => {
        // Terminal letter is in .security-first-col
        const termCol = row.querySelector('.security-first-col');
        // Wait time data is in .security-next-two-cols cells
        const dataCols = row.querySelectorAll('.security-next-two-cols');
        
        if (!termCol || dataCols.length < 1) return;
        
        const termText = termCol.innerText.trim();
        // Extract terminal letter (e.g., "B" or "C")
        const termMatch = termText.match(/[A-Z]/);
        if (!termMatch) return;
        const termName = `Terminal ${termMatch[0]}`;
        
        dataCols.forEach(col => {
          const text = col.innerText.trim();
          
          // Parse entries like "General Line: No Wait" or "General Line: 5 min"
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          
          lines.forEach(line => {
            let label = '';
            let valueText = '';
            
            if (line.toLowerCase().includes('general')) {
              label = 'General Line';
              valueText = line.replace(/general\s*line:?\s*/i, '').trim().toLowerCase();
            } else if (line.toLowerCase().includes('pre')) {
              label = 'TSA PreCheck';
              valueText = line.replace(/tsa\s*pre.*?line:?\s*/i, '').trim().toLowerCase();
            } else {
              return;
            }
            
            let waitMinutes = 0;
            if (valueText.includes('no wait')) {
              waitMinutes = 0;
            } else if (valueText.includes('closed')) {
              data.push({ name: `${termName} - ${label}`, waitMinutes: null, status: 'Closed' });
              return;
            } else {
              const match = valueText.match(/(\d+)/);
              waitMinutes = match ? parseInt(match[1], 10) : 0;
            }
            
            data.push({
              name: `${termName} - ${label}`,
              waitMinutes,
              status: 'Active'
            });
          });
        });
      });
      
      return data;
    });

    console.log(`[LGA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[LGA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[LGA Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[LGA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeLGA().then(() => process.exit(0));
}

module.exports = { scrapeLGA };
