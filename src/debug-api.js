/**
 * Debug script to inspect API response structure
 */

import fetch from 'node-fetch';

async function debugApi() {
  console.log('🔍 Debugging API Response Structure...\n');
  
  const url = 'https://lotobonheur.ci/api/results?monthYear=février%202026&drawType=Tous%20les%20tirages';
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers));
    console.log('\n');
    
    const data = await response.json();
    
    console.log('=== TOP LEVEL KEYS ===');
    console.log(Object.keys(data));
    
    console.log('\n=== drawsResultsWeekly ===');
    console.log('Type:', typeof data.drawsResultsWeekly);
    console.log('Is Array:', Array.isArray(data.drawsResultsWeekly));
    console.log('Length:', data.drawsResultsWeekly?.length);
    
    if (data.drawsResultsWeekly && data.drawsResultsWeekly.length > 0) {
      console.log('\n=== FIRST WEEK OBJECT ===');
      const firstWeek = data.drawsResultsWeekly[0];
      console.log('Keys:', Object.keys(firstWeek));
      console.log('Full object:');
      console.log(JSON.stringify(firstWeek, null, 2));
      
      // Check for nested structures
      if (firstWeek.drawResultsDaily) {
        console.log('\n=== drawResultsDaily ===');
        console.log('Length:', firstWeek.drawResultsDaily.length);
        if (firstWeek.drawResultsDaily.length > 0) {
          console.log('First day keys:', Object.keys(firstWeek.drawResultsDaily[0]));
          console.log('First day:');
          console.log(JSON.stringify(firstWeek.drawResultsDaily[0], null, 2));
        }
      }
      
      // Check all possible result containers
      for (const key of Object.keys(firstWeek)) {
        if (Array.isArray(firstWeek[key]) && firstWeek[key].length > 0) {
          console.log(`\n=== ${key} (array with ${firstWeek[key].length} items) ===`);
          console.log('First item:', JSON.stringify(firstWeek[key][0], null, 2));
        }
      }
    }
    
    // Save full response for analysis
    const fs = await import('fs');
    fs.writeFileSync('./debug-response.json', JSON.stringify(data, null, 2));
    console.log('\n✅ Full response saved to debug-response.json');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

debugApi();
