const { syncAirportData } = require('../scraper/db');

// Placeholder adapter for DAL (Dallas Love Field) since their site is currently down/unavailable.
async function scrapeDAL() {
  const airportCode = 'DAL';
  
  console.log(`[DAL Adapter] Site is currently down. Pushing N/A placeholders...`);
  
  // DAL typically has a single consolidated checkpoint.
  // We will push them as 'Closed' / NA so the dashboard reflects the downtime accurately.
  const knownCheckpoints = [
    "Security Checkpoint - General", 
    "Security Checkpoint - TSA PreCheck"
  ];
  
  const checkpointsData = knownCheckpoints.map(cpName => ({
    name: cpName,
    waitMinutes: null,
    status: 'Closed' // This will render as Closed/italic gray on our dashboard
  }));

  try {
    await syncAirportData(airportCode, checkpointsData);
    console.log(`[DAL Adapter] Successfully pushed placeholders to Firebase.`);
  } catch (err) {
    console.error(`[DAL Adapter] Error pushing placeholders:`, err.message);
  }
}

if (require.main === module) {
  scrapeDAL().then(() => process.exit(0));
}

module.exports = { scrapeDAL };
