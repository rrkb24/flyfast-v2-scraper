const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeMCO() {
  const airportCode = 'MCO';
  const sourceUrl = 'https://flymco.com/security/';
  
  console.log(`[MCO Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[MCO Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // MCO uses SecurityWaitTime cards with styled-components classes
      // Each card has a gate range heading and lane info with time ranges
      const cards = document.querySelectorAll('[class*="SecurityWaitTimeCard"]');
      
      if (cards.length === 0) {
        // Fallback: find all elements with the TimeRange class pattern
        const timeEls = document.querySelectorAll('[class*="SecurityWaitTimeLaneInfo"]');
        const processed = new Set();
        
        timeEls.forEach(el => {
          const parent = el.closest('[class*="SecurityWaitTime"]') || el.parentElement?.parentElement;
          if (!parent || processed.has(parent)) return;
          
          // Find the heading/title for this checkpoint group
          const heading = parent.querySelector('h2, h3, h4, [class*="Title"], [class*="Heading"]');
          const laneInfos = parent.querySelectorAll('[class*="LaneInfo"]');
          
          laneInfos.forEach(lane => {
            const labelEl = lane.querySelector('[class*="LaneName"], [class*="Label"]');
            const timeEl = lane.querySelector('[class*="TimeRange"]');
            
            if (!timeEl) return;
            
            const label = labelEl ? labelEl.innerText.trim() : 'General';
            const timeText = timeEl.innerText.trim();
            const headingText = heading ? heading.innerText.trim() : 'Checkpoint';
            
            // Parse "0 - 2 min" → take the higher number
            const numbers = timeText.match(/(\d+)/g);
            if (!numbers) return;
            
            const waitMinutes = Math.max(...numbers.map(n => parseInt(n, 10)));
            
            data.push({
              name: `${headingText} - ${label}`,
              waitMinutes,
              status: 'Active'
            });
          });
          
          processed.add(parent);
        });
      }
      
      // If the card-level approach found nothing, try raw text extraction
      if (data.length === 0) {
        const allText = document.body.innerText;
        const sections = allText.split(/(?=Gates?\s+\d)/i);
        
        sections.forEach(section => {
          const gateMatch = section.match(/(Gates?\s+[\d\s\-–,]+)/i);
          if (!gateMatch) return;
          
          const gateName = gateMatch[1].trim();
          const timeMatches = section.match(/(\d+)\s*(?:-|–)\s*(\d+)\s*min/gi);
          
          if (timeMatches) {
            timeMatches.forEach((tm, i) => {
              const nums = tm.match(/(\d+)/g);
              const waitMinutes = Math.max(...nums.map(n => parseInt(n, 10)));
              const label = i === 0 ? 'Standard' : 'PreCheck';
              
              data.push({
                name: `${gateName} - ${label}`,
                waitMinutes,
                status: 'Active'
              });
            });
          }
        });
      }
      
      return data;
    });

    console.log(`[MCO Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[MCO Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[MCO Adapter] No checkpoints found. Page structure may have changed.");
    }
    
  } catch (err) {
    console.error(`[MCO Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeMCO().then(() => process.exit(0));
}

module.exports = { scrapeMCO };
