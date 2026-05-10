const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

// EWR has 3 terminals, same Port Authority DOM structure as JFK
const TERMINALS = [
  { name: 'Terminal A', url: 'https://www.newarkairport.com/explore-ewr/terminals/terminal-a' },
  { name: 'Terminal B', url: 'https://www.newarkairport.com/explore-ewr/terminals/terminal-b' },
  { name: 'Terminal C', url: 'https://www.newarkairport.com/explore-ewr/terminals/terminal-c' },
];

async function scrapeEWR() {
  const airportCode = 'EWR';
  
  console.log(`[EWR Adapter] Launching Stealth Browser for ${TERMINALS.length} terminals...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const allCheckpoints = [];
  
  try {
    const page = await browser.newPage();
    
    for (const terminal of TERMINALS) {
      console.log(`[EWR Adapter] Loading ${terminal.name}: ${terminal.url}`);
      
      await page.goto(terminal.url, { waitUntil: 'networkidle2', timeout: 45000 });
      
      const checkpoints = await page.evaluate((termName) => {
        const data = [];
        
        // Same Port Authority TerminalWaitTimes component as JFK
        const waitTimeItems = document.querySelectorAll('[class*="TerminalWaitTimes_waitTime"]');
        
        waitTimeItems.forEach(item => {
          const paragraphs = item.querySelectorAll('p');
          if (paragraphs.length < 2) return;
          
          const label = paragraphs[0].innerText.trim().replace(/:$/, '');
          const valueText = paragraphs[1].innerText.trim().toLowerCase();
          
          if (valueText.includes('closed') || valueText.includes('n/a')) {
            data.push({ name: `${termName} - ${label}`, waitMinutes: null, status: 'Closed' });
            return;
          }
          
          const match = valueText.match(/(\d+)/);
          const waitMinutes = match ? parseInt(match[1], 10) : 0;
          
          data.push({
            name: `${termName} - ${label}`,
            waitMinutes,
            status: 'Active'
          });
        });
        
        return data;
      }, terminal.name);
      
      console.log(`[EWR Adapter] ${terminal.name}: ${checkpoints.length} entries`);
      allCheckpoints.push(...checkpoints);
    }

    console.log(`[EWR Adapter] Extracted ${allCheckpoints.length} total checkpoints:`);
    console.log(allCheckpoints);

    if (allCheckpoints.length > 0) {
      await syncAirportData(airportCode, allCheckpoints);
      console.log(`[EWR Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[EWR Adapter] No checkpoints found across any terminal.");
    }
    
  } catch (err) {
    console.error(`[EWR Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeEWR().then(() => process.exit(0));
}

module.exports = { scrapeEWR };
