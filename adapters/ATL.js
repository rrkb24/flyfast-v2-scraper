const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeATL() {
  const airportCode = 'ATL';
  const sourceUrl = 'https://www.atl.com/times/';
  
  console.log(`[ATL Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    // ATL uses Cloudflare, so stealth plugin is required and networkidle2 is safest
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[ATL Adapter] Page loaded successfully. Extracting data...`);
    
    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      // ATL places wait times in WPBakery rows (.vc_row). Inside, there are headers (h2/h3) and buttons for wait times.
      // We will look for elements containing the checkpoint titles and find the adjacent wait time buttons.
      // The ATL layout uses .row for each checkpoint.
      // Inside .row, the first .col has div.lomestic with h2 and h3 (the name).
      // The second .col has the button.btn (the wait time).
      const rows = document.querySelectorAll('.row');
      
      // Determine if we are in the Domestic or Int'l section based on surrounding headers
      // (The site uses <h1>DOMESTIC</h1> and <h1>INT'L</h1> before the respective rows)
      let currentSection = 'Domestic';
      
      const allElements = document.querySelectorAll('.row, h1');
      allElements.forEach(el => {
        if (el.tagName === 'H1') {
          if (el.innerText.toUpperCase().includes("INT'L")) {
            currentSection = 'International';
          } else if (el.innerText.toUpperCase().includes('DOMESTIC')) {
            currentSection = 'Domestic';
          }
          return; // Skip processing the h1 as a row
        }
        
        // It's a .row
        const h2 = el.querySelector('.lomestic h2');
        const h3 = el.querySelector('.lomestic h3');
        const btn = el.querySelector('button.btn');
        
        if (!h2 || !btn) return;
        
        const title1 = h2.innerText.trim().toUpperCase();
        const title2 = h3 ? h3.innerText.trim().toUpperCase() : '';
        
        let name = '';
        
        if (currentSection === 'International' && title1.includes('MAIN')) {
          name = 'International – Main';
        } else if (currentSection === 'Domestic') {
          if (title1.includes('LOWER NORTH')) {
            name = 'Domestic – Lower North';
          } else if (title1.includes('NORTH')) {
            name = 'Domestic – North';
          } else if (title1.includes('SOUTH')) {
            name = 'Domestic – South';
          } else if (title1.includes('MAIN')) {
            name = 'Domestic – Main';
          }
        }

        // Only process known ATL checkpoints
        if (!name.includes('–')) return;

        const waitText = btn.innerText.trim().toUpperCase();
        
        let waitMinutes = null;
        let status = 'Active';

        if (waitText === 'X' || waitText.includes('CLOSED')) {
          status = 'Closed';
          waitMinutes = null;
        } else {
          const numbers = waitText.match(/(\d+)/);
          if (numbers) {
            waitMinutes = parseInt(numbers[1], 10);
          } else {
            // If it doesn't say Closed and has no numbers, assume closed or error
            status = 'Closed';
          }
        }
        
        // Ensure no duplicates
        if (!data.find(cp => cp.name === name)) {
            data.push({ name, waitMinutes, status });
        }
      });
      
      return data;
    });

    console.log(`[ATL Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      // For local testing, we don't necessarily want to pollute firebase right away until verified,
      // but syncAirportData won't break anything.
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[ATL Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[ATL Adapter] No checkpoints found. DOM verification failed.");
    }
    
  } catch (err) {
    console.error(`[ATL Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeATL().then(() => process.exit(0));
}

module.exports = { scrapeATL };
