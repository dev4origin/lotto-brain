/**
 * Lotto Pattern Analyzer
 * 
 * Analyse les résultats pour détecter les patterns statistiques
 */

import supabase from './supabase-client.js';

// =====================================================
// ANALYSIS FUNCTIONS
// =====================================================

/**
 * Calculate number frequency statistics
 */
async function analyzeNumberFrequency() {
  console.log('\n📊 Analyzing Number Frequencies...');
  
  const { data: draws, error } = await supabase
    .from('draws')
    .select('*');
  
  if (error) {
    console.error('Error fetching draws:', error);
    return null;
  }
  
  console.log(`   Processing ${draws.length} draws...`);
  
  // Aggregate frequency by number and draw type
  const frequencyMap = new Map();
  
  for (const draw of draws) {
    const key = `${draw.draw_type_id}`;
    if (!frequencyMap.has(key)) {
      frequencyMap.set(key, {
        drawTypeId: draw.draw_type_id,
        numbers: {}
      });
    }
    
    const stats = frequencyMap.get(key);
    const numbers = [
      { num: draw.winning_number_1, pos: 1 },
      { num: draw.winning_number_2, pos: 2 },
      { num: draw.winning_number_3, pos: 3 },
      { num: draw.winning_number_4, pos: 4 },
      { num: draw.winning_number_5, pos: 5 }
    ];
    
    for (const { num, pos } of numbers) {
      if (!stats.numbers[num]) {
        stats.numbers[num] = { 
          total: 0, 
          positions: [0, 0, 0, 0, 0],
          lastSeen: null 
        };
      }
      stats.numbers[num].total++;
      stats.numbers[num].positions[pos - 1]++;
      if (!stats.numbers[num].lastSeen || draw.draw_date > stats.numbers[num].lastSeen) {
        stats.numbers[num].lastSeen = draw.draw_date;
      }
    }
  }
  
  return frequencyMap;
}

/**
 * Find hot numbers (most frequent)
 */
async function findHotNumbers(limit = 10) {
  console.log('\n🔥 Finding Hot Numbers...');
  
  const { data, error } = await supabase
    .from('draws')
    .select(`
      draw_type_id,
      draw_types(name),
      winning_number_1,
      winning_number_2,
      winning_number_3,
      winning_number_4,
      winning_number_5
    `);
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  // Count by draw type
  const hotByType = new Map();
  
  for (const draw of data) {
    const typeName = draw.draw_types?.name || 'Unknown';
    if (!hotByType.has(typeName)) {
      hotByType.set(typeName, {});
    }
    
    const counts = hotByType.get(typeName);
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3, 
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      counts[num] = (counts[num] || 0) + 1;
    });
  }
  
  // Get top numbers for each type
  const results = {};
  for (const [typeName, counts] of hotByType) {
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    results[typeName] = sorted.map(([num, count]) => ({ number: parseInt(num), count }));
  }
  
  return results;
}

/**
 * Find cold numbers (least frequent)
 */
async function findColdNumbers(limit = 10) {
  console.log('\n❄️  Finding Cold Numbers...');
  
  const { data, error } = await supabase
    .from('draws')
    .select(`
      draw_type_id,
      draw_types(name),
      winning_number_1,
      winning_number_2,
      winning_number_3,
      winning_number_4,
      winning_number_5
    `);
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  // Count occurrences
  const countsByType = new Map();
  
  for (const draw of data) {
    const typeName = draw.draw_types?.name || 'Unknown';
    if (!countsByType.has(typeName)) {
      // Initialize all numbers 1-90 with count 0
      const allNums = {};
      for (let i = 1; i <= 90; i++) allNums[i] = 0;
      countsByType.set(typeName, allNums);
    }
    
    const counts = countsByType.get(typeName);
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3, 
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      counts[num]++;
    });
  }
  
  // Get bottom numbers for each type
  const results = {};
  for (const [typeName, counts] of countsByType) {
    const sorted = Object.entries(counts)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit);
    results[typeName] = sorted.map(([num, count]) => ({ number: parseInt(num), count }));
  }
  
  return results;
}

/**
 * Find overdue numbers (not appeared recently)
 */
async function findOverdueNumbers(limit = 10) {
  console.log('\n⏰ Finding Overdue Numbers...');
  
  const { data, error } = await supabase
    .from('draws')
    .select('*')
    .order('draw_date', { ascending: false });
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  // Track last seen date for each number
  const lastSeenByType = new Map();
  
  for (const draw of data) {
    if (!lastSeenByType.has(draw.draw_type_id)) {
      const nums = {};
      for (let i = 1; i <= 90; i++) nums[i] = null;
      lastSeenByType.set(draw.draw_type_id, nums);
    }
    
    const lastSeen = lastSeenByType.get(draw.draw_type_id);
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3, 
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (!lastSeen[num]) {
        lastSeen[num] = draw.draw_date;
      }
    });
  }
  
  // Get draw type names
  const { data: types } = await supabase.from('draw_types').select('id, name');
  const typeNames = new Map(types?.map(t => [t.id, t.name]) || []);
  
  const results = {};
  const today = new Date();
  
  for (const [typeId, lastSeen] of lastSeenByType) {
    const typeName = typeNames.get(typeId) || `Type ${typeId}`;
    const overdue = Object.entries(lastSeen)
      .map(([num, date]) => ({
        number: parseInt(num),
        lastSeen: date,
        daysSince: date ? Math.floor((today - new Date(date)) / (1000 * 60 * 60 * 24)) : 9999
      }))
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, limit);
    
    results[typeName] = overdue;
  }
  
  return results;
}

/**
 * Find consecutive number patterns
 */
async function findConsecutivePatterns() {
  console.log('\n🔢 Finding Consecutive Number Patterns...');
  
  const { data, error } = await supabase
    .from('draws')
    .select('*, draw_types(name)');
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  const consecutiveCounts = {};
  
  for (const draw of data) {
    const nums = [
      draw.winning_number_1,
      draw.winning_number_2,
      draw.winning_number_3,
      draw.winning_number_4,
      draw.winning_number_5
    ].sort((a, b) => a - b);
    
    // Check for consecutive pairs
    let hasConsecutive = false;
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i + 1] - nums[i] === 1) {
        hasConsecutive = true;
        break;
      }
    }
    
    const typeName = draw.draw_types?.name || 'Unknown';
    if (!consecutiveCounts[typeName]) {
      consecutiveCounts[typeName] = { total: 0, withConsecutive: 0 };
    }
    consecutiveCounts[typeName].total++;
    if (hasConsecutive) {
      consecutiveCounts[typeName].withConsecutive++;
    }
  }
  
  // Calculate percentages
  const results = {};
  for (const [type, counts] of Object.entries(consecutiveCounts)) {
    results[type] = {
      ...counts,
      percentage: ((counts.withConsecutive / counts.total) * 100).toFixed(2) + '%'
    };
  }
  
  return results;
}

/**
 * Analyze odd/even distribution
 */
async function analyzeOddEvenDistribution() {
  console.log('\n🎯 Analyzing Odd/Even Distribution...');
  
  const { data, error } = await supabase
    .from('draws')
    .select('*, draw_types(name)');
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  const distributions = {};
  
  for (const draw of data) {
    const nums = [
      draw.winning_number_1,
      draw.winning_number_2,
      draw.winning_number_3,
      draw.winning_number_4,
      draw.winning_number_5
    ];
    
    const oddCount = nums.filter(n => n % 2 === 1).length;
    const evenCount = 5 - oddCount;
    const pattern = `${oddCount}O/${evenCount}E`;
    
    const typeName = draw.draw_types?.name || 'Unknown';
    if (!distributions[typeName]) {
      distributions[typeName] = {};
    }
    distributions[typeName][pattern] = (distributions[typeName][pattern] || 0) + 1;
  }
  
  // Sort by frequency
  const results = {};
  for (const [type, patterns] of Object.entries(distributions)) {
    results[type] = Object.entries(patterns)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, count]) => ({ pattern, count }));
  }
  
  return results;
}

/**
 * Analyze sum ranges
 */
async function analyzeSumRanges() {
  console.log('\n➕ Analyzing Sum Ranges...');
  
  const { data, error } = await supabase
    .from('draws')
    .select('*, draw_types(name)');
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  const sumsByType = {};
  
  for (const draw of data) {
    const sum = draw.winning_number_1 + draw.winning_number_2 + 
                draw.winning_number_3 + draw.winning_number_4 + 
                draw.winning_number_5;
    
    const typeName = draw.draw_types?.name || 'Unknown';
    if (!sumsByType[typeName]) {
      sumsByType[typeName] = [];
    }
    sumsByType[typeName].push(sum);
  }
  
  // Calculate statistics
  const results = {};
  for (const [type, sums] of Object.entries(sumsByType)) {
    sums.sort((a, b) => a - b);
    const min = Math.min(...sums);
    const max = Math.max(...sums);
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    const median = sums[Math.floor(sums.length / 2)];
    
    // Find most common ranges (buckets of 20)
    const ranges = {};
    for (const sum of sums) {
      const bucket = Math.floor(sum / 20) * 20;
      const rangeKey = `${bucket}-${bucket + 19}`;
      ranges[rangeKey] = (ranges[rangeKey] || 0) + 1;
    }
    
    results[type] = {
      min, max,
      average: avg.toFixed(2),
      median,
      mostCommonRanges: Object.entries(ranges)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([range, count]) => ({ range, count }))
    };
  }
  
  return results;
}

/**
 * Find repeating number pairs
 */
async function findRepeatingPairs(minOccurrences = 5) {
  console.log('\n👥 Finding Repeating Number Pairs...');
  
  const { data, error } = await supabase
    .from('draws')
    .select('*, draw_types(name)');
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  const pairsByType = {};
  
  for (const draw of data) {
    const nums = [
      draw.winning_number_1,
      draw.winning_number_2,
      draw.winning_number_3,
      draw.winning_number_4,
      draw.winning_number_5
    ].sort((a, b) => a - b);
    
    const typeName = draw.draw_types?.name || 'Unknown';
    if (!pairsByType[typeName]) {
      pairsByType[typeName] = {};
    }
    
    // Generate all pairs
    for (let i = 0; i < nums.length - 1; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const pairKey = `${nums[i]}-${nums[j]}`;
        pairsByType[typeName][pairKey] = (pairsByType[typeName][pairKey] || 0) + 1;
      }
    }
  }
  
  // Filter and sort
  const results = {};
  for (const [type, pairs] of Object.entries(pairsByType)) {
    results[type] = Object.entries(pairs)
      .filter(([_, count]) => count >= minOccurrences)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([pair, count]) => {
        const [n1, n2] = pair.split('-').map(Number);
        return { numbers: [n1, n2], count };
      });
  }
  
  return results;
}

/**
 * Day of week analysis
 */
async function analyzeDayOfWeek() {
  console.log('\n📅 Analyzing Day of Week Patterns...');
  
  const { data, error } = await supabase
    .from('draws')
    .select('day_of_week, winning_number_1, winning_number_2, winning_number_3, winning_number_4, winning_number_5');
  
  if (error) {
    console.error('Error:', error);
    return null;
  }
  
  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const dayStats = {};
  
  for (const draw of data) {
    const dayName = dayNames[draw.day_of_week] || 'Unknown';
    if (!dayStats[dayName]) {
      dayStats[dayName] = { counts: {}, total: 0 };
    }
    
    dayStats[dayName].total++;
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3, 
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      dayStats[dayName].counts[num] = (dayStats[dayName].counts[num] || 0) + 1;
    });
  }
  
  // Get top 5 numbers for each day
  const results = {};
  for (const [day, stats] of Object.entries(dayStats)) {
    const topNumbers = Object.entries(stats.counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([num, count]) => ({ number: parseInt(num), count }));
    
    results[day] = {
      totalDraws: stats.total,
      topNumbers
    };
  }
  
  return results;
}

/**
 * Clamp a numeric value to fit within DECIMAL(5,2) range: 0.00 to 99.99
 */
function clampStrength(value) {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return 50.00; // Default value
  }
  return Math.min(99.99, Math.max(0, parseFloat(value.toFixed(2))));
}

/**
 * Store patterns in database
 */
async function storePatterns(patterns) {
  console.log('\n💾 Storing patterns in database...');
  
  const { data: types } = await supabase.from('draw_types').select('id, name');
  const typeMap = new Map(types?.map(t => [t.name, t.id]) || []);
  
  // Calculate total draws per type for percentage calculations
  const { data: drawCounts } = await supabase
    .from('draws')
    .select('draw_type_id, draw_types(name)');
  
  const totalDrawsByType = {};
  for (const draw of drawCounts || []) {
    const typeName = draw.draw_types?.name || 'Unknown';
    totalDrawsByType[typeName] = (totalDrawsByType[typeName] || 0) + 1;
  }
  
  const patternRecords = [];
  
  // Hot numbers patterns
  if (patterns.hotNumbers) {
    for (const [typeName, numbers] of Object.entries(patterns.hotNumbers)) {
      const top5 = numbers.slice(0, 5);
      const totalDraws = totalDrawsByType[typeName] || 1;
      // Strength = how often the hottest number appears as a percentage
      const strength = clampStrength((top5[0]?.count / totalDraws) * 100);
      
      patternRecords.push({
        pattern_type: 'hot_numbers',
        draw_type_id: typeMap.get(typeName),
        description: `Les 5 numéros les plus fréquents: ${top5.map(n => n.number).join(', ')}`,
        numbers: top5,
        strength: strength,
        occurrence_count: top5.reduce((sum, n) => sum + n.count, 0)
      });
    }
  }
  
  // Cold numbers patterns
  if (patterns.coldNumbers) {
    for (const [typeName, numbers] of Object.entries(patterns.coldNumbers)) {
      const cold5 = numbers.slice(0, 5);
      const totalDraws = totalDrawsByType[typeName] || 1;
      // Strength = inverse of frequency (high strength = very cold)
      const coldestFreq = (cold5[0]?.count / totalDraws) * 100;
      const strength = clampStrength(99.99 - coldestFreq);
      
      patternRecords.push({
        pattern_type: 'cold_numbers',
        draw_type_id: typeMap.get(typeName),
        description: `Les 5 numéros les moins fréquents: ${cold5.map(n => n.number).join(', ')}`,
        numbers: cold5,
        strength: strength,
        occurrence_count: cold5.reduce((sum, n) => sum + n.count, 0)
      });
    }
  }
  
  // Consecutive patterns
  if (patterns.consecutivePatterns) {
    for (const [typeName, stats] of Object.entries(patterns.consecutivePatterns)) {
      const strength = clampStrength(parseFloat(stats.percentage));
      
      patternRecords.push({
        pattern_type: 'consecutive_pair',
        draw_type_id: typeMap.get(typeName),
        description: `${stats.percentage} des tirages contiennent des numéros consécutifs`,
        numbers: { withConsecutive: stats.withConsecutive, total: stats.total },
        strength: strength,
        occurrence_count: stats.withConsecutive
      });
    }
  }
  
  // Sum range patterns
  if (patterns.sumRanges) {
    for (const [typeName, stats] of Object.entries(patterns.sumRanges)) {
      patternRecords.push({
        pattern_type: 'sum_range',
        draw_type_id: typeMap.get(typeName),
        description: `Somme moyenne: ${stats.average}, Plage: ${stats.min}-${stats.max}`,
        numbers: stats,
        strength: 80.00,  // Fixed value for sum range patterns
        occurrence_count: 1
      });
    }
  }
  
  // Insert patterns
  let stored = 0;
  let errors = 0;
  
  for (const pattern of patternRecords) {
    // Skip patterns without a valid draw_type_id
    if (!pattern.draw_type_id) {
      continue;
    }
    
    const { error } = await supabase
      .from('patterns')
      .upsert(pattern, { onConflict: 'pattern_type,draw_type_id' });
    
    if (error && error.code !== '23505') {
      console.error('Error storing pattern:', error.message);
      errors++;
    } else {
      stored++;
    }
  }
  
  console.log(`   ✅ Stored ${stored} patterns (${errors} errors)`);
}

/**
 * Print analysis report
 */
function printReport(patterns) {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('              🎰 LOTTO PATTERNS ANALYSIS REPORT');
  console.log('═'.repeat(60));
  
  // Hot Numbers
  if (patterns.hotNumbers) {
    console.log('\n🔥 HOT NUMBERS (Most Frequent)');
    console.log('─'.repeat(40));
    for (const [type, numbers] of Object.entries(patterns.hotNumbers).slice(0, 5)) {
      console.log(`\n   ${type}:`);
      numbers.slice(0, 5).forEach((n, i) => {
        console.log(`      ${i + 1}. Numéro ${n.number} - ${n.count} fois`);
      });
    }
  }
  
  // Cold Numbers
  if (patterns.coldNumbers) {
    console.log('\n\n❄️  COLD NUMBERS (Least Frequent)');
    console.log('─'.repeat(40));
    for (const [type, numbers] of Object.entries(patterns.coldNumbers).slice(0, 5)) {
      console.log(`\n   ${type}:`);
      numbers.slice(0, 5).forEach((n, i) => {
        console.log(`      ${i + 1}. Numéro ${n.number} - ${n.count} fois`);
      });
    }
  }
  
  // Overdue Numbers
  if (patterns.overdueNumbers) {
    console.log('\n\n⏰ OVERDUE NUMBERS (Long Time No See)');
    console.log('─'.repeat(40));
    for (const [type, numbers] of Object.entries(patterns.overdueNumbers).slice(0, 5)) {
      console.log(`\n   ${type}:`);
      numbers.slice(0, 5).forEach((n, i) => {
        console.log(`      ${i + 1}. Numéro ${n.number} - ${n.daysSince} jours`);
      });
    }
  }
  
  // Consecutive Patterns
  if (patterns.consecutivePatterns) {
    console.log('\n\n🔢 CONSECUTIVE PATTERNS');
    console.log('─'.repeat(40));
    for (const [type, stats] of Object.entries(patterns.consecutivePatterns).slice(0, 10)) {
      console.log(`   ${type}: ${stats.percentage} contiennent des consécutifs`);
    }
  }
  
  // Odd/Even Distribution
  if (patterns.oddEvenDistribution) {
    console.log('\n\n🎯 ODD/EVEN DISTRIBUTION');
    console.log('─'.repeat(40));
    for (const [type, dist] of Object.entries(patterns.oddEvenDistribution).slice(0, 5)) {
      console.log(`\n   ${type}:`);
      dist.slice(0, 3).forEach(d => {
        console.log(`      ${d.pattern}: ${d.count} tirages`);
      });
    }
  }
  
  // Sum Ranges
  if (patterns.sumRanges) {
    console.log('\n\n➕ SUM ANALYSIS');
    console.log('─'.repeat(40));
    for (const [type, stats] of Object.entries(patterns.sumRanges).slice(0, 5)) {
      console.log(`\n   ${type}:`);
      console.log(`      Min: ${stats.min}, Max: ${stats.max}`);
      console.log(`      Moyenne: ${stats.average}, Médiane: ${stats.median}`);
      console.log(`      Plages fréquentes: ${stats.mostCommonRanges.map(r => r.range).join(', ')}`);
    }
  }
  
  // Repeating Pairs
  if (patterns.repeatingPairs) {
    console.log('\n\n👥 REPEATING NUMBER PAIRS');
    console.log('─'.repeat(40));
    for (const [type, pairs] of Object.entries(patterns.repeatingPairs).slice(0, 5)) {
      if (pairs.length > 0) {
        console.log(`\n   ${type}:`);
        pairs.slice(0, 5).forEach((p, i) => {
          console.log(`      ${i + 1}. [${p.numbers.join(', ')}] - ${p.count} fois`);
        });
      }
    }
  }
  
  // Day of Week Analysis
  if (patterns.dayOfWeek) {
    console.log('\n\n📅 DAY OF WEEK FAVORITES');
    console.log('─'.repeat(40));
    for (const [day, stats] of Object.entries(patterns.dayOfWeek)) {
      console.log(`\n   ${day} (${stats.totalDraws} tirages):`);
      console.log(`      Top: ${stats.topNumbers.map(n => n.number).join(', ')}`);
    }
  }
  
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('✅ Analysis complete! Patterns stored in database.');
  console.log('═'.repeat(60));
}

/**
 * Main analysis function
 */
async function runAnalysis() {
  console.log('🎰 LOTTO PATTERNS ANALYZER');
  console.log('=' .repeat(50));
  
  // Check if we have data
  const { count } = await supabase
    .from('draws')
    .select('*', { count: 'exact', head: true });
  
  if (!count || count === 0) {
    console.log('❌ No draws found in database. Run npm run scrape first.');
    return;
  }
  
  console.log(`\n📊 Analyzing ${count} draws...`);
  
  const patterns = {};
  
  // Run all analyses
  patterns.hotNumbers = await findHotNumbers(10);
  patterns.coldNumbers = await findColdNumbers(10);
  patterns.overdueNumbers = await findOverdueNumbers(10);
  patterns.consecutivePatterns = await findConsecutivePatterns();
  patterns.oddEvenDistribution = await analyzeOddEvenDistribution();
  patterns.sumRanges = await analyzeSumRanges();
  patterns.repeatingPairs = await findRepeatingPairs(3);
  patterns.dayOfWeek = await analyzeDayOfWeek();
  
  // Store patterns in database
  await storePatterns(patterns);
  
  // Print report
  printReport(patterns);
}

// Run analysis
runAnalysis().catch(console.error);
