const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeOMA() {
  const airportCode = 'OMA';
  const sourceUrl = 'https://www.flyoma.com/passenger-services/security-checkpoint-wait-times/';

  console.log(`[OMA Adapter] Launching Stealth Browser for ${sourceUrl}...`);

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
      console.log(`[OMA Adapter] Page goto timed out, proceeding...`);
    }

    console.log(`[OMA Adapter] Page loaded. Extracting data...`);
    await new Promise(r => setTimeout(r, 3000)); 

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('Concourse A') || line.includes('Concourse B')) {
          let cleanName = line.replace(' (South)', '').replace(' (North)', '').trim() + ' - Standard';
          
          let waitMinutes = null;
          let status = 'Active';
          
          // Look ahead 1-3 lines for the wait time
          for (let j = 1; j <= 3; j++) {
            if (i + j < lines.length) {
              const nextLine = lines[i + j].toUpperCase();
              if (nextLine.includes('MINUTES') || nextLine.includes('MIN')) {
                // Next line usually says "5-10" or "10"
                const prevLine = lines[i + j - 1]; 
                if (prevLine.includes('-')) {
                  const parts = prevLine.split('-');
                  waitMinutes = parseInt(parts[1], 10); // Take the higher number, e.g., 10 from "5-10"
                } else {
                  const match = prevLine.match(/(\d+)/);
                  if (match) waitMinutes = parseInt(match[1], 10);
                }
                break;
              } else if (nextLine.includes('CLOSED')) {
                status = 'Closed';
                break;
              }
            }
          }
          
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

      return data;
    });

    console.log(`[OMA Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[OMA Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[OMA Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[OMA Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeOMA().then(() => process.exit(0));
}

module.exports = { scrapeOMA };
