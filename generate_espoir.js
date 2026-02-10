import fetch from 'node-fetch';

async function run() {
  try {
    console.log('🔮 Requesting prediction for Espoir (Type 28)...');
    const response = await fetch('http://localhost:3000/predict?type=28');
    const data = await response.json();
    
    if (data.main && data.main.numbers) {
        console.log('\n✨ ESPOIR (18:55) PREDICTION:');
        console.log(`   🎲 Numbers: ${data.main.numbers.join(', ')}`);
        console.log(`   💪 Confidence: ${data.main.confidence}%`);
        
        console.log('\n   🔥 Top Candidates (with Tactical Boost):');
        data.topCandidates.slice(0, 5).forEach(c => {
            console.log(`   #${c.number}: ${c.score.toFixed(4)}`);
        });
    } else {
        console.log('❌ No prediction returned:', data);
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

run();
