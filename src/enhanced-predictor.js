/**
 * Enhanced Predictor
 * 
 * Combines multiple prediction strategies:
 * - Statistical analysis (cycles, gaps, positions)
 * - Backtest-validated strategies
 * - LSTM neural network predictions
 * 
 * Produces weighted ensemble predictions with confidence scores.
 */

import { analyzeCycles } from './advanced-analyzer.js';
import { strategies } from './backtester.js';
import { predictWithLSTM } from './lstm-predictor.js';
import supabase from './supabase-client.js';

// =============================================================================
// STRATEGY WEIGHTS (based on backtest results)
// =============================================================================

const STRATEGY_WEIGHTS = {
  lstm: 0.25,        // Neural network
  cycles: 0.20,      // Cycle-based (due numbers)
  hot: 0.15,         // Hot numbers
  position: 0.15,    // Position-based
  correlation: 0.10, // Pair correlations
  balanced: 0.10,    // Decade balance
  mixed: 0.05        // Mixed strategy
};

// =============================================================================
// ENSEMBLE PREDICTION
// =============================================================================

/**
 * Generate ensemble prediction combining all strategies
 */
async function generateEnsemblePrediction(draws, dayOfWeek = null) {
  console.log('🎯 Generating Ensemble Prediction...');
  console.log('');
  
  const predictions = {};
  const numberScores = {};
  
  // Initialize scores for all numbers
  for (let i = 1; i <= 90; i++) {
    numberScores[i] = 0;
  }
  
  // ===========================================
  // Strategy 1: LSTM Neural Network
  // ===========================================
  console.log('   1️⃣ LSTM Neural Network...');
  try {
    const lstmPrediction = await predictWithLSTM(draws, 10);
    if (lstmPrediction) {
      predictions.lstm = lstmPrediction;
      
      // Add weighted scores
      lstmPrediction.topProbabilities.forEach((item, idx) => {
        const weight = STRATEGY_WEIGHTS.lstm * (10 - idx) / 10;
        numberScores[item.number] += weight * (item.probability / 100);
      });
      
      console.log(`      ✓ Top picks: ${lstmPrediction.numbers.join(', ')}`);
    } else {
      console.log('      ⚠ LSTM not available (train with: npm run train-lstm)');
    }
  } catch (e) {
    console.log('      ⚠ LSTM error:', e.message);
  }
  
  // ===========================================
  // Strategy 2: Cycle Analysis (Due Numbers)
  // ===========================================
  console.log('   2️⃣ Cycle Analysis (Due Numbers)...');
  const cycles = analyzeCycles(draws);
  const dueNumbers = Object.entries(cycles)
    .filter(([_, stats]) => stats.cycleCount >= 5)
    .sort((a, b) => b[1].dueScore - a[1].dueScore)
    .slice(0, 15);
  
  predictions.cycles = {
    numbers: dueNumbers.slice(0, 5).map(([n]) => parseInt(n)).sort((a, b) => a - b),
    scores: dueNumbers.map(([n, stats]) => ({ number: parseInt(n), dueScore: stats.dueScore }))
  };
  
  dueNumbers.forEach(([num, stats], idx) => {
    const weight = STRATEGY_WEIGHTS.cycles * (15 - idx) / 15;
    numberScores[parseInt(num)] += weight * (stats.dueScore / 200);
  });
  
  console.log(`      ✓ Due numbers: ${predictions.cycles.numbers.join(', ')}`);
  
  // ===========================================
  // Strategy 3: Hot Numbers
  // ===========================================
  console.log('   3️⃣ Hot Numbers...');
  const hotNumbers = strategies.hot(draws, 15);
  predictions.hot = { numbers: hotNumbers.slice(0, 5) };
  
  hotNumbers.forEach((num, idx) => {
    const weight = STRATEGY_WEIGHTS.hot * (15 - idx) / 15;
    numberScores[num] += weight;
  });
  
  console.log(`      ✓ Hot numbers: ${predictions.hot.numbers.join(', ')}`);
  
  // ===========================================
  // Strategy 4: Position-Based
  // ===========================================
  console.log('   4️⃣ Position Analysis...');
  const positionNumbers = strategies.position(draws);
  predictions.position = { numbers: positionNumbers };
  
  positionNumbers.forEach((num, idx) => {
    const weight = STRATEGY_WEIGHTS.position;
    numberScores[num] += weight;
  });
  
  console.log(`      ✓ Position-based: ${predictions.position.numbers.join(', ')}`);
  
  // ===========================================
  // Strategy 5: Correlation-Based
  // ===========================================
  console.log('   5️⃣ Correlation Analysis...');
  const correlationNumbers = strategies.correlation(draws, 10);
  predictions.correlation = { numbers: correlationNumbers.slice(0, 5) };
  
  correlationNumbers.forEach((num, idx) => {
    const weight = STRATEGY_WEIGHTS.correlation * (10 - idx) / 10;
    numberScores[num] += weight;
  });
  
  console.log(`      ✓ Correlated numbers: ${predictions.correlation.numbers.join(', ')}`);
  
  // ===========================================
  // Strategy 6: Balanced (Decade Distribution)
  // ===========================================
  console.log('   6️⃣ Balanced Decades...');
  const balancedNumbers = strategies.balanced(draws, 5);
  predictions.balanced = { numbers: balancedNumbers };
  
  balancedNumbers.forEach((num) => {
    numberScores[num] += STRATEGY_WEIGHTS.balanced;
  });
  
  console.log(`      ✓ Balanced picks: ${predictions.balanced.numbers.join(', ')}`);
  
  // ===========================================
  // Combine Scores and Generate Final Prediction
  // ===========================================
  console.log('');
  console.log('   📊 Computing ensemble scores...');
  
  // Sort by combined score
  const rankedNumbers = Object.entries(numberScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);
  
  // Top candidates
  const topCandidates = rankedNumbers.slice(0, 20);
  
  // Select final 5 ensuring good decade distribution
  const finalPicks = selectBalancedNumbers(topCandidates, 5);
  
  // Calculate confidence
  const totalPossibleScore = Object.values(STRATEGY_WEIGHTS).reduce((a, b) => a + b, 0);
  const avgScore = finalPicks.reduce((sum, n) => sum + n.score, 0) / 5;
  const confidence = Math.min(95, (avgScore / totalPossibleScore) * 100 + 30);
  
  // Calculate sum
  const sum = finalPicks.reduce((s, n) => s + n.number, 0);
  
  const ensemblePrediction = {
    numbers: finalPicks.map(n => n.number).sort((a, b) => a - b),
    confidence: parseFloat(confidence.toFixed(1)),
    sum,
    scores: finalPicks,
    strategies: predictions,
    topCandidates: topCandidates.slice(0, 15),
    generatedAt: new Date().toISOString()
  };
  
  console.log('');
  console.log('═'.repeat(50));
  console.log('🎯 ENSEMBLE PREDICTION');
  console.log('═'.repeat(50));
  console.log('');
  console.log(`   Numbers: ${ensemblePrediction.numbers.join(' - ')}`);
  console.log(`   Sum: ${sum}`);
  console.log(`   Confidence: ${ensemblePrediction.confidence}%`);
  console.log('');
  console.log('   Top 10 Candidates:');
  topCandidates.slice(0, 10).forEach((n, i) => {
    console.log(`   ${(i + 1).toString().padStart(2)}. ${n.number.toString().padStart(2)} (score: ${n.score.toFixed(3)})`);
  });
  
  return ensemblePrediction;
}

/**
 * Select numbers ensuring decent decade distribution
 */
function selectBalancedNumbers(candidates, count) {
  const selected = [];
  const decadesUsed = new Set();
  
  // First pass: try to get numbers from different decades
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    
    const decade = Math.floor((candidate.number - 1) / 10);
    
    // Allow up to 2 numbers per decade
    const decadeCount = selected.filter(n => Math.floor((n.number - 1) / 10) === decade).length;
    if (decadeCount < 2) {
      selected.push(candidate);
      decadesUsed.add(decade);
    }
  }
  
  // Second pass: fill remaining slots
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (!selected.find(s => s.number === candidate.number)) {
      selected.push(candidate);
    }
  }
  
  return selected.slice(0, count);
}

// =============================================================================
// ALTERNATIVE PREDICTIONS
// =============================================================================

/**
 * Generate multiple alternative predictions for variety
 */
async function generateAlternatives(draws, mainPrediction) {
  const alternatives = [];
  
  // Alternative 1: Pure Hot Numbers
  alternatives.push({
    name: 'Numéros Chauds',
    icon: '🔥',
    numbers: strategies.hot(draws, 5),
    description: 'Basé uniquement sur la fréquence'
  });
  
  // Alternative 2: Pure Due Numbers
  const cycles = analyzeCycles(draws);
  const dueNumbers = Object.entries(cycles)
    .filter(([_, stats]) => stats.cycleCount >= 5)
    .sort((a, b) => b[1].dueScore - a[1].dueScore)
    .slice(0, 5)
    .map(([n]) => parseInt(n))
    .sort((a, b) => a - b);
  
  alternatives.push({
    name: 'Numéros En Retard',
    icon: '⏰',
    numbers: dueNumbers,
    description: 'Basé sur les cycles de retour'
  });
  
  // Alternative 3: Contrarian (Cold + Due)
  const coldNumbers = strategies.hot(draws, 90).slice(-10);
  const contrarian = coldNumbers.slice(0, 3).concat(dueNumbers.slice(0, 2)).sort((a, b) => a - b).slice(0, 5);
  
  alternatives.push({
    name: 'Stratégie Contrariante',
    icon: '🔄',
    numbers: contrarian,
    description: 'Numéros froids + en retard'
  });
  
  // Alternative 4: Balanced
  alternatives.push({
    name: 'Équilibre Décades',
    icon: '⚖️',
    numbers: strategies.balanced(draws, 5),
    description: 'Distribution équilibrée par décade'
  });
  
  return alternatives;
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  console.log('🎰 ENHANCED PREDICTION SYSTEM');
  console.log('═'.repeat(50));
  console.log('');
  
  // Load draws
  console.log('📊 Loading historical data...');
  const { data: draws, error } = await supabase
    .from('draws')
    .select('*')
    .order('draw_date', { ascending: true });
  
  if (error || !draws || draws.length === 0) {
    console.error('Error loading draws:', error);
    return;
  }
  
  console.log(`   Loaded ${draws.length} draws`);
  console.log('');
  
  // Generate ensemble prediction
  const prediction = await generateEnsemblePrediction(draws);
  
  // Generate alternatives
  console.log('');
  console.log('🔄 Generating alternatives...');
  const alternatives = await generateAlternatives(draws, prediction);
  
  console.log('');
  console.log('═'.repeat(50));
  console.log('📋 ALTERNATIVES');
  console.log('═'.repeat(50));
  
  for (const alt of alternatives) {
    console.log(`   ${alt.icon} ${alt.name}: ${alt.numbers.join(' - ')}`);
    console.log(`      ${alt.description}`);
  }
  
  console.log('');
  console.log('✅ Prediction complete!');
  
  return { main: prediction, alternatives };
}

// Run if executed directly
if (process.argv[1].includes('enhanced-predictor')) {
  main().catch(console.error);
}

export { generateAlternatives, generateEnsemblePrediction };
export default { generateEnsemblePrediction, generateAlternatives };
