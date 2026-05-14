const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapePDX() {
  const airportCode = 'PDX';
  const sourceUrl = 'https://www.flypdx.com/';

  console.log(`[PDX Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Block tracking/media to avoid navigation timeouts
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
      console.log(`[PDX Adapter] Page goto timed out, proceeding...`);
    }

    console.log(`[PDX Adapter] Page loaded. Extracting data...`);
    await new Promise(r => setTimeout(r, 4000)); 

    const fullText = await page.evaluate(() => document.body.innerText);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line === 'Security checkpoint for gates') {
          // The next line is the gate letters, e.g., "B C" or "D E"
          let gates = lines[i + 1] ? lines[i + 1].trim() : '';
          if (gates.length <= 5) {
            
            let standardWait = null;
            let precheckWait = null;
            let status = 'Active';
            
            // Look ahead for "General boarding" and the numbers
            for (let j = 2; j <= 10; j++) {
              if (i + j < lines.length) {
                const nextLine = lines[i + j];
                
                if (nextLine === 'General boarding') {
                  // Standard wait is typically the next line
                  const stdMatch = lines[i + j + 1] ? lines[i + j + 1].match(/(\d+)/) : null;
                  if (stdMatch) standardWait = parseInt(stdMatch[1], 10);
                } else if (nextLine === 'minutes' && standardWait !== null && precheckWait === null) {
                  // Precheck wait usually follows standard wait
                  const preMatch = lines[i + j - 1] ? lines[i + j - 1].match(/(\d+)/) : null;
                  // If we didn't just match standardWait again...
                  if (preMatch && parseInt(preMatch[1], 10) !== standardWait) {
                    precheckWait = parseInt(preMatch[1], 10);
                  } else if (lines[i + j + 1] && lines[i + j + 1].match(/(\d+)/)) {
                     // Sometimes it is the line AFTER minutes
                     precheckWait = parseInt(lines[i + j + 1].match(/(\d+)/)[1], 10);
                  }
                } else if (nextLine.toUpperCase().includes('CLOSED')) {
                  status = 'Closed';
                }
                
                // Break once we find both or hit the next checkpoint
                if ((standardWait !== null && precheckWait !== null) || nextLine === 'Security checkpoint for gates') {
                  break;
                }
              }
            }
            
            // Push Standard
            let stdName = `Gates ${gates} - Standard`;
            if (!parsedKeys.has(stdName)) {
              parsedKeys.add(stdName);
              data.push({
                name: stdName,
                waitMinutes: standardWait !== null ? standardWait : 0,
                status
              });
            }
            
            // Push PreCheck if found
            if (precheckWait !== null) {
              let preName = `Gates ${gates} - TSA PreCheck`;
              if (!parsedKeys.has(preName)) {
                parsedKeys.add(preName);
                data.push({
                  name: preName,
                  waitMinutes: precheckWait,
                  status
                });
              }
            }
            
          }
        }
      }

      return data;
    });

    console.log(`[PDX Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[PDX Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[PDX Adapter] No checkpoints found. DOM verification failed.");
      console.log("--- DOM TEXT DUMP PREVIEW ---");
      // Find security mentions in the text and dump the surrounding text
      const lines = fullText.split('\n');
      for(let i=0; i<lines.length; i++) {
        if(lines[i].toLowerCase().includes('min') || lines[i].toLowerCase().includes('security')) {
          console.log(lines.slice(Math.max(0, i-2), Math.min(lines.length, i+5)).join('\n'));
          console.log('---');
        }
      }
    }

  } catch (err) {
    console.error(`[PDX Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapePDX().then(() => process.exit(0));
}

module.exports = { scrapePDX };
