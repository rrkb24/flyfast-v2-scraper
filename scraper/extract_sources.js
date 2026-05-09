const { targetAirports } = require('./config');
const fs = require('fs');
const path = require('path');

async function extractSource(airportCode) {
  try {
    const url = `https://tsa.fromthetraytable.com/airport/${airportCode}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });

    if (!res.ok) {
      console.error(`[!] Failed to load ${airportCode}: HTTP ${res.status}`);
      return { code: airportCode, source: null };
    }

    const html = await res.text();
    
    // Look for the "View More Data" link. It might be <a href="...">View More Data</a>
    const match = html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>(?:<[^>]+>)*\s*View More Data\s*(?:<\/[^>]+>)*<\/a>/i);
    
    if (match && match[1]) {
      return { code: airportCode, source: match[1] };
    } else {
      console.warn(`[?] Could not find "View More Data" link for ${airportCode}.`);
      return { code: airportCode, source: null };
    }

  } catch (err) {
    console.error(`[X] Error on ${airportCode}:`, err.message);
    return { code: airportCode, source: null };
  }
}

async function main() {
  console.log(`Extracting sources for ${targetAirports.length} airports...`);
  const promises = targetAirports.map(code => extractSource(code));
  const results = await Promise.all(promises);
  
  const sourceMap = {};
  let successCount = 0;

  for (const res of results) {
    if (res.source) {
      sourceMap[res.code] = res.source;
      successCount++;
      console.log(`[+] ${res.code} -> ${res.source}`);
    }
  }

  const outputPath = path.join(__dirname, 'sources.json');
  fs.writeFileSync(outputPath, JSON.stringify(sourceMap, null, 2));
  
  console.log(`\n✅ Finished extraction! Found sources for ${successCount}/${targetAirports.length} airports.`);
  console.log(`Saved to: ${outputPath}`);
}

main();
