const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeMSP() {
  const airportCode = 'MSP';
  const sourceUrl = 'https://www.mspairport.com/airport/security-screening/security-wait-times';

  console.log(`[MSP Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Block unnecessary resources
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
      console.log(`[MSP Adapter] Page goto timed out, proceeding...`);
    }

    console.log(`[MSP Adapter] Page loaded. Extracting data...`);
    await new Promise(r => setTimeout(r, 4000)); 

    // Quick scout of the DOM text if parsing fails
    const fullText = await page.evaluate(() => document.body.innerText);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for Terminal 1 or Terminal 2
        if (line === 'Terminal 1' || line === 'Terminal 2') {
          const terminalName = line;
          
          let waitMinutes = null;
          let status = 'Active';
          let foundTime = false;
          
          // Look ahead up to 10 lines for the wait time
          for (let j = 1; j <= 10; j++) {
            if (i + j < lines.length) {
              const nextLine = lines[i + j].toUpperCase();
              
              if (nextLine.includes('MINUTES') || nextLine.includes('MIN')) {
                const prevLine = lines[i + j - 1];
                if (prevLine.includes('-')) {
                  const parts = prevLine.split('-');
                  waitMinutes = parseInt(parts[1], 10);
                } else {
                  const match = prevLine.match(/(\d+)/);
                  if (match) waitMinutes = parseInt(match[1], 10);
                }
                foundTime = true;
                break;
              } else if (nextLine.includes('CLOSED')) {
                status = 'Closed';
                foundTime = true;
                break;
              }
            }
          }
          
          if (foundTime) {
            let cleanName = terminalName + ' - Standard';
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

      return data;
    });

    console.log(`[MSP Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[MSP Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[MSP Adapter] No checkpoints found. DOM verification failed.");
      console.log("--- DOM TEXT DUMP PREVIEW ---");
      console.log(fullText.substring(0, 2000));
    }

  } catch (err) {
    console.error(`[MSP Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeMSP().then(() => process.exit(0));
}

module.exports = { scrapeMSP };
