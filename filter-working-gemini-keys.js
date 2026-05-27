// Keep only working Gemini keys (including quota-exceeded ones)
// Remove only truly broken keys (expired + model not found)

const allKeys = [
  "AIzaSyAWDql58ThRWb3TqpLHcZCAeEeYw9jtSa8", // Expired - REMOVE
  "AIzaSyD-tnHV5rSfNqLJV-35N6XDvRfGBzA1w-I", // Expired - REMOVE
  "AIzaSyD8P8SWdk7J0ZWeYtk-svMB_l-tQcm24Es", // Expired - REMOVE
  "AIzaSyA1Gfk1Cjo5ysKZP_OSlQVEJDmJ8FYFSk4", // Expired - REMOVE
  "AIzaSyBm5KQKAhVZKpzm9Dcn22T-IfTDvcXIXBA", // Expired - REMOVE
  "AIzaSyAPGQ8H19FpikoTpk8mYYqJrmxp4UMesOs", // Expired - REMOVE
  "AIzaSyD6T1nkFf6Nx7bRFz8KCHCurg7a5O5BoiU", // Expired - REMOVE
  "AIzaSyBq4kR4kHKLf16ja9c5_JaYMt9V7Ov-xo4", // Expired - REMOVE
  "AIzaSyD7gMGsWkp8pRkmh0kl_NogP14-YM8QIfk", // Expired - REMOVE
  "AIzaSyBFAZsgIQNM3b62PMbmDuJcobUFd_gYqf0", // Expired - REMOVE
  "AIzaSyD8Hrh0MyaDhdkKTLd-JSNEYJj--iGtfyA", // QUOTA - KEEP (working, just rate limited)
  "AIzaSyC4o9Di93elAGN1oixumsmNud9jOMsllhM", // QUOTA - KEEP
  "AIzaSyA8RE4BYh2MZOZH8j1Ht3DHJil_NKXUcK0", // QUOTA - KEEP
  "AIzaSyBBNB7X9gWMFgrXYuHCcULwmIX6aGYTRy0", // QUOTA - KEEP
  "AIzaSyAdGKI6DWJ6UNZc6N1-55oSOFV260b6bjU", // QUOTA - KEEP
  "AIzaSyAVp2-loHawh6ssArPVoadzX07bpHTMnwg", // QUOTA - KEEP
  "AIzaSyB_6pAxLV9DdXBoUdlXGPf4tUcUjWdy-ME", // QUOTA - KEEP
  "AIzaSyBkPFKv1ROoGwQ5rm2RLBWRWV4WNgeu9nI", // QUOTA - KEEP
  "AIzaSyCo3CylHBwfk24sgi1Uvs5Na1YJ3j7b_Ag", // QUOTA - KEEP
  "AIzaSyB3iS1jRnpN1D4I0LvizQPvZcU7SLDCWiA", // Model not found - REMOVE
  "AIzaSyBIY7irSVDcSInjKjeHtvRsdbvcNLJ5zi8", // Model not found - REMOVE
  "AIzaSyB3Gi2DBWt-YIAktb-NJNPogQ66kMuxtII", // Model not found - REMOVE
  "AIzaSyBEPXm3mvNBKxjI0op60g-c3yHGWuj36Yo", // Model not found - REMOVE
  "AIzaSyCqQXOebkboQgme0ptP0mTc6lH2iOOBi3E", // Model not found - REMOVE
  "AIzaSyC9ZsXEhaM7kIVXYyJErTCGfQkut9PNlLw", // Model not found - REMOVE
  "AIzaSyADBx6JDe3qjCKzU2BvcgKV4w8Dc0HOH4g", // Model not found - REMOVE
  "AIzaSyBzDjtZwJjvjorbIoQR9qBDSSmSV8d3pNo", // Model not found - REMOVE
  "AIzaSyCUAjbtm27yNZxRSC_dCpwQmN2ZWFWuil0", // Model not found - REMOVE
  "AIzaSyBJpqhrPyid8qtAqPI-BdV2NiNCyBe9ctc", // Model not found - REMOVE
  "AIzaSyBk8PMAu9DTKoWggZNNlupsia_LBco5OQo", // Model not found - REMOVE
  "AIzaSyA6JkWpVHBYOU4XCppM2N4lIlRz93FOBxE", // Model not found - REMOVE
  "AIzaSyBYxrmMqPQ-xAWbygYjNgvg2NNGVscUqrw", // Model not found - REMOVE
  "AIzaSyBeOmoC1u3uM1Cy46GZxCqdLzq0LQpBvBY", // Model not found - REMOVE
  "AIzaSyA8kjAlYbzBUuAJipwyMpJ5QBl8__sGfjE", // Model not found - REMOVE
];

// Keys 11-19 are quota-exceeded (WORKING, just rate limited)
const workingKeys = allKeys.slice(10, 19);

console.log("════════════════════════════════════════════════════════════════");
console.log("  GEMINI API KEYS - FILTERING RESULTS");
console.log("════════════════════════════════════════════════════════════════");
console.log("");
console.log(`Total keys tested: ${allKeys.length}`);
console.log(`Keys to KEEP (working, quota-exceeded): ${workingKeys.length}`);
console.log(`Keys to REMOVE (expired + model not found): ${allKeys.length - workingKeys.length}`);
console.log("");
console.log("✅ KEEPING THESE WORKING KEYS:");
console.log("   (Currently at quota limit, but will work when limit resets)");
console.log("");
workingKeys.forEach((key, i) => {
  console.log(`   ${i + 1}. ${key.slice(0, 20)}...${key.slice(-4)}`);
});
console.log("");
console.log("❌ REMOVING BROKEN KEYS:");
console.log("   - 10 expired keys (keys 1-10)");
console.log("   - 15 model not found keys (keys 20-34)");
console.log("");
console.log("════════════════════════════════════════════════════════════════");
console.log("  COPY THIS COMMAND:");
console.log("════════════════════════════════════════════════════════════════");
console.log("");
console.log("bunx convex run admin:saveGeminiKeys '{");
console.log('  "adminToken": "Aphantic*123",');
console.log('  "keys": ' + JSON.stringify(workingKeys, null, 4).replace(/\n/g, '\n  ') + ",");
console.log('  "append": false');
console.log("}'");
console.log("");
console.log("════════════════════════════════════════════════════════════════");
console.log("");
console.log("📝 NOTES:");
console.log("   • These 9 keys are WORKING (just hit rate limit during test)");
console.log("   • Quota resets automatically (per minute/day)");
console.log("   • System will rotate through keys to avoid hitting limits");
console.log("   • 500 requests/day per key = 4,500 requests/day total");
console.log("");
