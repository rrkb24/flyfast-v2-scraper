const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapePHL() {
  const airportCode = 'PHL';
  const sourceUrl = 'https://www.phl.org/flights/security-information/checkpoint-hours';

  console.log(`[PHL Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Block tracking/media
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type) || req.url().includes('google-analytics') || req.url().includes('googletag')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    try {
      await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      console.log(`[PHL Adapter] Page goto timed out, proceeding...`);
    }

    console.log(`[PHL Adapter] Page loaded. Extracting data...`);
    // Wait slightly longer in case they make an external API request
    await new Promise(r => setTimeout(r, 6000)); 

    const fullText = await page.evaluate(() => document.body.innerText);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('Terminal A-West') || line.includes('Terminal A-East') || line.includes('Terminal B') || line.includes('Terminal C') || line.includes('Terminal D/E') || line.includes('Terminal F')) {
          let terminalName = line.replace('TSA Pre✓', '').replace('Only', '').trim();
          
          let waitMinutes = null;
          let status = 'Active';
          let foundTime = false;
          let isPrecheck = line.includes('Pre✓') || line.includes('Terminal C'); // Terminal C is precheck only
          
          // Look ahead for "Wait Time"
          for (let j = 1; j <= 6; j++) {
            if (i + j < lines.length) {
              const nextLine = lines[i + j];
              
              if (nextLine.includes('Wait Time')) {
                const match = nextLine.match(/(\d+)\s*min/i);
                if (match) {
                  waitMinutes = parseInt(match[1], 10);
                } else if (nextLine.includes('- -')) {
                   // Means data unavailable or closed
                   status = 'Closed';
                }
                
                foundTime = true;
                
                // If it's a specific precheck wait time line
                if (nextLine.includes('Pre✓ Wait Time')) {
                   isPrecheck = true;
                }
                
                let laneType = isPrecheck ? 'TSA PreCheck' : 'Standard';
                let cleanName = `${terminalName} - ${laneType}`;
                
                if (!parsedKeys.has(cleanName)) {
                  parsedKeys.add(cleanName);
                  data.push({
                    name: cleanName,
                    waitMinutes,
                    status
                  });
                }
              }
            }
          }
        }
      }

      return data;
    });

    console.log(`[PHL Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[PHL Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[PHL Adapter] No checkpoints found. DOM verification failed.");
      console.log("--- DOM TEXT DUMP PREVIEW ---");
      const lines = fullText.split('\n');
      for(let i=0; i<lines.length; i++) {
        if(lines[i].includes('Terminal A-West') || lines[i].includes('Wait Time')) {
          console.log(lines.slice(Math.max(0, i-1), Math.min(lines.length, i+3)).join('\n'));
          console.log('---');
        }
      }
    }

  } catch (err) {
    console.error(`[PHL Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapePHL().then(() => process.exit(0));
}

module.exports = { scrapePHL };
