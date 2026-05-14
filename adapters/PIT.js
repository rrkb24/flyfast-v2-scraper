const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapePIT() {
  const airportCode = 'PIT';
  const sourceUrl = 'https://flypittsburgh.com/';

  console.log(`[PIT Adapter] Launching Stealth Browser for ${sourceUrl}...`);

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
      console.log(`[PIT Adapter] Page goto timed out, proceeding...`);
    }

    console.log(`[PIT Adapter] Page loaded. Extracting data...`);
    await new Promise(r => setTimeout(r, 4000)); 

    const fullText = await page.evaluate(() => document.body.innerText);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line === 'Current Security Wait Times') {
          // Look ahead to find all the numbers and lane types
          for (let j = 1; j <= 20; j++) {
            if (i + j < lines.length) {
              const currentLine = lines[i + j];
              
              if (currentLine === 'Standard' || currentLine === 'Priority' || currentLine === 'CLEAR' || currentLine === 'TSA PreCheck') {
                 let waitMinutes = null;
                 
                 // Look up 1 or 2 lines for the number
                 const prevLine = lines[i + j - 1];
                 const prevPrevLine = lines[i + j - 2];
                 
                 const match1 = prevLine ? prevLine.match(/^(\d+)$/) : null;
                 const match2 = prevPrevLine ? prevPrevLine.match(/^(\d+)$/) : null;
                 
                 if (match1) {
                   waitMinutes = parseInt(match1[1], 10);
                 } else if (match2) {
                   waitMinutes = parseInt(match2[1], 10);
                 } else {
                   waitMinutes = 0; // If "Minute" is the only thing, it might be 0 or <1
                 }
                 
                 let cleanName = `Main Checkpoint - ${currentLine}`;
                 if (!parsedKeys.has(cleanName)) {
                   parsedKeys.add(cleanName);
                   data.push({
                     name: cleanName,
                     waitMinutes,
                     status: 'Active'
                   });
                 }
              }
              
              // Break once we hit the parking section
              if (currentLine.includes('Parking Options')) {
                break;
              }
            }
          }
        }
      }

      return data;
    });

    console.log(`[PIT Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[PIT Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[PIT Adapter] No checkpoints found. DOM verification failed.");
      console.log("--- DOM TEXT DUMP PREVIEW ---");
      const lines = fullText.split('\n');
      for(let i=0; i<lines.length; i++) {
        if(lines[i].toLowerCase().includes('wait') || lines[i].toLowerCase().includes('checkpoint') || lines[i].toLowerCase().includes('min')) {
          console.log(lines.slice(Math.max(0, i-1), Math.min(lines.length, i+3)).join('\n'));
          console.log('---');
        }
      }
    }

  } catch (err) {
    console.error(`[PIT Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapePIT().then(() => process.exit(0));
}

module.exports = { scrapePIT };
