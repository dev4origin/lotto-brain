/**
 * Lotto Bonheur Scraper
 * 
 * Récupère tous les résultats des tirages depuis l'API de lotobonheur.ci
 * et les stocke dans Supabase.
 */

import fetch from 'node-fetch';
import CONFIG from './config.js';
import supabase from './supabase-client.js';

// French month names to numbers
const FRENCH_MONTHS = {
  'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4,
  'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8,
  'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12
};

// Day names in French
const FRENCH_DAYS = {
  'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4,
  'vendredi': 5, 'samedi': 6, 'dimanche': 0
};

/**
 * Parse date from format like "samedi 07/02" with monthYear context "février 2026"
 */
function parseFrenchDate(dateStr, monthYear) {
  if (!dateStr || !monthYear) return null;
  
  try {
    // Extract year from monthYear (e.g., "février 2026" -> 2026)
    const monthYearParts = monthYear.toLowerCase().trim().split(/\s+/);
    const year = parseInt(monthYearParts[1]);
    const monthFromContext = FRENCH_MONTHS[monthYearParts[0]];
    
    // Parse date format: "samedi 07/02"
    const match = dateStr.match(/(\w+)\s+(\d{2})\/(\d{2})/);
    if (match) {
      const dayOfWeekName = match[1].toLowerCase();
      const day = parseInt(match[2]);
      const month = parseInt(match[3]);
      
      // Handle year transition (if month from date > month from context, use previous year)
      let actualYear = year;
      if (month > monthFromContext) {
        actualYear = year - 1;
      }
      
      const dayOfWeek = FRENCH_DAYS[dayOfWeekName] ?? -1;
      
      return {
        date: `${actualYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        dayOfWeek: dayOfWeek
      };
    }
  } catch (e) {
    console.error(`Error parsing date: ${dateStr} with context ${monthYear}`, e);
  }
  
  return null;
}

/**
 * Parse winning numbers from string "66 - 24 - 16 - 42 - 74"
 */
function parseNumbers(numbersStr) {
  if (!numbersStr || numbersStr.includes('.')) return null;
  
  const numbers = numbersStr
    .split('-')
    .map(n => parseInt(n.trim()))
    .filter(n => !isNaN(n) && n >= 1 && n <= 90);
  
  if (numbers.length !== 5) {
    return null;
  }
  
  return numbers;
}

/**
 * Get draw type ID from name (with cache)
 */
const drawTypeCache = new Map();

async function getDrawTypeId(drawName) {
  if (drawTypeCache.has(drawName)) {
    return drawTypeCache.get(drawName);
  }
  
  const { data, error } = await supabase
    .from('draw_types')
    .select('id')
    .eq('name', drawName)
    .single();
  
  if (error || !data) {
    // Insert new draw type if not exists
    const { data: newType, error: insertError } = await supabase
      .from('draw_types')
      .insert({ name: drawName, category: 'unknown' })
      .select('id')
      .single();
    
    if (insertError) {
      console.error(`Error creating draw type: ${drawName}`, insertError);
      return null;
    }
    drawTypeCache.set(drawName, newType.id);
    return newType.id;
  }
  
  drawTypeCache.set(drawName, data.id);
  return data.id;
}

/**
 * Fetch results for a specific month/year
 */
async function fetchMonthResults(monthYear, drawType = 'Tous les tirages') {
  const url = `${CONFIG.lotto.apiUrl}?monthYear=${encodeURIComponent(monthYear)}&drawType=${encodeURIComponent(drawType)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${monthYear}:`, error.message);
    return null;
  }
}

/**
 * Get week number of the year
 */
function getWeekNumber(dateStr) {
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Extract and format draws from API response
 * 
 * Structure:
 * drawsResultsWeekly[] -> drawResultsDaily[] -> { date, drawResults: { nightDraws[], standardDraws[] } }
 */
function extractDraws(weeklyData, monthYear) {
  const draws = [];
  
  if (!weeklyData || !Array.isArray(weeklyData)) {
    return draws;
  }
  
  for (const week of weeklyData) {
    const dailyResults = week.drawResultsDaily || [];
    
    for (const day of dailyResults) {
      const dateStr = day.date;
      const parsedDate = parseFrenchDate(dateStr, monthYear);
      
      if (!parsedDate) {
        continue;
      }
      
      const drawDate = parsedDate.date;
      const dayOfWeek = parsedDate.dayOfWeek;
      const weekOfYear = getWeekNumber(drawDate);
      
      // Get draw results from nested structure
      const drawResults = day.drawResults || {};
      const nightDraws = drawResults.nightDraws || [];
      const standardDraws = drawResults.standardDraws || [];
      const allDraws = [...nightDraws, ...standardDraws];
      
      for (const draw of allDraws) {
        // Skip placeholder draws
        if (!draw.drawName || draw.drawName === '-') {
          continue;
        }
        
        const winningNumbers = parseNumbers(draw.winningNumbers);
        const machineNumbers = parseNumbers(draw.machineNumbers);
        
        if (!winningNumbers) {
          continue;
        }
        
        draws.push({
          draw_name: draw.drawName,
          draw_date: drawDate,
          day_of_week: dayOfWeek,
          week_of_year: weekOfYear,
          month_year: monthYear,
          winning_number_1: winningNumbers[0],
          winning_number_2: winningNumbers[1],
          winning_number_3: winningNumbers[2],
          winning_number_4: winningNumbers[3],
          winning_number_5: winningNumbers[4],
          machine_number_1: machineNumbers?.[0] || null,
          machine_number_2: machineNumbers?.[1] || null,
          machine_number_3: machineNumbers?.[2] || null,
          machine_number_4: machineNumbers?.[3] || null,
          machine_number_5: machineNumbers?.[4] || null,
          raw_winning_numbers: draw.winningNumbers,
          raw_machine_numbers: draw.machineNumbers
        });
      }
    }
  }
  
  return draws;
}

/**
 * Insert draws into database in batches
 */
async function insertDraws(draws) {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process in batches of 50
  const batchSize = 50;
  
  for (let i = 0; i < draws.length; i += batchSize) {
    const batch = draws.slice(i, i + batchSize);
    const records = [];
    
    for (const draw of batch) {
      const drawTypeId = await getDrawTypeId(draw.draw_name);
      
      if (!drawTypeId) {
        errors++;
        continue;
      }
      
      records.push({
        draw_type_id: drawTypeId,
        draw_date: draw.draw_date,
        day_of_week: draw.day_of_week,
        week_of_year: draw.week_of_year,
        month_year: draw.month_year,
        winning_number_1: draw.winning_number_1,
        winning_number_2: draw.winning_number_2,
        winning_number_3: draw.winning_number_3,
        winning_number_4: draw.winning_number_4,
        winning_number_5: draw.winning_number_5,
        machine_number_1: draw.machine_number_1,
        machine_number_2: draw.machine_number_2,
        machine_number_3: draw.machine_number_3,
        machine_number_4: draw.machine_number_4,
        machine_number_5: draw.machine_number_5,
        raw_winning_numbers: draw.raw_winning_numbers,
        raw_machine_numbers: draw.raw_machine_numbers
      });
    }
    
    if (records.length === 0) continue;
    
    const { data, error } = await supabase
      .from('draws')
      .upsert(records, { 
        onConflict: 'draw_type_id,draw_date,raw_winning_numbers',
        ignoreDuplicates: true 
      })
      .select('id');
    
    if (error) {
      if (error.code === '23505') {
        skipped += records.length;
      } else {
        console.error(`\n   Batch error:`, error.message);
        errors += records.length;
      }
    } else {
      inserted += data?.length || 0;
      skipped += records.length - (data?.length || 0);
    }
  }
  
  return { inserted, skipped, errors };
}

/**
 * Number to French month name
 */
const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

/**
 * Get current and previous month in French format
 */
function getRecentMonths() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  
  const months = [];
  
  // Current month
  months.push(`${MONTH_NAMES[currentMonth]} ${currentYear}`);
  
  // Previous month
  if (currentMonth === 0) {
    months.push(`${MONTH_NAMES[11]} ${currentYear - 1}`);
  } else {
    months.push(`${MONTH_NAMES[currentMonth - 1]} ${currentYear}`);
  }
  
  return months;
}

/**
 * Quick scraper - only fetches current and previous month
 * Ideal for regular updates
 */
async function scrapeRecent() {
  console.log('🎰 LOTTO PATTERNS - QUICK UPDATE');
  console.log('=' .repeat(50));
  console.log('');
  
  const months = getRecentMonths();
  console.log(`📅 Checking ${months.length} recent months: ${months.join(', ')}`);
  console.log('');
  
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalDraws = 0;
  
  for (const monthYear of months) {
    process.stdout.write(`📥 Fetching ${monthYear.padEnd(20)}... `);
    
    const data = await fetchMonthResults(monthYear);
    
    if (!data || !data.drawsResultsWeekly) {
      console.log('❌ No data');
      continue;
    }
    
    const draws = extractDraws(data.drawsResultsWeekly, monthYear);
    totalDraws += draws.length;
    
    if (draws.length > 0) {
      process.stdout.write(`${draws.length} draws → `);
      const { inserted, skipped, errors } = await insertDraws(draws);
      console.log(`✅ ${inserted} new, ${skipped} existing`);
      
      totalInserted += inserted;
      totalSkipped += skipped;
      totalErrors += errors;
    } else {
      console.log('0 draws');
    }
  }
  
  console.log('');
  console.log('─'.repeat(50));
  console.log(`📊 Quick Update: ${totalInserted} new draws added`);
  console.log('');
  
  return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors };
}

/**
 * Full scraper - fetches ALL available months
 * Use for initial setup or full resync
 */
async function scrapeAll() {
  console.log('🎰 LOTTO PATTERNS - FULL SCRAPE');
  console.log('=' .repeat(50));
  console.log('');
  
  // First, get the list of available months
  console.log('📅 Fetching available months...');
  const now = new Date();
  const currentMonthYear = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  const initialData = await fetchMonthResults(currentMonthYear);
  
  if (!initialData || !initialData.monthYears) {
    console.error('❌ Could not fetch month list from API');
    return { inserted: 0, skipped: 0, errors: 1 };
  }
  
  const months = initialData.monthYears;
  console.log(`✅ Found ${months.length} months of data`);
  console.log(`   From: ${months[months.length - 1]} to ${months[0]}`);
  console.log('');
  
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalDraws = 0;
  
  // Process each month
  for (let i = 0; i < months.length; i++) {
    const monthYear = months[i];
    const progress = `[${i + 1}/${months.length}]`;
    
    process.stdout.write(`${progress} Fetching ${monthYear.padEnd(20)}... `);
    
    const data = await fetchMonthResults(monthYear);
    
    if (!data || !data.drawsResultsWeekly) {
      console.log('❌ No data');
      continue;
    }
    
    const draws = extractDraws(data.drawsResultsWeekly, monthYear);
    totalDraws += draws.length;
    
    if (draws.length > 0) {
      process.stdout.write(`${draws.length} draws → `);
      const { inserted, skipped, errors } = await insertDraws(draws);
      console.log(`✅ ${inserted} new, ${skipped} skipped`);
      
      totalInserted += inserted;
      totalSkipped += skipped;
      totalErrors += errors;
    } else {
      console.log('0 draws');
    }
    
    // Small delay to be nice to the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('');
  console.log('=' .repeat(50));
  console.log('📊 SUMMARY');
  console.log('=' .repeat(50));
  console.log(`   Total draws found: ${totalDraws}`);
  console.log(`   Total inserted: ${totalInserted}`);
  console.log(`   Total skipped (duplicates): ${totalSkipped}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log('');
  console.log('✅ Scraping complete! Run: npm run analyze');
  
  return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors };
}

// Export functions for server use
export { extractDraws, fetchMonthResults, insertDraws, scrapeAll, scrapeRecent };

// Run based on command line argument
const mode = process.argv[2] || 'full';

if (mode === 'quick' || mode === '--quick' || mode === '-q') {
  scrapeRecent().catch(console.error);
} else {
  scrapeAll().catch(console.error);
}

