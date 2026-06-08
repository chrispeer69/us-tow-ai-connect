const bcrypt = require('bcryptjs');
async function run() {
  try {
    await bcrypt.compare("Password123!", "invalidhash");
    console.log("No crash");
  } catch(e) {
    console.log("Crash:", e);
  }
}
run();
