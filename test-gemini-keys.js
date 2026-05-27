// Test all Gemini API keys to find working ones

const keys = [
  "AIzaSyAWDql58ThRWb3TqpLHcZCAeEeYw9jtSa8",
  "AIzaSyD-tnHV5rSfNqLJV-35N6XDvRfGBzA1w-I",
  "AIzaSyD8P8SWdk7J0ZWeYtk-svMB_l-tQcm24Es",
  "AIzaSyA1Gfk1Cjo5ysKZP_OSlQVEJDmJ8FYFSk4",
  "AIzaSyBm5KQKAhVZKpzm9Dcn22T-IfTDvcXIXBA",
  "AIzaSyAPGQ8H19FpikoTpk8mYYqJrmxp4UMesOs",
  "AIzaSyD6T1nkFf6Nx7bRFz8KCHCurg7a5O5BoiU",
  "AIzaSyBq4kR4kHKLf16ja9c5_JaYMt9V7Ov-xo4",
  "AIzaSyD7gMGsWkp8pRkmh0kl_NogP14-YM8QIfk",
  "AIzaSyBFAZsgIQNM3b62PMbmDuJcobUFd_gYqf0",
  "AIzaSyD8Hrh0MyaDhdkKTLd-JSNEYJj--iGtfyA",
  "AIzaSyC4o9Di93elAGN1oixumsmNud9jOMsllhM",
  "AIzaSyA8RE4BYh2MZOZH8j1Ht3DHJil_NKXUcK0",
  "AIzaSyBBNB7X9gWMFgrXYuHCcULwmIX6aGYTRy0",
  "AIzaSyAdGKI6DWJ6UNZc6N1-55oSOFV260b6bjU",
  "AIzaSyAVp2-loHawh6ssArPVoadzX07bpHTMnwg",
  "AIzaSyB_6pAxLV9DdXBoUdlXGPf4tUcUjWdy-ME",
  "AIzaSyBkPFKv1ROoGwQ5rm2RLBWRWV4WNgeu9nI",
  "AIzaSyCo3CylHBwfk24sgi1Uvs5Na1YJ3j7b_Ag",
  "AIzaSyB3iS1jRnpN1D4I0LvizQPvZcU7SLDCWiA",
  "AIzaSyBIY7irSVDcSInjKjeHtvRsdbvcNLJ5zi8",
  "AIzaSyB3Gi2DBWt-YIAktb-NJNPogQ66kMuxtII",
  "AIzaSyBEPXm3mvNBKxjI0op60g-c3yHGWuj36Yo",
  "AIzaSyCqQXOebkboQgme0ptP0mTc6lH2iOOBi3E",
  "AIzaSyC9ZsXEhaM7kIVXYyJErTCGfQkut9PNlLw",
  "AIzaSyADBx6JDe3qjCKzU2BvcgKV4w8Dc0HOH4g",
  "AIzaSyBzDjtZwJjvjorbIoQR9qBDSSmSV8d3pNo",
  "AIzaSyCUAjbtm27yNZxRSC_dCpwQmN2ZWFWuil0",
  "AIzaSyBJpqhrPyid8qtAqPI-BdV2NiNCyBe9ctc",
  "AIzaSyBk8PMAu9DTKoWggZNNlupsia_LBco5OQo",
  "AIzaSyA6JkWpVHBYOU4XCppM2N4lIlRz93FOBxE",
  "AIzaSyBYxrmMqPQ-xAWbygYjNgvg2NNGVscUqrw",
  "AIzaSyBeOmoC1u3uM1Cy46GZxCqdLzq0LQpBvBY",
  "AIzaSyA8kjAlYbzBUuAJipwyMpJ5QBl8__sGfjE",
];

async function testKey(key, index) {
  const model = "gemini-2.0-flash-exp"; // Try latest model
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hi" }] }],
      }),
    });

    const data = await response.json();

    if (response.ok && data.candidates) {
      console.log(`✅ Key ${index + 1}: WORKING`);
      return { key, working: true };
    } else if (data.error?.code === 404) {
      // Try older model
      const url2 = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
      const response2 = await fetch(url2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hi" }] }],
        }),
      });

      const data2 = await response2.json();
      if (response2.ok && data2.candidates) {
        console.log(`✅ Key ${index + 1}: WORKING (1.5-flash)`);
        return { key, working: true };
      } else {
        console.log(`❌ Key ${index + 1}: ${data2.error?.message || "Failed"}`);
        return { key, working: false, error: data2.error?.message };
      }
    } else {
      console.log(`❌ Key ${index + 1}: ${data.error?.message || "Failed"}`);
      return { key, working: false, error: data.error?.message };
    }
  } catch (err) {
    console.log(`❌ Key ${index + 1}: Network error - ${err.message}`);
    return { key, working: false, error: err.message };
  }
}

async function testAllKeys() {
  console.log(`Testing ${keys.length} Gemini API keys...\n`);

  const results = [];
  for (let i = 0; i < keys.length; i++) {
    const result = await testKey(keys[i], i);
    results.push(result);
    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const working = results.filter((r) => r.working);
  const broken = results.filter((r) => !r.working);

  console.log(`\n✅ Working keys: ${working.length}`);
  console.log(`❌ Broken keys: ${broken.length}`);

  console.log("\n📝 Working keys array (copy this):");
  console.log(JSON.stringify(working.map((r) => r.key), null, 2));

  console.log("\n🗑️  Broken keys (delete these):");
  broken.forEach((r, i) => {
    console.log(`${i + 1}. ${r.key.slice(0, 20)}... - ${r.error}`);
  });
}

testAllKeys().catch(console.error);
