import { analyzeCycles } from './advanced-analyzer.js';
import { extractNumbers, strategies } from './backtester.js';
import supabase from './supabase-client.js';

// Default State
const defaultBrain = {
  version: 1,
  lastTuned: null,
  weights: {
    hot: 0.15,
    due: 0.15,
    correlation: 0.15,
    position: 0.10,
    balanced: 0.10,
    statistical: 0.20,
    finales: 0.10,
    lstm: 0.15
  },
  stats: {
    totalDraws: 0,
    totalHits: 0,
    globalAccuracy: 0,
    byType: {}
  },
  history: [],
  lastAnalyzedDraw: [] 
};

// In-memory cache
let brainCache = {
  winning: null,
  machine: null
};

export async function loadBrain(type = 'winning') {
  // Try memory cache first
  if (brainCache[type]) return brainCache[type];
  
  try {
    const { data, error } = await supabase
      .from('ai_memory')
      .select('data')
      .eq('id', type)
      .single();
      
    if (data && data.data) {
      const brainData = data.data;
      
      // MIGRATION LOGIC (On load from DB)
      if (!brainData.stats) {
          brainData.stats = { totalDraws: 0, totalHits: 0, globalAccuracy: 0, byType: {} };
      }
      
      // Ensure weights exist
      let weightsChanged = false;
      for (const key in defaultBrain.weights) {
        if (brainData.weights && brainData.weights[key] === undefined) {
          brainData.weights[key] = defaultBrain.weights[key];
          weightsChanged = true;
        }
      }
      
      if (weightsChanged) {
         // Normalize
         const sum = Object.values(brainData.weights).reduce((a, b) => a + b, 0);
         for (const key in brainData.weights) {
            brainData.weights[key] = parseFloat((brainData.weights[key] / sum).toFixed(2));
         }
      }
      
      brainCache[type] = brainData;
      return brainData;
    }
  } catch (e) {
    console.error(`Error loading brain (${type}):`, e.message);
  }
  
  // Return default if no DB entry or error
  return JSON.parse(JSON.stringify(defaultBrain));
}

export async function saveBrain(data, type = 'winning') {
  // Update cache
  brainCache[type] = data;
  
  // Persist to DB
  try {
    const { error } = await supabase
      .from('ai_memory')
      .upsert({ 
        id: type, 
        data: data,
        updated_at: new Date()
      });
      
    if (error) console.error(`Failed to save brain (${type}):`, error.message);
  } catch (e) {
    console.error(`Error saving brain (${type}):`, e.message);
  }
}

// Sync function for compatibility (returns cache or default, triggers async load)
export function getWeights(type = 'winning') {
  if (brainCache[type]) return brainCache[type].weights;
  // If not loaded, trigger load and return default for now
  loadBrain(type).catch(console.error);
  return defaultBrain.weights;
}

/**
 * Shared scoring logic used by both Server (prediction) and Brain (learning)
 */
export function calculateNumberScores(draws, weights, type = 'winning', externalScores = {}) {
  // Pre-calculate needed analysis
  const cycles = analyzeCycles(draws, type);
  
  const numberScores = {};
  const strategyVotes = {}; // Track consensus
  
  for (let i = 1; i <= 90; i++) {
      numberScores[i] = 0;
      strategyVotes[i] = 0;
  }
  
  const addVote = (num) => {
      const n = parseInt(num);
      strategyVotes[n] = (strategyVotes[n] || 0) + 1;
  };
  
  // 1. Cycle-based (Due)
  const dueNumbers = Object.entries(cycles)
    .filter(([_, stats]) => stats.cycleCount >= 5)
    .sort((a, b) => b[1].dueScore - a[1].dueScore)
    .slice(0, 15);
  
  dueNumbers.forEach(([num, stats], idx) => {
    // Normalization: dueScore is capped at 200 in analyzer.
    // We dampen it slightly so it doesn't purely dominate.
    const score = weights.due * (15 - idx) / 15 * (Math.min(stats.dueScore, 150) / 150);
    numberScores[parseInt(num)] += score;
    if (idx < 5) addVote(num); // Top 5
  });
  
  // 2. Hot Numbers
  const hotNumbers = strategies.hot(draws, 15, type);
  hotNumbers.forEach((num, idx) => {
    numberScores[num] += weights.hot * (15 - idx) / 15;
    if (idx < 5) addVote(num);
  });
  
  // 3. Position-based
  const positionNumbers = strategies.position(draws, type);
  positionNumbers.forEach((num, idx) => {
    numberScores[num] += (weights.position * 2.0); 
    if (idx < 5) addVote(num);
  });
  
  // 4. Correlation-based
  const correlationNumbers = strategies.correlation(draws, 15, type);
  correlationNumbers.forEach((num, idx) => {
    const boost = (weights.correlation || 0.1);
    numberScores[num] += boost * (15 - idx) / 15;
    if (idx < 5) addVote(num);
  });
  
  // 5. Balanced
  const balancedNumbers = strategies.balanced(draws, 15, type);
  balancedNumbers.forEach((num, idx) => {
    let multiplier = 3.0; // Base boost
    if (idx >= 5) {
        multiplier = 1.0 + (2.0 * (15-idx)/10); 
    }
    numberScores[num] += (weights.balanced * multiplier);
    if (idx < 5) addVote(num);
  });
  
  // 6. Statistical
  const statisticalNumbers = strategies.statistical(draws, 15, type);
  statisticalNumbers.forEach((num, idx) => {
    const boost = (weights.statistical || 0.1);
    numberScores[num] += boost * (15 - idx) / 15;
    if (idx < 5) addVote(num);
  });
  
  // 7. Last Digits (Finales)
  const finalesNumbers = strategies.finales(draws, 15, type);
  finalesNumbers.forEach((num, idx) => {
    const boost = (weights.finales || 0.1);
    numberScores[num] += boost * (15 - idx) / 15;
    if (idx < 5) addVote(num);
  });
  
  // 8. Deep Learning (LSTM) - New
  if (externalScores.lstm && externalScores.lstm.length > 0) {
      externalScores.lstm.forEach((num, idx) => {
          const boost = (weights.lstm || 0.15);
          numberScores[num] += boost * (15 - idx) / 15;
          if (idx < 5) addVote(num);
      });
  }
  
  // 9. Tactical Neighbors (Heat Zone)
  // Redistribute some score from top candidates to their neighbors (±1)
  
  // Get current top candidates (score > 0)
  const topCandidates = Object.entries(numberScores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15) // Focus on top 15
    .map(([num]) => parseInt(num));
    
  const NEIGHBOR_WEIGHT = 0.15; // 15% redistribution
  
  topCandidates.forEach(num => {
    const currentScore = numberScores[num];
    const bonus = currentScore * NEIGHBOR_WEIGHT;
    
    // Apply to neighbors (handling 1-90 boundaries)
    const neighbors = [];
    if (num > 1) neighbors.push(num - 1);
    if (num < 90) neighbors.push(num + 1);
    
    neighbors.forEach(neighbor => {
        numberScores[neighbor] += bonus;
    });
  });
  
  // 9. SYNERGY BOOST (Consensus Amplifier)
  // If multiple independent strategies recommend a number, it deserves a non-linear boost.
  for (let i = 1; i <= 90; i++) {
      const votes = strategyVotes[i];
      
      // Multi-Strategy Consensus Boost
      if (votes >= 5) {
          numberScores[i] *= 1.20; // 20% Boost for Strong Consensus (5+ strategies agree)
      } else if (votes >= 3) {
          numberScores[i] *= 1.10; // 10% Boost for Moderate Consensus (3+ strategies agree)
      }
      
      // Anti-Synergy Check: High score but 0 votes? (Means only one strategy gave huge score but missed Top 5 in others?)
      // Penalize "Lone Wolf" high scores likely to be statistical outliers.
      if (votes === 0 && numberScores[i] > 2.0) {
          numberScores[i] *= 0.85; 
      }
  }
  
  return numberScores;
}

export async function learn(actualDraw, allDraws, drawTypeId = null, type = 'winning') {
  console.log(`🧠 Brain Learning Process Started (Type: ${drawTypeId || 'Global'}, Target: ${type})...`);
  const brain = await loadBrain(type);
  let weights = { ...brain.weights };
  
  // Convert actualDraw to numbers
  actualDraw = actualDraw.map(n => parseInt(n));
  
  // Prepare Training Data (All draws EXCEPT the one we are learning from)
  const trainingData = allDraws.filter(d => {
      const drawn = extractNumbers(d, type);
      // Skip if identical to the one we are predicting (to avoid data leakage)
      const isSame = drawn.every(n => actualDraw.includes(n));
      return !isSame;
  });

  // 1. Evaluate Ensemble Performance (Global Score) using rules BEFORE update
  const scores = calculateNumberScores(trainingData, weights, type);
  
  // Pick top 5 predictions of the ensemble
  const top5 = Object.entries(scores)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n]) => parseInt(n));
      
  const globalMatches = top5.filter(n => actualDraw.includes(n)).length;
  
  // Update Global Stats
  brain.stats.totalDraws = (brain.stats.totalDraws || 0) + 1;
  brain.stats.totalHits = (brain.stats.totalHits || 0) + globalMatches;
  // Accuracy = Percentage of numbers found (max 5 per draw)
  brain.stats.globalAccuracy = (brain.stats.totalHits / (brain.stats.totalDraws * 5)) * 100;
  
  // Update Per-Type Stats
  if (drawTypeId) {
      if (!brain.stats.byType) brain.stats.byType = {};
      if (!brain.stats.byType[drawTypeId]) {
          brain.stats.byType[drawTypeId] = { totalDraws: 0, totalHits: 0, accuracy: 0 };
      }
      const typeStats = brain.stats.byType[drawTypeId];
      typeStats.totalDraws++;
      typeStats.totalHits += globalMatches;
      typeStats.accuracy = (typeStats.totalHits / (typeStats.totalDraws * 5)) * 100;
  }
  
  console.log(`🧠 Prediction for this draw: [${top5.join(', ')}] matched ${globalMatches}/5`);

  // 2. Individual Strategy Scoring (for Weight Tuning)
  // Note: We use synchronous strategies here (which is fine)
  const predictions = {
    hot: strategies.hot(trainingData, 10, type),
    due: strategies.due(trainingData, 10, type),
    correlation: strategies.correlation(trainingData, 10, type),
    position: strategies.position(trainingData, type),
    balanced: strategies.balanced(trainingData, 10, type),
    statistical: strategies.statistical(trainingData, 10, type),
    finales: strategies.finales(trainingData, 10, type)
  };
  
  const stratScores = {};
  for (const [strategy, preds] of Object.entries(predictions)) {
    let score = 0;
    preds.forEach(n => {
        if (actualDraw.includes(n)) {
            score += 1.0; // Exact Match
        } else if (actualDraw.some(actual => Math.abs(actual - n) === 1)) {
            score += 0.25; // Near Miss (Neighbor)
        }
    });
    stratScores[strategy] = score;
  }
  
  // 3. Adjust Weights (Reinforcement Learning)
  const LEARNING_RATE = 0.05; 
  
  for (const strategy in weights) {
    if (strategy === 'lstm') continue; // Skip LSTM tuning (handled externally)
    
    const score = stratScores[strategy] || 0;
    
    if (score >= 3) {
       weights[strategy] += (LEARNING_RATE * 2); 
    } else if (score >= 1) {
       weights[strategy] += LEARNING_RATE; 
    } else {
       weights[strategy] -= (LEARNING_RATE * 0.5); 
    }
    
    weights[strategy] = Math.max(0.05, Math.min(0.60, weights[strategy]));
  }
  
  // Normalize
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key in weights) {
    weights[key] = parseFloat((weights[key] / sum).toFixed(2));
  }
  
  // Save
  brain.lastTuned = new Date().toISOString();
  brain.lastAnalyzedDraw = actualDraw;
  brain.weights = weights;
  
  if (!brain.history) brain.history = [];
  brain.history.push({
    date: new Date().toISOString(),
    draw: actualDraw,
    scores: stratScores,
    globalMatch: globalMatches,
    newWeights: {...weights}
  });
  
  if (brain.history.length > 50) brain.history.shift(); 
  
  await saveBrain(brain, type);
  return weights;
}

export async function getBrainStatus(type = 'winning') {
  return await loadBrain(type);
}

export default { getWeights, learn, getBrainStatus, calculateNumberScores, loadBrain, saveBrain };
