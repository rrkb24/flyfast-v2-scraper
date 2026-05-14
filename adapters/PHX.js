const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapePHX() {
  const airportCode = 'PHX';
  const sourceUrl = 'https://www.skyharbor.com/';

  console.log(`[PHX Adapter] Launching Stealth Browser for ${sourceUrl}...`);

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
      console.log(`[PHX Adapter] Page goto timed out, proceeding...`);
    }

    console.log(`[PHX Adapter] Page loaded. Extracting data...`);
    await new Promise(r => setTimeout(r, 4000)); 

    const fullText = await page.evaluate(() => document.body.innerText);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      let currentTerminal = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('Terminal 3') || line.includes('Terminal 4')) {
           currentTerminal = line.replace('*', '').trim();
        }
        
        if (line.toUpperCase().includes('CHECKPOINT') && currentTerminal) {
          const nameRaw = currentTerminal + ' - ' + line.trim();
          
          let waitMinutes = null;
          let status = 'Active';
          let foundTime = false;
          
          for (let j = 1; j <= 5; j++) {
            if (i + j < lines.length) {
              const nextLine = lines[i + j].toUpperCase();
              
              if (nextLine.includes('MIN') || nextLine.includes('WAIT')) {
                const match = nextLine.match(/(\d+)/);
                if (match) {
                  waitMinutes = parseInt(match[1], 10);
                  foundTime = true;
                }
                break;
              } else if (nextLine.includes('CLOSED')) {
                status = 'Closed';
                foundTime = true;
                break;
              }
            }
          }
          
          if (foundTime && waitMinutes !== null) {
            let cleanName = nameRaw + ' - Standard';
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

    console.log(`[PHX Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[PHX Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[PHX Adapter] No checkpoints found. DOM verification failed.");
      console.log("--- DOM TEXT DUMP PREVIEW ---");
      const lines = fullText.split('\n');
      for(let i=0; i<lines.length; i++) {
        if(lines[i].includes('Terminal 4') || lines[i].toLowerCase().includes('checkpoint')) {
          console.log(lines.slice(Math.max(0, i-1), Math.min(lines.length, i+4)).join('\n'));
          console.log('---');
        }
      }
    }

  } catch (err) {
    console.error(`[PHX Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapePHX().then(() => process.exit(0));
}

module.exports = { scrapePHX };
