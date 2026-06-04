const fs = require('fs');
const file = 'packages/web/src/app/onboarding/onboarding-client.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/Matthew \(US male\)/g, 'Joanna (US female)');
fs.writeFileSync(file, content);
console.log("Fixed label.");
