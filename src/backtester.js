/**
 * Backtesting Module
 * 
 * Tests prediction strategies against historical data to measure accuracy
 * and identify the best performing approaches.
 */

import { analyzeCorrelations, analyzeCycles, analyzePositions } from './advanced-analyzer.js';
import supabase from './supabase-client.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract numbers from a draw based on type (winning or machine)
 * @param {Object} draw - The draw object
 * @param {string} type - 'winning' or 'machine'
 * @returns {number[]} Array of 5 numbers
 */
export function extractNumbers(draw, type = 'winning') {
  const prefix = type === 'machine' ? 'machine_number_' : 'winning_number_';
  return [
    draw[`${prefix}1`],
    draw[`${prefix}2`],
    draw[`${prefix}3`],
    draw[`${prefix}4`],
    draw[`${prefix}5`]
  ].filter(n => n !== null && n !== undefined).map(n => parseInt(n));
}

/**
 * Calculate Lift score for number pairs (co-occurrence analysis)
 * Lift > 1 means numbers appear together more than expected by chance
 */
function calculateLift(rawDraws) {
  const totalDraws = rawDraws.length;
  if (totalDraws === 0) return {};
  
  const freq = {};
  const pairFreq = {};
  
  for (let i = 1; i <= 90; i++) freq[i] = 0;
  
  for (const draw of rawDraws) {
    for (const n of draw) {
      if (n) freq[n]++;
    }
    // Count pairs
    for (let i = 0; i < draw.length; i++) {
      for (let j = i + 1; j < draw.length; j++) {
        const key = [draw[i], draw[j]].sort((a, b) => a - b).join('-');
        pairFreq[key] = (pairFreq[key] || 0) + 1;
      }
    }
  }
  
  const lifts = {};
  for (const [key, count] of Object.entries(pairFreq)) {
    const [a, b] = key.split('-').map(Number);
    const pA = freq[a] / totalDraws;
    const pB = freq[b] / totalDraws;
    const pAB = count / totalDraws;
    const lift = (pA * pB > 0) ? pAB / (pA * pB) : 0;
    lifts[key] = { a, b, lift };
  }
  
  return lifts;
}

/**
 * Calculate follower probabilities (what numbers tend to appear after a given number)
 */
function calculateFollowers(rawDraws) {
  const followers = {};
  
  for (let i = 1; i < rawDraws.length; i++) {
    const prevDraw = rawDraws[i - 1];
    const currentDraw = rawDraws[i];
    
    for (const anchor of prevDraw) {
      if (!followers[anchor]) followers[anchor] = {};
      for (const follow of currentDraw) {
        followers[anchor][follow] = (followers[anchor][follow] || 0) + 1;
      }
    }
  }
  
  // Convert to probability format
  const result = {};
  for (const [anchor, follows] of Object.entries(followers)) {
    const total = Object.values(follows).reduce((a, b) => a + b, 0);
    result[anchor] = Object.entries(follows)
      .map(([num, count]) => ({ number: parseInt(num), probability: count / total }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 10);
  }
  
  return result;
}

/**
 * Analyze last digit (finale) patterns
 */
function analyzeLastDigits(draws, type = 'winning') {
  const finaleStats = {};
  for (let f = 0; f <= 9; f++) {
    finaleStats[f] = { finale: f, count: 0, lastSeen: 0, gap: 0, dueScore: 0, percentage: 0 };
  }
  
  let totalNumbers = 0;
  for (let idx = 0; idx < draws.length; idx++) {
    const nums = extractNumbers(draws[idx], type);
    for (const n of nums) {
      if (n) {
        const finale = n % 10;
        finaleStats[finale].count++;
        finaleStats[finale].lastSeen = idx;
        totalNumbers++;
      }
    }
  }
  
  // Calculate percentages and due scores
  for (let f = 0; f <= 9; f++) {
    finaleStats[f].percentage = totalNumbers > 0 ? (finaleStats[f].count / totalNumbers) * 100 : 0;
    finaleStats[f].gap = draws.length - finaleStats[f].lastSeen;
    finaleStats[f].dueScore = finaleStats[f].gap / Math.max(1, finaleStats[f].count / draws.length);
  }
  
  return finaleStats;
}

// =============================================================================
// PREDICTION STRATEGIES
// =============================================================================

/**
 * Strategy 1: Hot Numbers - Pick the most frequent numbers
 */
function strategyHotNumbers(draws, count = 5, type = 'winning') {
  const freq = {};
  for (let i = 1; i <= 90; i++) freq[i] = 0;
  
  for (const draw of draws) {
    extractNumbers(draw, type).forEach(n => {
      if (n) freq[n]++;
    });
  }
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([n]) => parseInt(n))
    .sort((a, b) => a - b);
}

/**
 * Strategy 2: Due Numbers - Pick numbers that are overdue based on cycle analysis
 */
function strategyDueNumbers(draws, count = 5, type = 'winning') {
  const cycles = analyzeCycles(draws, type);
  
  return Object.entries(cycles)
    .filter(([_, stats]) => stats.cycleCount >= 3) // Only consider numbers with history
    .sort((a, b) => b[1].dueScore - a[1].dueScore)
    .slice(0, count)
    .map(([n]) => parseInt(n))
    .sort((a, b) => a - b);
}

/**
 * Strategy 3: Position-Based - Pick top numbers for each position
 */
function strategyPositionBased(draws, type = 'winning') {
  const positions = analyzePositions(draws, type);
  const selected = [];
  
  for (let pos = 1; pos <= 5; pos++) {
    if (positions[pos]?.top10?.length > 0) {
      // Pick the most frequent number for this position that's not already selected
      for (const candidate of positions[pos].top10) {
        if (!selected.includes(candidate.number)) {
          selected.push(candidate.number);
          break;
        }
      }
    }
  }
  
  // Fill remaining with hot numbers if needed
  if (selected.length < 5) {
    const freq = {};
    for (let i = 1; i <= 90; i++) freq[i] = 0;
    for (const draw of draws) {
      extractNumbers(draw, type).forEach(n => {
        if (n) freq[n]++;
      });
    }
    
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => parseInt(n));
    
    for (const num of sorted) {
      if (!selected.includes(num) && selected.length < 5) {
        selected.push(num);
      }
    }
  }
  
  return selected.sort((a, b) => a - b);
}

/**
 * Strategy 4: Mixed - Combine hot and due numbers
 */
function strategyMixed(draws, count = 5, type = 'winning') {
  const hotNumbers = strategyHotNumbers(draws, 20, type);
  const dueNumbers = strategyDueNumbers(draws, 20, type);
  
  // Alternate between hot and due
  const selected = [];
  for (let i = 0; i < 10 && selected.length < count; i++) {
    if (i % 2 === 0 && hotNumbers[Math.floor(i/2)]) {
      const num = hotNumbers[Math.floor(i/2)];
      if (!selected.includes(num)) selected.push(num);
    } else if (dueNumbers[Math.floor(i/2)]) {
      const num = dueNumbers[Math.floor(i/2)];
      if (!selected.includes(num)) selected.push(num);
    }
  }
  
  return selected.sort((a, b) => a - b);
}

/**
 * Strategy 5: Correlation-Based - Pick numbers that often appear together
 */
function strategyCorrelationBased(draws, count = 5, type = 'winning') {
  const { topPairs } = analyzeCorrelations(draws, type);
  const selected = new Set();
  
  for (const pair of topPairs) {
    for (const num of pair.numbers) {
      selected.add(num);
      if (selected.size >= count) break;
    }
    if (selected.size >= count) break;
  }
  
  return [...selected].slice(0, count).sort((a, b) => a - b);
}

/**
 * Strategy 6: Balanced - Ensure good decade distribution
 */
function strategyBalanced(draws, count = 5, type = 'winning') {
  const freq = {};
  for (let i = 1; i <= 90; i++) freq[i] = 0;
  
  for (const draw of draws) {
    extractNumbers(draw, type).forEach(n => {
      if (n) freq[n]++;
    });
  }
  
  // Group by decade
  const decades = {};
  for (let i = 0; i < 9; i++) {
    decades[i] = [];
    const start = i === 0 ? 1 : i * 10;
    const end = i === 0 ? 9 : Math.min(i * 10 + 9, 90);
    
    for (let n = start; n <= end; n++) {
      decades[i].push({ number: n, freq: freq[n] });
    }
    decades[i].sort((a, b) => b.freq - a.freq);
  }
  
  // Pick one from each of 5 different decades
  const selected = [];
  const decadeOrder = [2, 3, 4, 5, 1, 6, 7, 0, 8]; // Prioritize middle decades
  
  for (const decade of decadeOrder) {
    if (selected.length >= count) break;
    if (decades[decade]?.length > 0) {
      const num = decades[decade][0].number;
      if (!selected.includes(num)) {
        selected.push(num);
      }
    }
  }
  
  return selected.sort((a, b) => a - b);
}

/**
 * Strategy 7: Last Digits (Finales) - Pick numbers from high-probability finales
 */
function strategyLastDigits(draws, count = 5, type = 'winning') {
  const finaleStats = analyzeLastDigits(draws, type);
  
  // Rank finales based on a combination of frequency and "due" score
  const prioritizedFinales = Object.values(finaleStats)
    .sort((a, b) => (b.dueScore * 0.6 + b.percentage * 0.4) - (a.dueScore * 0.6 + a.percentage * 0.4))
    .slice(0, 3) // Top 3 finales
    .map(f => parseInt(f.finale));
  
  // Collect all numbers belonging to these finales
  const candidates = [];
  for (let n = 1; n <= 90; n++) {
    if (prioritizedFinales.includes(n % 10)) {
      candidates.push(n);
    }
  }
  
  // Sort candidates by global frequency (to pick the "best" of those finales)
  const freq = {};
  for (const draw of draws) {
    extractNumbers(draw, type).forEach(num => {
      if (candidates.includes(num)) freq[num] = (freq[num] || 0) + 1;
    });
  }
  
  return candidates
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0))
    .slice(0, count)
    .sort((a, b) => a - b);
}

/**
 * Strategy 8: Statistical - Use Co-occurrence Lift and Follower Probability
 */
function strategyStatistical(draws, count = 5, type = 'winning') {
  const numberScores = {};
  for (let i = 1; i <= 90; i++) numberScores[i] = 0;

  const rawDraws = draws.map(d => extractNumbers(d, type));
  const lifts = calculateLift(rawDraws);
  const followers = calculateFollowers(rawDraws);

  // 1. Scoring based on Lift (Current co-occurrence patterns)
  // We check the last draw and see if its numbers have high lift pairs
  if (rawDraws.length > 0) {
    const lastDraw = rawDraws[rawDraws.length - 1];
    Object.values(lifts).forEach(l => {
      if (lastDraw.includes(l.a)) numberScores[l.b] += (l.lift - 1) * 2;
      if (lastDraw.includes(l.b)) numberScores[l.a] += (l.lift - 1) * 2;
    });

    // 2. Scoring based on Followers (Sequential patterns)
    lastDraw.forEach(anchor => {
      if (followers[anchor]) {
        followers[anchor].forEach(f => {
          numberScores[f.number] += (f.probability * 5);
        });
      }
    });
  }

  return Object.entries(numberScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([n]) => parseInt(n))
    .sort((a, b) => a - b);
}

// =============================================================================
// BACKTESTING ENGINE
// =============================================================================

/**
 * Calculate match score between prediction and actual result
 */
function calculateMatchScore(prediction, actual) {
  const actualSet = new Set(actual);
  let matches = 0;
  
  for (const num of prediction) {
    if (actualSet.has(num)) matches++;
  }
  
  return {
    matches,
    total: 5,
    percentage: (matches / 5) * 100,
    isWin: matches >= 3, // Consider 3+ matches as a "win"
    isJackpot: matches === 5
  };
}

/**
 * Run backtest for a single strategy
 */
function backtestStrategy(draws, strategyFn, strategyName, trainingWindow = 100) {
  const results = {
    strategyName,
    totalTests: 0,
    totalMatches: 0,
    wins: 0, // 3+ matches
    jackpots: 0, // 5 matches
    avgMatchPercentage: 0,
    matchDistribution: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    bestPrediction: null,
    worstPrediction: null
  };
  
  // We need at least trainingWindow draws before we can start testing
  if (draws.length <= trainingWindow) {
    return results;
  }
  
  const matchScores = [];
  
  for (let i = trainingWindow; i < draws.length; i++) {
    // Use draws up to index i as training data
    const trainingData = draws.slice(0, i);
    
    // Generate prediction
    const prediction = strategyFn(trainingData, 5);
    
    // Get actual result
    const actualDraw = draws[i];
    const actual = [
      actualDraw.winning_number_1, actualDraw.winning_number_2,
      actualDraw.winning_number_3, actualDraw.winning_number_4,
      actualDraw.winning_number_5
    ].filter(n => n);
    
    // Calculate score
    const score = calculateMatchScore(prediction, actual);
    matchScores.push(score.matches);
    
    results.totalTests++;
    results.totalMatches += score.matches;
    results.matchDistribution[score.matches]++;
    
    if (score.isWin) results.wins++;
    if (score.isJackpot) results.jackpots++;
    
    // Track best/worst
    if (!results.bestPrediction || score.matches > results.bestPrediction.matches) {
      results.bestPrediction = {
        prediction,
        actual,
        matches: score.matches,
        date: actualDraw.draw_date
      };
    }
    if (!results.worstPrediction || score.matches < results.worstPrediction.matches) {
      results.worstPrediction = {
        prediction,
        actual,
        matches: score.matches,
        date: actualDraw.draw_date
      };
    }
  }
  
  if (results.totalTests > 0) {
    results.avgMatchPercentage = parseFloat(
      ((results.totalMatches / (results.totalTests * 5)) * 100).toFixed(2)
    );
    results.avgMatchesPerDraw = parseFloat(
      (results.totalMatches / results.totalTests).toFixed(2)
    );
    results.winRate = parseFloat(
      ((results.wins / results.totalTests) * 100).toFixed(2)
    );
  }
  
  return results;
}

// =============================================================================
// MAIN BACKTEST FUNCTION
// =============================================================================

/**
 * Run comprehensive backtest across all strategies
 */
export async function runBacktest(drawTypeId = null, trainingWindow = 100) {
  console.log('🔬 Running Comprehensive Backtest...');
  console.log('');
  
  // Fetch draws
  let query = supabase
    .from('draws')
    .select('*')
    .order('draw_date', { ascending: true });
  
  if (drawTypeId) {
    query = query.eq('draw_type_id', drawTypeId);
  }
  
  const { data: draws, error } = await query;
  
  if (error || !draws || draws.length === 0) {
    console.error('Error fetching draws:', error);
    return null;
  }
  
  console.log(`📊 Backtesting with ${draws.length} draws`);
  console.log(`   Training window: ${trainingWindow} draws`);
  console.log(`   Test period: ${draws.length - trainingWindow} draws`);
  console.log('');
  
  // Define strategies
  const strategies = [
    { name: '🔥 Hot Numbers', fn: strategyHotNumbers },
    { name: '⏰ Due Numbers', fn: strategyDueNumbers },
    { name: '📍 Position-Based', fn: strategyPositionBased },
    { name: '🎯 Mixed (Hot + Due)', fn: strategyMixed },
    { name: '🔗 Correlation-Based', fn: strategyCorrelationBased },
    { name: '⚖️ Balanced Decades', fn: strategyBalanced },
    { name: '🔢 Last Digits (Finales)', fn: strategyLastDigits }
  ];
  
  const results = [];
  
  for (const strategy of strategies) {
    process.stdout.write(`   Testing ${strategy.name.padEnd(25)}... `);
    const result = backtestStrategy(draws, strategy.fn, strategy.name, trainingWindow);
    results.push(result);
    console.log(`✅ ${result.avgMatchesPerDraw} avg matches, ${result.winRate}% win rate`);
  }
  
  // Sort by performance
  results.sort((a, b) => b.avgMatchesPerDraw - a.avgMatchesPerDraw);
  
  console.log('');
  console.log('═'.repeat(60));
  console.log('📊 BACKTEST RESULTS');
  console.log('═'.repeat(60));
  console.log('');
  
  console.log('Strategy Performance Ranking:');
  console.log('─'.repeat(60));
  
  results.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(`${medal} ${r.strategyName}`);
    console.log(`   Avg Matches: ${r.avgMatchesPerDraw}/5 (${r.avgMatchPercentage}%)`);
    console.log(`   Win Rate (3+): ${r.winRate}%`);
    console.log(`   Distribution: 0:${r.matchDistribution[0]} 1:${r.matchDistribution[1]} 2:${r.matchDistribution[2]} 3:${r.matchDistribution[3]} 4:${r.matchDistribution[4]} 5:${r.matchDistribution[5]}`);
    console.log('');
  });
  
  // Best performing strategy
  const best = results[0];
  console.log('═'.repeat(60));
  console.log(`🏆 BEST STRATEGY: ${best.strategyName}`);
  console.log('═'.repeat(60));
  console.log(`   Average matches per draw: ${best.avgMatchesPerDraw}`);
  console.log(`   Win rate (3+ matches): ${best.winRate}%`);
  console.log(`   Total jackpots: ${best.jackpots}`);
  if (best.bestPrediction) {
    console.log(`   Best prediction: ${best.bestPrediction.matches}/5 on ${best.bestPrediction.date}`);
  }
  console.log('');
  
  return {
    totalDraws: draws.length,
    trainingWindow,
    testPeriod: draws.length - trainingWindow,
    strategies: results,
    bestStrategy: best.strategyName,
    recommendation: `Use "${best.strategyName}" strategy for best results`
  };
}

/**
 * Export strategies for use in predictor
 */
export const strategies = {
  hot: strategyHotNumbers,
  due: strategyDueNumbers,
  position: strategyPositionBased,
  mixed: strategyMixed,
  correlation: strategyCorrelationBased,
  balanced: strategyBalanced,
  statistical: strategyStatistical,
  finales: strategyLastDigits
};

// CLI execution
if (process.argv[1] && process.argv[1].includes('backtester')) {
  runBacktest().then(results => {
    if (results) {
      console.log('Backtest complete!');
    }
  }).catch(console.error);
}

export default { runBacktest, strategies };
