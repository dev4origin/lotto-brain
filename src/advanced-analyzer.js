/**
 * Advanced Pattern Analyzer
 * 
 * Provides sophisticated analysis techniques:
 * - Cycle detection (when numbers return)
 * - Gap analysis (time between appearances)
 * - Position frequency (which numbers appear in which positions)
 * - Decade distribution analysis
 * - Correlation analysis between numbers
 */

import supabase from './supabase-client.js';

// =============================================================================
// CYCLE ANALYSIS
// =============================================================================

/**
 * Analyze the return cycles of each number
 * A cycle is the number of draws between appearances of a number
 */
// Helper to get numbers based on type
function getNumbers(draw, type = 'winning') {
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
 * Analyze the return cycles of each number
 * A cycle is the number of draws between appearances of a number
 */
export function analyzeCycles(draws, type = 'winning') {
  const cycles = {};
  const lastSeen = {};
  
  // Initialize
  for (let i = 1; i <= 90; i++) {
    cycles[i] = [];
    lastSeen[i] = null;
  }
  
  // Process draws in chronological order (oldest first)
  const sortedDraws = [...draws].sort((a, b) => 
    new Date(a.draw_date) - new Date(b.draw_date)
  );
  
  sortedDraws.forEach((draw, drawIndex) => {
    const numbers = getNumbers(draw, type).filter(n => n);
    
    for (const num of numbers) {
      if (lastSeen[num] !== null) {
        // Record the gap since last appearance
        const gap = drawIndex - lastSeen[num];
        cycles[num].push(gap);
      }
      lastSeen[num] = drawIndex;
    }
  });
  
  // Calculate cycle statistics
  const cycleStats = {};
  for (let num = 1; num <= 90; num++) {
    const numCycles = cycles[num];
    if (numCycles.length > 0) {
      const avg = numCycles.reduce((a, b) => a + b, 0) / numCycles.length;
      const sorted = [...numCycles].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const min = Math.min(...numCycles);
      const max = Math.max(...numCycles);
      const std = Math.sqrt(
        numCycles.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / numCycles.length
      );
      
      // Current gap (draws since last appearance)
      const totalDraws = sortedDraws.length;
      const currentGap = lastSeen[num] !== null ? totalDraws - lastSeen[num] - 1 : totalDraws;
      
      // Calculate "due" score: how overdue is this number compared to its average cycle?
      const dueScore = avg > 0 ? (currentGap / avg) * 100 : 0;
      
      cycleStats[num] = {
        avgCycle: parseFloat(avg.toFixed(2)),
        medianCycle: median,
        minCycle: min,
        maxCycle: max,
        stdDev: parseFloat(std.toFixed(2)),
        currentGap,
        dueScore: parseFloat(Math.min(dueScore, 200).toFixed(1)), // Cap at 200%
        cycleCount: numCycles.length,
        isOverdue: currentGap > avg,
        overdueBy: currentGap > avg ? currentGap - avg : 0
      };
    } else {
      cycleStats[num] = {
        avgCycle: 0,
        medianCycle: 0,
        minCycle: 0,
        maxCycle: 0,
        stdDev: 0,
        currentGap: draws.length,
        dueScore: 200,
        cycleCount: 0,
        isOverdue: true,
        overdueBy: draws.length
      };
    }
  }
  
  return cycleStats;
}

// =============================================================================
// GAP ANALYSIS
// =============================================================================

/**
 * Analyze gaps between consecutive numbers in each draw
 * (e.g., if numbers are 12, 25, 38, 45, 67 - gaps are 13, 13, 7, 22)
 */
export function analyzeGaps(draws, type = 'winning') {
  const gapPatterns = {
    avgGap: 0,
    gapDistribution: {},
    commonPatterns: []
  };
  
  const allGaps = [];
  const gapSequences = [];
  
  for (const draw of draws) {
    const numbers = getNumbers(draw, type).filter(n => n).sort((a, b) => a - b);
    
    if (numbers.length === 5) {
      const gaps = [];
      for (let i = 0; i < 4; i++) {
        const gap = numbers[i + 1] - numbers[i];
        gaps.push(gap);
        allGaps.push(gap);
      }
      gapSequences.push(gaps);
    }
  }
  
  // Calculate average gap
  if (allGaps.length > 0) {
    gapPatterns.avgGap = parseFloat(
      (allGaps.reduce((a, b) => a + b, 0) / allGaps.length).toFixed(2)
    );
  }
  
  // Gap distribution
  for (const gap of allGaps) {
    gapPatterns.gapDistribution[gap] = (gapPatterns.gapDistribution[gap] || 0) + 1;
  }
  
  // Find common gap patterns
  const patternCounts = {};
  for (const seq of gapSequences) {
    const key = seq.join('-');
    patternCounts[key] = (patternCounts[key] || 0) + 1;
  }
  
  gapPatterns.commonPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, count]) => ({
      pattern: pattern.split('-').map(Number),
      count,
      percentage: parseFloat(((count / gapSequences.length) * 100).toFixed(2))
    }));
  
  return gapPatterns;
}

// =============================================================================
// POSITION ANALYSIS
// =============================================================================

/**
 * Analyze which numbers appear most frequently in each position
 * Position 1 = smallest number, Position 5 = largest number
 */
export function analyzePositions(draws, type = 'winning') {
  const positions = {
    1: {}, 2: {}, 3: {}, 4: {}, 5: {}
  };
  
  for (const draw of draws) {
    const numbers = getNumbers(draw, type).filter(n => n).sort((a, b) => a - b);
    
    if (numbers.length === 5) {
      for (let pos = 1; pos <= 5; pos++) {
        const num = numbers[pos - 1];
        positions[pos][num] = (positions[pos][num] || 0) + 1;
      }
    }
  }
  
  // Calculate position statistics
  const positionStats = {};
  const totalDraws = draws.length || 1;
  
  for (let pos = 1; pos <= 5; pos++) {
    const sorted = Object.entries(positions[pos])
      .sort((a, b) => b[1] - a[1]);
    
    // Top 10 for each position
    positionStats[pos] = {
      top10: sorted.slice(0, 10).map(([num, count]) => ({
        number: parseInt(num),
        count,
        percentage: parseFloat(((count / totalDraws) * 100).toFixed(2))
      })),
      // Range analysis
      minNumber: sorted.length > 0 ? Math.min(...sorted.map(([n]) => parseInt(n))) : 0,
      maxNumber: sorted.length > 0 ? Math.max(...sorted.map(([n]) => parseInt(n))) : 90,
      avgNumber: sorted.length > 0 ? parseFloat(
        (sorted.reduce((sum, [n, c]) => sum + parseInt(n) * c, 0) / totalDraws).toFixed(2)
      ) : 0
    };
  }
  
  return positionStats;
}

// =============================================================================
// DECADE DISTRIBUTION
// =============================================================================

/**
 * Analyze distribution across decades (1-9, 10-19, 20-29, etc.)
 */
export function analyzeDecades(draws, type = 'winning') {
  const decadeLabels = ['1-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-90'];
  
  // Count numbers per decade per draw
  const decadePatterns = {};
  
  for (const draw of draws) {
    const numbers = getNumbers(draw, type).filter(n => n);
    
    // Count decades in this draw
    const decadeCounts = new Array(9).fill(0);
    for (const num of numbers) {
      const decade = num <= 9 ? 0 : Math.min(Math.floor((num - 1) / 10), 8);
      decadeCounts[decade]++;
    }
    
    // Create pattern key (e.g., "1-2-1-1-0-0-0-0-0" means 1 from 1-9, 2 from 10-19, etc.)
    const pattern = decadeCounts.join('-');
    decadePatterns[pattern] = (decadePatterns[pattern] || 0) + 1;
  }
  
  // Overall decade frequency
  const decadeFrequency = new Array(9).fill(0);
  for (const draw of draws) {
    const numbers = getNumbers(draw, type).filter(n => n);
    
    for (const num of numbers) {
      const decade = num <= 9 ? 0 : Math.min(Math.floor((num - 1) / 10), 8);
      decadeFrequency[decade]++;
    }
  }
  
  const totalNumbers = draws.length * 5;
  
  // Most common decade patterns
  const topPatterns = Object.entries(decadePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, count]) => ({
      pattern: pattern.split('-').map(Number),
      count,
      percentage: parseFloat(((count / draws.length) * 100).toFixed(2))
    }));
  
  return {
    labels: decadeLabels,
    frequency: decadeFrequency.map((count, i) => ({
      decade: decadeLabels[i],
      count,
      percentage: parseFloat(((count / totalNumbers) * 100).toFixed(2))
    })),
    idealPerDecade: parseFloat((totalNumbers / 9).toFixed(0)),
    topPatterns
  };
}

// =============================================================================
// CORRELATION ANALYSIS
// =============================================================================

/**
 * Find pairs of numbers that frequently appear together
 */
export function analyzeCorrelations(draws, type = 'winning') {
  const pairCounts = {};
  const tripleCounts = {};
  
  for (const draw of draws) {
    const numbers = getNumbers(draw, type).filter(n => n).sort((a, b) => a - b);
    
    // Count pairs
    for (let i = 0; i < numbers.length - 1; i++) {
      for (let j = i + 1; j < numbers.length; j++) {
        const key = `${numbers[i]}-${numbers[j]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
    
    // Count triples
    for (let i = 0; i < numbers.length - 2; i++) {
      for (let j = i + 1; j < numbers.length - 1; j++) {
        for (let k = j + 1; k < numbers.length; k++) {
          const key = `${numbers[i]}-${numbers[j]}-${numbers[k]}`;
          tripleCounts[key] = (tripleCounts[key] || 0) + 1;
        }
      }
    }
  }
  
  // Top pairs
  const topPairs = Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pair, count]) => ({
      numbers: pair.split('-').map(Number),
      count,
      percentage: parseFloat(((count / draws.length) * 100).toFixed(2))
    }));
  
  // Top triples
  const topTriples = Object.entries(tripleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([triple, count]) => ({
      numbers: triple.split('-').map(Number),
      count,
      percentage: parseFloat(((count / draws.length) * 100).toFixed(2))
    }));
  
  return { topPairs, topTriples };
}

// =============================================================================
// LAST DIGIT (FINALES) ANALYSIS
1// =============================================================================

/**
 * Analyze numbers based on their last digit (0-9)
 * In Loto Bonheur, this is often called "Finales"
 */
export function analyzeLastDigits(draws, type = 'winning') {
  const finales = {};
  const lastSeen = {};
  
  // Initialize 0-9
  for (let i = 0; i <= 9; i++) {
    finales[i] = {
      count: 0,
      draws: [] // Indices of draws where any number with this finale appeared
    };
    lastSeen[i] = null;
  }
  
  const sortedDraws = [...draws].sort((a, b) => 
    new Date(a.draw_date) - new Date(b.draw_date)
  );
  
  sortedDraws.forEach((draw, drawIndex) => {
    const numbers = getNumbers(draw, type).filter(n => n !== undefined);
    const seenInThisDraw = new Set();
    
    numbers.forEach(num => {
      const lastDigit = num % 10;
      finales[lastDigit].count++;
      seenInThisDraw.add(lastDigit);
    });
    
    seenInThisDraw.forEach(digit => {
      finales[digit].draws.push(drawIndex);
      lastSeen[digit] = drawIndex;
    });
  });
  
  // Calculate Gap and Due Scores for each Finale
  const totalDraws = sortedDraws.length;
  const finaleStats = {};
  
  for (let i = 0; i <= 9; i++) {
    const stats = finales[i];
    const appearances = stats.draws.length;
    const avgInterval = appearances > 0 ? totalDraws / appearances : totalDraws;
    const currentGap = lastSeen[i] !== null ? totalDraws - lastSeen[i] - 1 : totalDraws;
    
    // Due score for the finale itself
    const dueScore = avgInterval > 0 ? (currentGap / avgInterval) * 100 : 0;
    
    finaleStats[i] = {
      finale: i,
      count: stats.count,
      appearances,
      avgInterval: parseFloat(avgInterval.toFixed(2)),
      currentGap,
      dueScore: parseFloat(Math.min(dueScore, 200).toFixed(1)),
      percentage: parseFloat(((stats.count / (totalDraws * 5)) * 100).toFixed(2))
    };
  }
  
  return finaleStats;
}

// =============================================================================
// COMPREHENSIVE ANALYSIS
// =============================================================================

/**
 * Run all advanced analyses and return combined results
 */
export async function runAdvancedAnalysis(drawTypeId = null) {
  console.log('📊 Running Advanced Pattern Analysis...');
  
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
  
  console.log(`   Analyzing ${draws.length} draws...`);
  
  const analysis = {
    totalDraws: draws.length,
    dateRange: {
      from: draws[0].draw_date,
      to: draws[draws.length - 1].draw_date
    },
    cycles: analyzeCycles(draws),
    gaps: analyzeGaps(draws),
    positions: analyzePositions(draws),
    decades: analyzeDecades(draws),
    correlations: analyzeCorrelations(draws),
    finales: analyzeLastDigits(draws)
  };
  
  // Find most "due" numbers based on cycle analysis
  const dueNumbers = Object.entries(analysis.cycles)
    .filter(([_, stats]) => stats.isOverdue && stats.cycleCount >= 5)
    .sort((a, b) => b[1].dueScore - a[1].dueScore)
    .slice(0, 10)
    .map(([num, stats]) => ({
      number: parseInt(num),
      ...stats
    }));
  
  analysis.dueNumbers = dueNumbers;
  
  console.log('✅ Advanced analysis complete');
  
  return analysis;
}

// Export for CLI usage
export default {
  analyzeCycles,
  analyzeGaps,
  analyzePositions,
  analyzeDecades,
  analyzeCorrelations,
  analyzeLastDigits,
  runAdvancedAnalysis
};
