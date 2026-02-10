/**
 * Lotto Predictor
 * 
 * Génère des prédictions basées sur l'analyse des patterns historiques
 */

import supabase from './supabase-client.js';

// =====================================================
// CONFIGURATION
// =====================================================

const WEIGHTS = {
  hotNumber: 0.25,        // Numéros fréquents
  coldNumber: 0.15,       // Numéros rares (contrarian)
  overdueNumber: 0.20,    // Numéros en retard
  dayOfWeek: 0.15,        // Favoris du jour
  positionFreq: 0.10,     // Fréquence par position
  pairs: 0.10,            // Paires fréquentes
  sumRange: 0.05          // Dans la plage de somme typique
};

// =====================================================
// DATA LOADING
// =====================================================

async function loadDrawData(drawTypeId = null) {
  let query = supabase
    .from('draws')
    .select('*, draw_types(name)')
    .order('draw_date', { ascending: false });
  
  if (drawTypeId) {
    query = query.eq('draw_type_id', drawTypeId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error loading draws:', error);
    return [];
  }
  
  return data;
}

async function loadDrawTypes() {
  const { data, error } = await supabase
    .from('draw_types')
    .select('id, name, category');
  
  if (error) {
    console.error('Error loading draw types:', error);
    return [];
  }
  
  return data;
}

// =====================================================
// ANALYSIS FUNCTIONS
// =====================================================

function calculateNumberFrequency(draws) {
  const freq = {};
  for (let i = 1; i <= 90; i++) freq[i] = { total: 0, positions: [0, 0, 0, 0, 0] };
  
  for (const draw of draws) {
    const nums = [
      draw.winning_number_1,
      draw.winning_number_2,
      draw.winning_number_3,
      draw.winning_number_4,
      draw.winning_number_5
    ];
    
    nums.forEach((num, pos) => {
      if (num) {
        freq[num].total++;
        freq[num].positions[pos]++;
      }
    });
  }
  
  return freq;
}

function calculateLastSeen(draws) {
  const lastSeen = {};
  const today = new Date();
  
  for (let i = 1; i <= 90; i++) lastSeen[i] = { date: null, daysSince: 9999 };
  
  for (const draw of draws) {
    const nums = [
      draw.winning_number_1,
      draw.winning_number_2,
      draw.winning_number_3,
      draw.winning_number_4,
      draw.winning_number_5
    ];
    
    for (const num of nums) {
      if (!lastSeen[num].date) {
        lastSeen[num].date = draw.draw_date;
        lastSeen[num].daysSince = Math.floor((today - new Date(draw.draw_date)) / (1000 * 60 * 60 * 24));
      }
    }
  }
  
  return lastSeen;
}

function calculateDayOfWeekFavorites(draws, targetDayOfWeek) {
  const counts = {};
  for (let i = 1; i <= 90; i++) counts[i] = 0;
  
  const dayDraws = draws.filter(d => d.day_of_week === targetDayOfWeek);
  
  for (const draw of dayDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) counts[num]++;
    });
  }
  
  return counts;
}

function calculatePairFrequency(draws) {
  const pairs = {};
  
  for (const draw of draws) {
    const nums = [
      draw.winning_number_1,
      draw.winning_number_2,
      draw.winning_number_3,
      draw.winning_number_4,
      draw.winning_number_5
    ].sort((a, b) => a - b);
    
    for (let i = 0; i < nums.length - 1; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const key = `${nums[i]}-${nums[j]}`;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  }
  
  return pairs;
}

function calculateSumStats(draws) {
  const sums = draws.map(d => 
    d.winning_number_1 + d.winning_number_2 + d.winning_number_3 +
    d.winning_number_4 + d.winning_number_5
  );
  
  sums.sort((a, b) => a - b);
  
  return {
    min: Math.min(...sums),
    max: Math.max(...sums),
    avg: sums.reduce((a, b) => a + b, 0) / sums.length,
    median: sums[Math.floor(sums.length / 2)],
    q1: sums[Math.floor(sums.length * 0.25)],
    q3: sums[Math.floor(sums.length * 0.75)]
  };
}

// =====================================================
// SCORING FUNCTIONS
// =====================================================

function scoreNumbers(draws, targetDayOfWeek) {
  const totalDraws = draws.length || 1;
  const scores = {};
  
  for (let i = 1; i <= 90; i++) scores[i] = 0;
  
  // Frequency analysis
  const freq = calculateNumberFrequency(draws);
  const maxFreq = Math.max(...Object.values(freq).map(f => f.total));
  const minFreq = Math.min(...Object.values(freq).map(f => f.total));
  
  // Last seen analysis
  const lastSeen = calculateLastSeen(draws);
  const maxDays = Math.max(...Object.values(lastSeen).map(l => l.daysSince === 9999 ? 0 : l.daysSince));
  
  // Day of week analysis
  const dayFavs = calculateDayOfWeekFavorites(draws, targetDayOfWeek);
  const maxDayCount = Math.max(...Object.values(dayFavs));
  
  // Score each number
  for (let num = 1; num <= 90; num++) {
    // Hot number score (higher frequency = higher score)
    const hotScore = maxFreq > 0 ? (freq[num].total / maxFreq) * WEIGHTS.hotNumber * 100 : 0;
    
    // Cold number score (lower frequency = higher score for contrarian)
    const coldScore = maxFreq > minFreq ? 
      ((maxFreq - freq[num].total) / (maxFreq - minFreq)) * WEIGHTS.coldNumber * 100 : 0;
    
    // Overdue score (more days since = higher score)
    const overdueScore = maxDays > 0 && lastSeen[num].daysSince !== 9999 ? 
      (lastSeen[num].daysSince / maxDays) * WEIGHTS.overdueNumber * 100 : 0;
    
    // Day of week score
    const dayScore = maxDayCount > 0 ? 
      (dayFavs[num] / maxDayCount) * WEIGHTS.dayOfWeek * 100 : 0;
    
    scores[num] = hotScore + coldScore + overdueScore + dayScore;
  }
  
  return scores;
}

// =====================================================
// PREDICTION GENERATION
// =====================================================

function generatePrediction(scores, sumStats, count = 5) {
  const predictions = [];
  const attempts = 0;
  const maxAttempts = 1000;
  
  // Sort numbers by score
  const sortedNumbers = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([num, score]) => ({ number: parseInt(num), score }));
  
  // Strategy 1: Top scored numbers
  const topScored = sortedNumbers.slice(0, 20).map(n => n.number);
  
  // Strategy 2: Mixed (hot + overdue)
  const mixed = [
    ...sortedNumbers.slice(0, 10).map(n => n.number),
    ...sortedNumbers.slice(-10).map(n => n.number)
  ];
  
  // Generate multiple predictions
  for (let strategy = 0; strategy < 3; strategy++) {
    let pool = strategy === 0 ? topScored : 
               strategy === 1 ? mixed : 
               sortedNumbers.map(n => n.number);
    
    let attempt = 0;
    while (attempt < maxAttempts) {
      // Pick 5 random numbers from pool
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 5).sort((a, b) => a - b);
      
      // Check sum is in acceptable range
      const sum = selected.reduce((a, b) => a + b, 0);
      if (sum >= sumStats.q1 && sum <= sumStats.q3) {
        // Calculate confidence score
        const avgScore = selected.reduce((acc, num) => acc + scores[num], 0) / 5;
        const confidence = Math.min(99, Math.max(1, avgScore * 1.5));
        
        predictions.push({
          numbers: selected,
          sum,
          confidence: parseFloat(confidence.toFixed(1)),
          strategy: strategy === 0 ? 'hot' : strategy === 1 ? 'mixed' : 'random',
          avgScore: parseFloat(avgScore.toFixed(2))
        });
        break;
      }
      attempt++;
    }
  }
  
  // Sort by confidence
  predictions.sort((a, b) => b.confidence - a.confidence);
  
  return predictions;
}

// =====================================================
// ALERTS
// =====================================================

function generateAlerts(draws, lastSeen, freq) {
  const alerts = [];
  const today = new Date();
  const avgDrawsPerMonth = draws.length / 65; // ~65 months of data
  
  // Overdue alerts (numbers not seen for a long time)
  const overdueThreshold = 30; // days
  for (let num = 1; num <= 90; num++) {
    if (lastSeen[num].daysSince >= overdueThreshold && lastSeen[num].daysSince < 9999) {
      alerts.push({
        type: 'overdue',
        number: num,
        daysSince: lastSeen[num].daysSince,
        message: `Le numéro ${num} n'est pas sorti depuis ${lastSeen[num].daysSince} jours`,
        severity: lastSeen[num].daysSince > 60 ? 'high' : 'medium'
      });
    }
  }
  
  // Hot streak alerts (numbers appearing frequently recently)
  const recentDraws = draws.slice(0, 30); // Last 30 draws
  const recentFreq = {};
  for (let i = 1; i <= 90; i++) recentFreq[i] = 0;
  
  for (const draw of recentDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) recentFreq[num]++;
    });
  }
  
  const hotThreshold = 5;
  for (let num = 1; num <= 90; num++) {
    if (recentFreq[num] >= hotThreshold) {
      alerts.push({
        type: 'hot_streak',
        number: num,
        recentCount: recentFreq[num],
        message: `🔥 Le numéro ${num} est en série chaude! (${recentFreq[num]}x dans les 30 derniers tirages)`,
        severity: 'high'
      });
    }
  }
  
  // Sort by severity
  const severityOrder = { high: 3, medium: 2, low: 1 };
  alerts.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  
  return alerts.slice(0, 20); // Return top 20 alerts
}

// =====================================================
// STORE PREDICTIONS
// =====================================================

async function storePredictions(predictions, drawTypeId, drawTypeName) {
  const today = new Date().toISOString().split('T')[0];
  
  for (const pred of predictions) {
    const record = {
      draw_type_id: drawTypeId,
      prediction_date: today,
      predicted_numbers: pred.numbers,
      confidence_score: Math.min(99.99, pred.confidence),
      pattern_ids: { strategy: pred.strategy, avgScore: pred.avgScore }
    };
    
    const { error } = await supabase
      .from('predictions')
      .insert(record);
    
    if (error) {
      console.error(`Error storing prediction:`, error.message);
    }
  }
}

// =====================================================
// MAIN FUNCTION
// =====================================================

async function generateAllPredictions() {
  console.log('🔮 LOTTO PREDICTOR');
  console.log('=' .repeat(60));
  console.log('');
  
  const drawTypes = await loadDrawTypes();
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday
  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  
  console.log(`📅 Prédictions pour ${dayNames[dayOfWeek]} ${today.toLocaleDateString('fr-FR')}`);
  console.log('');
  
  // Generate predictions for popular draw types
  const popularTypes = drawTypes.filter(t => 
    ['National', 'Fortune', 'Reveil', 'Etoile', 'Akwaba', 'Diamant'].includes(t.name)
  );
  
  if (popularTypes.length === 0) {
    console.log('⚠️ No draw types found. Using all types...');
    popularTypes.push(...drawTypes.slice(0, 6));
  }
  
  const allResults = [];
  
  for (const drawType of popularTypes) {
    console.log(`\n🎰 ${drawType.name}`);
    console.log('─'.repeat(40));
    
    const draws = await loadDrawData(drawType.id);
    
    if (draws.length === 0) {
      console.log('   Pas de données disponibles');
      continue;
    }
    
    // Calculate scores
    const scores = scoreNumbers(draws, dayOfWeek);
    const sumStats = calculateSumStats(draws);
    const lastSeen = calculateLastSeen(draws);
    const freq = calculateNumberFrequency(draws);
    
    // Generate predictions
    const predictions = generatePrediction(scores, sumStats, 5);
    
    // Generate alerts
    const alerts = generateAlerts(draws, lastSeen, freq);
    
    // Store predictions
    await storePredictions(predictions, drawType.id, drawType.name);
    
    // Display predictions
    console.log('\n   🔮 PRÉDICTIONS:');
    predictions.forEach((pred, i) => {
      const stars = '⭐'.repeat(Math.min(5, Math.floor(pred.confidence / 20)));
      console.log(`   ${i + 1}. [${pred.numbers.join(' - ')}]  Confiance: ${pred.confidence}% ${stars}`);
      console.log(`      Somme: ${pred.sum}  |  Stratégie: ${pred.strategy}`);
    });
    
    // Display top alerts
    const topAlerts = alerts.filter(a => a.severity === 'high').slice(0, 3);
    if (topAlerts.length > 0) {
      console.log('\n   🚨 ALERTES:');
      topAlerts.forEach(alert => {
        console.log(`   • ${alert.message}`);
      });
    }
    
    allResults.push({
      drawType: drawType.name,
      predictions,
      alerts: topAlerts
    });
  }
  
  // Summary
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 RÉSUMÉ DES NUMÉROS RECOMMANDÉS');
  console.log('═'.repeat(60));
  
  // Aggregate most recommended numbers across all types
  const numberRecommendations = {};
  for (const result of allResults) {
    for (const pred of result.predictions) {
      for (const num of pred.numbers) {
        numberRecommendations[num] = (numberRecommendations[num] || 0) + 1;
      }
    }
  }
  
  const topRecommended = Object.entries(numberRecommendations)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  console.log('\n🌟 Top 10 numéros les plus recommandés (tous tirages confondus):');
  console.log('   ' + topRecommended.map(([num]) => num).join(' - '));
  
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('✅ Prédictions stockées dans la base de données');
  console.log('⚠️  Rappel: Les jeux de hasard restent aléatoires!');
  console.log('═'.repeat(60));
  
  return allResults;
}

// Export for use in dashboard
export {
    calculateLastSeen, calculateNumberFrequency, calculateSumStats, generateAlerts, generateAllPredictions, generatePrediction, loadDrawData,
    scoreNumbers
};

// Run if called directly
const isMain = process.argv[1]?.endsWith('predictor.js');
if (isMain) {
  generateAllPredictions().catch(console.error);
}
