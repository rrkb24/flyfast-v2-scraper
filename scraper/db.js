const admin = require('firebase-admin');
const { firebaseServiceAccount, collectionName } = require('./config');

let db = null;

if (firebaseServiceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseServiceAccount)
    });
  }
  db = admin.firestore();
} else {
  console.warn("WARNING: Firebase service account not found. DB writes will be logged to console in DRY RUN mode.");
}

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'delta_cache.json');
let localCache = {};
try {
  if (fs.existsSync(CACHE_FILE)) {
    localCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
} catch (e) {
  console.error('[DB] Cache load error:', e);
}

/**
 * Normalizes and batch writes airport arrays to Firestore using Zero-Read Local Caching.
 */
async function syncAirportData(airportCode, checkpointsData) {
  const currentMs = Date.now();
  console.log(`\n[${airportCode}] Synchronizing ${checkpointsData.length} checkpoints...`);

  if (!db) {
    console.log(`[DRY RUN DB Cache Write Block - ${airportCode}]`);
    return;
  }

  try {
    const logsRef = db.collection(collectionName);
    const batch = db.batch();
    let writesQueued = 0;
    let cacheChanged = false;

    for (const cp of checkpointsData) {
      const isClosed = cp.waitMinutes === null || cp.status === 'Closed';
      
      const payload = {
        airport: airportCode,
        terminal: cp.name,
        waitTime: isClosed ? null : cp.waitMinutes,
        status: isClosed ? 'Closed' : 'Active',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        timestampMs: currentMs
      };

      const cacheKey = `${airportCode}_${cp.name}`;
      const lastRecord = localCache[cacheKey];

      let shouldWrite = true;

      if (lastRecord) {
        const timeDiffMinutes = (currentMs - (lastRecord.timestampMs || 0)) / (1000 * 60);
        // Write if: status changed, waitTime changed, OR it's been 15+ mins
        if (lastRecord.waitTime === payload.waitTime && lastRecord.status === payload.status && timeDiffMinutes < 15) {
          shouldWrite = false;
        }
      }

      if (shouldWrite) {
        // Create a predictable document ID (e.g., "ATL_Domestic_Main_Checkpoint")
        const docId = `${airportCode}_${cp.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        console.log(`[DEBUG] Attempting to write document with ID: ${docId}`);
        const docRef = logsRef.doc(docId);
        batch.set(docRef, payload);
        writesQueued++;

        // Update local cache state
        localCache[cacheKey] = { waitTime: payload.waitTime, status: payload.status, timestampMs: currentMs };
        cacheChanged = true;
      }
    }

    if (cacheChanged) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(localCache));
    }

    if (writesQueued > 0) {
      await batch.commit();
      console.log(`[${airportCode}] Committed ${writesQueued} new checkpoint records to Firestore.`);
    } else {
      console.log(`[${airportCode}] Cache hit for all checkpoints. Saved Firestore tier quota.`);
    }

  } catch (err) {
    console.error(`[${airportCode}] Error syncing to Firestore:`, err.message);
  }
}

/**
 * Reads all wait_times documents from Firestore and returns them grouped by airport.
 */
async function getAllWaitTimes() {
  if (!db) return {};

  const snapshot = await db.collection(collectionName).get();
  const grouped = {};

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const code = data.airport || 'UNKNOWN';

    if (!grouped[code]) {
      grouped[code] = [];
    }

    grouped[code].push({
      id: doc.id,
      terminal: data.terminal,
      waitTime: data.waitTime,
      status: data.status || 'Active',
      timestampMs: data.timestampMs || null
    });
  });

  return grouped;
}

module.exports = { syncAirportData, getAllWaitTimes };
