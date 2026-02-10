/**
 * Correlation Analyzer
 * Analyzes correlations between Machine Numbers and Winning Numbers
 */

/**
 * Analyze historical correlations between machine and winning numbers
 * @param {Array} draws - Historical draw data
 * @returns {Object} Correlation matrix: { machineNum: { winningNum: count } }
 */
export function analyzeWinningMachineCorrelation(draws) {
  const correlations = {};
  
  for (const draw of draws) {
    // Extract machine numbers
    const machineNums = [
      draw.machine_number_1, draw.machine_number_2, draw.machine_number_3,
      draw.machine_number_4, draw.machine_number_5
    ].filter(n => n !== null && n !== undefined);
    
    // Extract winning numbers
    const winningNums = [
      draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
      draw.winning_number_4, draw.winning_number_5
    ].filter(n => n !== null && n !== undefined);
    
    // Skip if incomplete data
    if (machineNums.length !== 5 || winningNums.length !== 5) continue;
    
    // Build correlation matrix
    for (const machineNum of machineNums) {
      if (!correlations[machineNum]) {
        correlations[machineNum] = {};
      }
      
      for (const winningNum of winningNums) {
        correlations[machineNum][winningNum] = (correlations[machineNum][winningNum] || 0) + 1;
      }
    }
  }
  
  return correlations;
}

/**
 * Find the strongest correlated winning numbers for a given machine number
 * @param {Object} correlations - Correlation matrix
 * @param {number} machineNum - Machine number to analyze
 * @param {number} topN - Number of top correlations to return
 * @returns {Array} Top correlated winning numbers with their counts
 */
export function getTopCorrelatedWinning(correlations, machineNum, topN = 10) {
  const machineCorrelations = correlations[machineNum] || {};
  
  return Object.entries(machineCorrelations)
    .map(([winNum, count]) => ({ number: parseInt(winNum), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

/**
 * Calculate correlation strength between machine and winning numbers
 * @param {Object} correlations - Correlation matrix
 * @param {Array} machinePrediction - Predicted machine numbers
 * @returns {number} Average correlation strength (0-1)
 */
export function calculateCorrelationStrength(correlations, machinePrediction) {
  if (!machinePrediction || machinePrediction.length === 0) return 0;
  
  let totalCorrelations = 0;
  let maxPossible = 0;
  
  for (const machineNum of machinePrediction) {
    const machineCorrelations = correlations[machineNum] || {};
    const counts = Object.values(machineCorrelations);
    
    if (counts.length > 0) {
      totalCorrelations += Math.max(...counts);
      maxPossible += Math.max(...counts) * 2; // Theoretical max
    }
  }
  
  return maxPossible > 0 ? totalCorrelations / maxPossible : 0;
}

/**
 * Generate hybrid prediction using correlation-based boosting
 * @param {Array} draws - Historical draws
 * @param {Object} mainScores - Scores from main brain
 * @param {Array} machinePrediction - Predicted machine numbers
 * @param {number} boostFactor - Boost multiplier (default 1.3 = 30% boost)
 * @returns {Object} { boostedScores, correlationStrength, boostedNumbers }
 */
export function generateHybridPrediction(draws, mainScores, machinePrediction, boostFactor = 1.3) {
  // Analyze correlations
  const correlations = analyzeWinningMachineCorrelation(draws);
  
  // Clone main scores
  const boostedScores = { ...mainScores };
  const boostedNumbers = new Set();
  
  // For each predicted machine number, boost correlated winning numbers
  for (const machineNum of machinePrediction) {
    const topCorrelated = getTopCorrelatedWinning(correlations, machineNum, 10);
    
    for (const { number: winNum } of topCorrelated) {
      if (boostedScores[winNum]) {
        boostedScores[winNum] *= boostFactor;
        boostedNumbers.add(winNum);
      }
    }
  }
  
  // Calculate correlation strength
  const correlationStrength = calculateCorrelationStrength(correlations, machinePrediction);
  
  return {
    boostedScores,
    correlationStrength,
    boostedNumbers: Array.from(boostedNumbers),
    correlationMatrix: correlations
  };
}

/**
 * Select top N numbers from scores with decade balancing
 * @param {Object} scores - Number scores
 * @param {number} count - Number of numbers to select
 * @returns {Array} Selected numbers with scores
 */
export function selectTopNumbers(scores, count = 5) {
  const ranked = Object.entries(scores)
    .map(([num, score]) => ({ number: parseInt(num), score: parseFloat(score.toFixed(4)) }))
    .sort((a, b) => b.score - a.score);
  
  const selected = [];
  
  // First pass: Select with decade balance (max 2 per decade)
  for (const candidate of ranked) {
    if (selected.length >= count) break;
    const decade = Math.floor((candidate.number - 1) / 10);
    const decadeCount = selected.filter(n => Math.floor((n.number - 1) / 10) === decade).length;
    if (decadeCount < 2) {
      selected.push(candidate);
    }
  }
  
  // Second pass: Fill remaining slots
  for (const candidate of ranked) {
    if (selected.length >= count) break;
    if (!selected.find(s => s.number === candidate.number)) {
      selected.push(candidate);
    }
  }
  
  return selected;
}
