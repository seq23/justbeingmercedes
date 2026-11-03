// Prints a new one-time pairing link for justbeingmercedes.com (valid 30 days, one phone).
// Run with the signing secret from the Boss OS vault, never typed on a command line:
//   cd ~/GitHub/boss-os && npm run -s vault:run -- node ~/GitHub/justbeingmercedes/scripts/pairing-url.mjs
// (the vault holds it as JUSTBEINGMERCEDES_DEVICE_SECRET; DEVICE_SECRET is the Pages secret's name).
import { mintPairing, PAIRING_DAYS } from "../functions/_lib/device.js";

const secret = process.env.DEVICE_SECRET || process.env.JUSTBEINGMERCEDES_DEVICE_SECRET;
if (!secret) { console.error("pairing-url: STOP, DEVICE_SECRET_MISSING (run it through vault:run)"); process.exit(2); }
const base = process.argv[2] || "https://justbeingmercedes.com";
console.log(`${base}/pair?t=${await mintPairing(secret)}`);
console.error(`one phone, valid ${PAIRING_DAYS} days`);
