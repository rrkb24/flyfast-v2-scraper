const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

// JFK has 5 active terminals, each with its own page
const TERMINALS = [
  { name: 'Terminal 1', url: 'https://www.jfkairport.com/explore-jfk/terminals/terminal-1' },
  { name: 'Terminal 4', url: 'https://www.jfkairport.com/explore-jfk/terminals/terminal-4' },
  { name: 'Terminal 5', url: 'https://www.jfkairport.com/explore-jfk/terminals/terminal-5' },
  { name: 'Terminal 7', url: 'https://www.jfkairport.com/explore-jfk/terminals/terminal-7' },
  { name: 'Terminal 8', url: 'https://www.jfkairport.com/explore-jfk/terminals/terminal-8' },
];

async function scrapeJFK() {
  const airportCode = 'JFK';
  
  console.log(`[JFK Adapter] Launching Stealth Browser for ${TERMINALS.length} terminals...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const allCheckpoints = [];
  
  try {
    const page = await browser.newPage();
    
    for (const terminal of TERMINALS) {
      console.log(`[JFK Adapter] Loading ${terminal.name}: ${terminal.url}`);
      
      await page.goto(terminal.url, { waitUntil: 'networkidle2', timeout: 45000 });
      
      const checkpoints = await page.evaluate((termName) => {
        const data = [];
        
        // JFK uses TerminalWaitTimes component with consistent structure:
        // Each wait time item has a label <p> ("General TSA:") and a value <p> ("14 min")
        const waitTimeItems = document.querySelectorAll('[class*="TerminalWaitTimes_waitTime"]');
        
        waitTimeItems.forEach(item => {
          const paragraphs = item.querySelectorAll('p');
          if (paragraphs.length < 2) return;
          
          const label = paragraphs[0].innerText.trim().replace(/:$/, '');
          const valueText = paragraphs[1].innerText.trim().toLowerCase();
          
          // Skip if no valid time
          if (valueText.includes('closed') || valueText.includes('n/a')) {
            data.push({ name: `${termName} - ${label}`, waitMinutes: null, status: 'Closed' });
            return;
          }
          
          // Parse "14 min" → 14
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
      
      console.log(`[JFK Adapter] ${terminal.name}: ${checkpoints.length} entries`);
      allCheckpoints.push(...checkpoints);
    }

    console.log(`[JFK Adapter] Extracted ${allCheckpoints.length} total checkpoints:`);
    console.log(allCheckpoints);

    if (allCheckpoints.length > 0) {
      await syncAirportData(airportCode, allCheckpoints);
      console.log(`[JFK Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[JFK Adapter] No checkpoints found across any terminal.");
    }
    
  } catch (err) {
    console.error(`[JFK Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeJFK().then(() => process.exit(0));
}

module.exports = { scrapeJFK };
