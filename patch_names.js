const fs = require('fs');

// Load your existing database
const file = 'Gemgrind_2500_Enemy_Models_Database.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Prepend the first word of the Continent Name to ensure absolute uniqueness
data.forEach(enemy => {
    const prefix = enemy["Continent Name"].split(" ")[0]; 
    
    // Prevent double-prefixing if accidentally run twice
    if (!enemy["Enemy Name"].startsWith(prefix)) {
        enemy["Enemy Name"] = `${prefix} ${enemy["Enemy Name"]}`;
    }
});

// Save as a new master file for Claude handoff
const outputFile = 'Gemgrind_2500_Enemy_Models_Database_Patched.json';
fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

console.log(`Successfully patched ${data.length} enemy models. Saved to ${outputFile}`);
