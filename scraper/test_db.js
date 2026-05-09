const admin = require('firebase-admin');
const { firebaseServiceAccount } = require('./config');

async function testConnection() {
  if (!firebaseServiceAccount) {
    console.error("No service account found in config!");
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(firebaseServiceAccount)
  });

  const db = admin.firestore();
  
  try {
    console.log("Attempting to write to 'test_collection'...");
    const testDoc = db.collection('test_collection').doc('connection_test');
    await testDoc.set({
      message: 'Hello from Flyfast-v2 Sandbox!',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      agent: 'Antigravity Test Protocol'
    });
    console.log("✅ Successfully wrote test document to 'test_collection/connection_test'!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to write to Firebase:", err.message);
    process.exit(1);
  }
}

testConnection();
