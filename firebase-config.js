// firebase-config.js — your project's PUBLIC web config.
//
// These values are safe to ship in the browser (that's how Firebase web apps work);
// your data is protected by the Realtime Database security rules, not by hiding these.
// Your Gemini API key is NOT here — it lives only in the Cloudflare Worker secret.
//
// Copy these values from the Firebase console:
//   Project settings (gear icon) → General → "Your apps" → Web app → SDK setup → Config
//
// The databaseURL is required for the Realtime Database. If you don't see one, create a
// Realtime Database first (Build → Realtime Database → Create database).

export const firebaseConfig = {
  apiKey: "AIzaSyCf3hK3O2cJkJiYNsaFF61zFvJVfrKJ4uU",
  authDomain: "sales-competition-coach.firebaseapp.com",
  databaseURL: "https://sales-competition-coach-default-rtdb.firebaseio.com",
  projectId: "sales-competition-coach",
  storageBucket: "sales-competition-coach.firebasestorage.app",
  messagingSenderId: "456924802105",
  appId: "1:456924802105:web:295b22303761446b2a31e8",
};

// The URL of your deployed Cloudflare Worker (the AI scoring backend).
// After `npx wrangler deploy`, paste the printed *.workers.dev URL here (no trailing slash).
export const aiEndpoint = "https://YOUR-WORKER.workers.dev";
