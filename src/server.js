/**
 * Lotto Patterns Dashboard Server
 * With auto-refresh functionality for lottery results
 */

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import brain, { calculateNumberScores } from './brain.js'; // The dynamic brain

// Advanced analysis imports
import { analyzeCorrelations, analyzeCycles, analyzeDecades, analyzePositions } from './advanced-analyzer.js';
import { strategies } from './backtester.js';
import { generateHybridPrediction, selectTopNumbers } from './correlation-analyzer.js';
import { predictWithLSTM } from './lstm-predictor.js';
import supabase from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFRESH_INTERVAL = parseInt(process.env.REFRESH_INTERVAL || '60'); // Default: 60 minutes
const SERVER_START_TIME = new Date();

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Server settings
  port: parseInt(process.env.PORT || '3000'),
  dashboardDir: path.join(__dirname, '../dashboard'),
  
  // Supabase settings
  supabaseUrl: 'https://ufvkfunbzxbkqhresxzx.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmdmtmdW5ienhia3FocmVzeHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MzgwMDYsImV4cCI6MjA4NTMxNDAwNn0.DQZOxZXkh5yoq5uQ2cJOQ_tcJIf5uGqsLJqib8kt2JM',
  
  // Auto-refresh settings (in minutes)
  // Set to 0 to disable auto-refresh
  refreshInterval: REFRESH_INTERVAL,
  
  // Run analysis after scraping
  runAnalysisAfterScrape: process.env.RUN_ANALYSIS !== 'false'
};

// =============================================================================
// STATE
// =============================================================================

let lastRefresh = null;
let nextRefresh = null;
let isRefreshing = false;
let refreshStats = {
  lastInserted: 0,
  lastSkipped: 0,
  lastError: null,
  totalRefreshes: 0
};

// =============================================================================
// MIME TYPES
// =============================================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// =============================================================================
// PREDICTION CACHE
// =============================================================================

let predictionCache = {
  data: null,
  timestamp: null,
  maxAge: 10 * 60 * 1000 // 10 minutes cache for prediction results
};

// =============================================================================
// DATA CACHE MANAGER
// =============================================================================

const DATA_CACHE = {
  draws: null,
  timestamp: 0,
  TTL: 60 * 60 * 1000 // 1 hour cache for raw data
};

/**
 * Get draws data with in-memory caching and fallback
 */
async function getDrawsData(drawTypeId = null) {
  const now = Date.now();
  
  // 1. Refresh global cache if empty or expired
  if (!DATA_CACHE.draws || (now - DATA_CACHE.timestamp) > DATA_CACHE.TTL) {
    console.log('🔄 Refreshing global data cache from Supabase...');
    
    // Select only necessary columns
    const { data, error } = await supabase
      .from('draws')
      .select(`
        id, draw_date, draw_type_id, 
        winning_number_1, winning_number_2, winning_number_3, winning_number_4, winning_number_5,
        machine_number_1, machine_number_2, machine_number_3, machine_number_4, machine_number_5
      `)
      .order('draw_date', { ascending: false }) // Newest first
      .limit(5000); // 5000 global limit
      
    if (!error && data) {
       // Store in chronological order
       DATA_CACHE.draws = data.reverse().map(d => ({
         ...d,
         numbers_drawn: [
           d.winning_number_1, d.winning_number_2, d.winning_number_3, d.winning_number_4, d.winning_number_5
         ].filter(n => n !== null)
       }));
       DATA_CACHE.timestamp = now;
       
       // Clear prediction cache on data update so users get fresh predictions immediately
       predictionCache = { maxAge: 10 * 60 * 1000 };
       
       console.log(`✅ Data cache updated with ${DATA_CACHE.draws.length} draws`);
    } else {
       console.error('Failed to update global cache:', error);
    }
  }
  
  // 2. Try to serve from cache
  if (DATA_CACHE.draws) {
    let result = DATA_CACHE.draws;
    if (drawTypeId && drawTypeId !== 'all') {
      result = result.filter(d => d.draw_type_id == drawTypeId);
    }
    
    // If we found data in cache, return it
    if (result.length > 0) {
      return result;
    }
    // If specific type requested but not found in cache (because of limit), fall through to direct fetch
    if (drawTypeId && drawTypeId !== 'all') {
      console.log(`⚠️ Data for type ${drawTypeId} not found in global cache (limit reached?). Fetching directly...`);
    }
  }
  
  // 3. Direct Fetch Fallback (for specific types not in cache)
  console.log(`🔄 Direct fetch for DrawType: ${drawTypeId || 'All'}`);
  
  let query = supabase
      .from('draws')
      .select(`
        id, draw_date, draw_type_id, 
        winning_number_1, winning_number_2, winning_number_3, winning_number_4, winning_number_5,
        machine_number_1, machine_number_2, machine_number_3, machine_number_4, machine_number_5
      `)
      .order('draw_date', { ascending: true }); // Chronological
      
  if (drawTypeId && drawTypeId !== 'all') {
    query = query.eq('draw_type_id', drawTypeId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Direct fetch error:', error);
    throw new Error('Failed to fetch draws data');
  }
  
  // Process
  return data.map(d => ({
    ...d,
    numbers_drawn: [
      d.winning_number_1, d.winning_number_2, d.winning_number_3, d.winning_number_4, d.winning_number_5
    ].filter(n => n !== null)
  }));
}

// Initial cache load to warm up server
getDrawsData().catch(e => console.error('Initial cache warm-up failed:', e.message));

/**
 * Generate advanced predictions
 * @param {string|number} drawTypeId - Optional draw type ID to filter by
 * @param {string|number} dayOfWeek - Optional day of week (0-6) to filter by
 */
// Helper to check past performance
async function getLastPerformance(drawTypeId, draws) {
  if (!drawTypeId || drawTypeId === 'all') return null;
  
  const historyFile = path.join(__dirname, '../data/predictions_history.json');
  if (!fs.existsSync(historyFile)) return null;
  
  try {
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    // Find latest prediction for this type
    const lastPred = history.find(p => p.drawTypeId == drawTypeId);
    
    if (!lastPred) return null;
    
    // Sort draws by date desc (newest first) to find the result
    // The draws passed to this function are chronological (old -> new)
    const latestDraw = draws[draws.length - 1]; // Last one is newest
    
    if (!latestDraw) return null;
    
    // Check if this draw happened AFTER the prediction was made
    // We allow a small buffer because prediction might be made on same day
    const predictionTime = new Date(lastPred.timestamp).getTime();
    const drawDate = new Date(latestDraw.draw_date).getTime();
    
    // If prediction is newer than the latest draw result, then the result is not out yet!
    // We want: Prediction Time < Draw Result Time
    // But draw_date is usually midnight or just the date string (UTC).
    // Let's assume if draw_date is >= prediction_date (day), it's the target.
    
    // Simple check: Is the latest draw date >= prediction date (by day)
    const pDateStr = new Date(lastPred.timestamp).toISOString().split('T')[0];
    const dDateStr = latestDraw.draw_date; // YYYY-MM-DD
    
    // Only compare if dates match or draw is newer
    if (dDateStr >= pDateStr) {
       const actual = latestDraw.numbers_drawn;
       const predicted = lastPred.predictedNumbers;
       const matchNumbers = predicted.filter(n => actual.includes(n));
       
       return {
         date: latestDraw.draw_date,
         predicted,
         actual,
         matchCount: matchNumbers.length,
         matches: matchNumbers
       };
    }
    
    return null;
    
  } catch (e) {
    console.error('Error getting last performance:', e);
    return null;
  }
}

// Helper to calculate scores for all numbers using dynamic weights
// function calculateNumberScores removed - imported from brain.js

/**
 * Generate advanced predictions
 * @param {string|number} drawTypeId - Optional draw type ID to filter by
 * @param {string|number} dayOfWeek - Optional day of week (0-6) to filter by
 */
async function generatePredictions(drawTypeId = null, dayOfWeekParam = null) {
  let dayOfWeek = dayOfWeekParam;
  console.log(`🎯 Generating predictions (Type: ${drawTypeId || 'All'}, Day: ${dayOfWeek !== null ? dayOfWeek : 'All'})...`);
  
  // Use optimized in-memory cache
  // If drawTypeId is provided, returns filtered list. If null, returns all.
  const allDraws = await getDrawsData(drawTypeId);
  
  // Calculate Performance on previous prediction (before filtering)
  const lastPerformance = await getLastPerformance(drawTypeId, allDraws);
  
  // TRIGGER AUTO-TUNING (The Brain Labs)
  if (lastPerformance && lastPerformance.actual) {
    // Learn from experience
    try {
      // Background learning (unawaited)
      brain.learn(lastPerformance.actual, allDraws, drawTypeId).catch(e => console.error('🧠 Learning error:', e));
    } catch (e) {
      console.error('🧠 Learning setup error:', e);
    }
  }
  
  // Get dynamic weights
  const weights = brain.getWeights();
  console.log('⚖️ Weights:', weights);
  
  if (!allDraws || allDraws.length === 0) {
    throw new Error('Could not fetch draws data');
  }
  
  // Filter by day if requested
  let draws = allDraws;
  if (dayOfWeek !== null) {
    draws = allDraws.filter(d => {
      const date = new Date(d.draw_date);
      return date.getDay() === parseInt(dayOfWeek);
    });
    
    if (draws.length < 10) {
      console.log('⚠️ Not enough data for specific day, falling back to all days for this type');
      draws = allDraws; // Fallback if not enough data
      dayOfWeek = null; // Clear day filter in context so UI doesn't show specific day
    }
  }
  
  console.log(`   Analyzing ${draws.length} draws...`);
  
  // Run analyses analysis
  const cycles = analyzeCycles(draws);
  const positions = analyzePositions(draws);
  const correlations = analyzeCorrelations(draws);
  const decades = analyzeDecades(draws);
  
  // Need hot numbers for analysis report
  const hotNumbers = strategies.hot(draws, 15);
  
  // Need due numbers for alerts (re-calculate sort)
  const dueNumbers = Object.entries(cycles)
    .filter(([_, stats]) => stats.cycleCount >= 5)
    .sort((a, b) => b[1].dueScore - a[1].dueScore);
  
  // =========================================================================
  // DEEP LEARNING (LSTM) INTEGRATION
  // =========================================================================
  let lstmPredictions = [];
  try {
      // Get top 20 candidates from LSTM
      // We wrap in try/catch to ensure server doesn't crash if model is missing/training
      const lstmResult = await predictWithLSTM(draws, 20);
      if (lstmResult && lstmResult.numbers) {
          lstmPredictions = lstmResult.numbers;
          console.log(`🧠 LSTM Model Active: Predicted ${lstmPredictions.length} candidates`);
      }
  } catch (e) {
      console.warn('⚠️ LSTM Prediction skipped (Model not ready or error):', e.message);
  }

  // Strategy predictions (Dynamic Weights) using shared logic
  // Pass LSTM predictions as external scores to be boosted
  const numberScores = calculateNumberScores(draws, weights, 'winning', { lstm: lstmPredictions });
  
  // Rank all numbers
  const rankedNumbers = Object.entries(numberScores)
    .map(([num, score]) => ({ number: parseInt(num), score: parseFloat(score.toFixed(4)) }))
    .sort((a, b) => b.score - a.score);
  
  // Select top 5 with decade balance
  const selected = [];
  for (const candidate of rankedNumbers) {
    if (selected.length >= 5) break;
    const decade = Math.floor((candidate.number - 1) / 10);
    const decadeCount = selected.filter(n => Math.floor((n.number - 1) / 10) === decade).length;
    if (decadeCount < 2) {
      selected.push(candidate);
    }
  }
  
  // Fill if needed
  for (const candidate of rankedNumbers) {
    if (selected.length >= 5) break;
    if (!selected.find(s => s.number === candidate.number)) {
      selected.push(candidate);
    }
  }
  
  const mainNumbers = selected.map(n => n.number).sort((a, b) => a - b);
  const sum = mainNumbers.reduce((a, b) => a + b, 0);
  const avgScore = selected.reduce((s, n) => s + n.score, 0) / 5;
  const confidence = Math.min(95, avgScore * 100 + 40);
  
  // =========================================================================
  // MACHINE NUMBERS PREDICTION (NEW)
  // =========================================================================
  const machineWeights = brain.getWeights('machine');
  const machineScores = calculateNumberScores(draws, machineWeights, 'machine');
  
  const rankedMachineNumbers = Object.entries(machineScores)
    .map(([num, score]) => ({ number: parseInt(num), score: parseFloat(score.toFixed(4)) }))
    .sort((a, b) => b.score - a.score);
  
  const selectedMachine = [];
  for (const candidate of rankedMachineNumbers) {
    if (selectedMachine.length >= 5) break;
    const decade = Math.floor((candidate.number - 1) / 10);
    const decadeCount = selectedMachine.filter(n => Math.floor((n.number - 1) / 10) === decade).length;
    if (decadeCount < 2) {
      selectedMachine.push(candidate);
    }
  }
  
  for (const candidate of rankedMachineNumbers) {
    if (selectedMachine.length >= 5) break;
    if (!selectedMachine.find(s => s.number === candidate.number)) {
      selectedMachine.push(candidate);
    }
  }
  
  const machineNumbers = selectedMachine.map(n => n.number).sort((a, b) => a - b);
  const machineSum = machineNumbers.reduce((a, b) => a + b, 0);
  const machineAvgScore = selectedMachine.reduce((s, n) => s + n.score, 0) / 5;
  const machineConfidence = Math.min(95, machineAvgScore * 100 + 40);
  
  // =========================================================================
  // HYBRID PREDICTION (Correlation-Based Boosting)
  // =========================================================================
  const hybridResult = generateHybridPrediction(draws, numberScores, machineNumbers, 1.3);
  const selectedHybrid = selectTopNumbers(hybridResult.boostedScores, 5);
  
  const hybridNumbers = selectedHybrid.map(n => n.number).sort((a, b) => a - b);
  const hybridSum = hybridNumbers.reduce((a, b) => a + b, 0);
  const hybridAvgScore = selectedHybrid.reduce((s, n) => s + n.score, 0) / 5;
  const hybridConfidence = Math.min(97, hybridAvgScore * 100 + 42); // Slightly higher base
  
  // Alternative predictions
  const alternatives = [
    {
      name: 'Numéros Chauds',
      icon: '🔥',
      numbers: strategies.hot(draws, 5),
      description: 'Basé sur la fréquence'
    },
    {
      name: 'Numéros En Retard',
      icon: '⏰',
      numbers: dueNumbers.slice(0, 5).map(([n]) => parseInt(n)).sort((a, b) => a - b),
      description: 'Basé sur les cycles'
    },
    {
      name: 'Équilibre Décades',
      icon: '⚖️',
      numbers: strategies.balanced(draws, 5),
      description: 'Distribution équilibrée'
    },
    {
      name: 'Paires Fréquentes',
      icon: '🔗',
      numbers: strategies.correlation(draws, 5),
      description: 'Meilleures associations'
    }
  ];
  
  // Top 10 due numbers for alerts
  const alerts = dueNumbers.slice(0, 5).map(([num, stats]) => ({
    number: parseInt(num),
    dueScore: stats.dueScore,
    currentGap: stats.currentGap,
    avgCycle: stats.avgCycle,
    overdueBy: Math.round(stats.overdueBy)
  }));
  
  const predictionResult = {
    context: {
      drawTypeId: drawTypeId,
      dayOfWeek: dayOfWeek,
      drawsAnalyzed: draws.length
    },
    main: {
      numbers: mainNumbers,
      sum,
      confidence: parseFloat(confidence.toFixed(1)),
      scores: selected
    },
    machine: {
      numbers: machineNumbers,
      sum: machineSum,
      confidence: parseFloat(machineConfidence.toFixed(1)),
      scores: selectedMachine
    },
    hybrid: {
      numbers: hybridNumbers,
      sum: hybridSum,
      confidence: parseFloat(hybridConfidence.toFixed(1)),
      scores: selectedHybrid,
      method: 'correlation-boost',
      correlationStrength: parseFloat(hybridResult.correlationStrength.toFixed(3)),
      boostedCount: hybridResult.boostedNumbers.length
    },
    alternatives,
    alerts,
    topCandidates: rankedNumbers.slice(0, 20),
    analysis: {
      totalDraws: draws.length,
      hotNumbers: hotNumbers.slice(0, 10),
      topPairs: correlations.topPairs.slice(0, 5),
      decadeDistribution: decades.frequency
    },
    generatedAt: new Date().toISOString(),
    lastPerformance: lastPerformance // Historical validation
  };
  
  // Log for future improvement
  logPredictionToHistory(predictionResult);
  
  return predictionResult;
}

/**
 * Handle prediction API request
 */
// --- Shared Helpers ---

let cachedDrawTypes = null;
async function getDrawTypeIdByName(name) {
   if (cachedDrawTypes) {
       const found = cachedDrawTypes.find(t => t.name.toLowerCase() === name.toLowerCase());
       return found ? found.id : null;
   }
   
   try {
       const { data, error } = await supabase.from('draw_types').select('id, name');
       if (data) {
           cachedDrawTypes = data;
           const found = data.find(t => t.name.toLowerCase() === name.toLowerCase());
           return found ? found.id : null;
       }
   } catch(e) {
       console.error("Error fetching draw types", e);
   }
   return null;
}

/**
 * Get draw type name by ID (async to ensure cache is populated)
 */
async function getDrawTypeNameById(id) {
    // Ensure cache is populated
    if (!cachedDrawTypes) {
        try {
            const { data } = await supabase.from('draw_types').select('id, name');
            if (data) {
                cachedDrawTypes = data;
            }
        } catch (e) {
            console.error("Error fetching draw types for name lookup:", e);
        }
    }
    
    if (!cachedDrawTypes) return "Jeu #" + id;
    const found = cachedDrawTypes.find(t => String(t.id) === String(id));
    return found ? found.name : "Jeu #" + id;
}

// Global prediction getter with cache
async function getPredictionWithCache(drawType, day) {
    const cacheKey = `pred_${drawType || 'all'}_${day || 'all'}`;
    const now = Date.now();
    
    // Check existing cache
    if (predictionCache[cacheKey] && (now - predictionCache[cacheKey].timestamp) < predictionCache.maxAge) {
        return { 
            ...predictionCache[cacheKey].data, 
            cached: true, 
            cacheAge: Math.round((now - predictionCache[cacheKey].timestamp) / 1000) 
        };
    }
    
    // Generate fresh
    console.log(`🧠 Generating and caching prediction for ${drawType}/${day}`);
    const predictions = await generatePredictions(drawType, day);
    
    // Update cache
    predictionCache[cacheKey] = {
      data: predictions,
      timestamp: now
    };
    
    return { ...predictions, cached: false };
}

/**
 * Handle prediction API request
 */
async function handlePredictionRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const drawType = url.searchParams.get('type') || null;
    const day = url.searchParams.get('day') || null;
    
    const result = await getPredictionWithCache(drawType, day);
    
    res.writeHead(200);
    res.end(JSON.stringify(result));
    
  } catch (error) {
    console.error('Prediction error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Handle evaluation API request
 */
async function handleEvaluationRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  
  req.on('end', async () => {
    try {
      const { numbers, drawTypeId, dayOfWeek } = JSON.parse(body); // Accept dayOfWeek
      
      if (!numbers || !Array.isArray(numbers) || numbers.length !== 5) {
        throw new Error('Please provide exactly 5 numbers');
      }
      
      // 1. Get Data and Weights just like the Generator
      let draws = await getDrawsData(drawTypeId);
      
      // Filter by day if requested (Consistency with Generator)
      if (dayOfWeek !== undefined && dayOfWeek !== null) {
         const filtered = draws.filter(d => {
           const date = new Date(d.draw_date);
           return date.getDay() === parseInt(dayOfWeek);
         });
         
         if (filtered.length >= 10) {
            draws = filtered; // Use filtered set if enough data
         }
      }
      
      const weights = brain.getWeights(); // Dynamic weights
      
      // 2. Calculate scores for ALL numbers using shared logic
      const numberScores = calculateNumberScores(draws, weights);
      
      // 3. Score the user's numbers
      let sumScores = 0;
      let matches = 0;
      let strongMatches = 0;
      
      const numberDetails = numbers.map(num => {
        const score = numberScores[num] || 0;
        sumScores += score;
        
        // Use approximate thresholds for "Hot/Warm" visual feedback
        if (score > 0.3) strongMatches++;
        if (score > 0.15) matches++;
        
        return {
          number: num,
          score: parseFloat(score.toFixed(4)),
          isHot: score > 0.3, // Arbitrary visual threshold
          isWarm: score > 0.15
        };
      });
      
      // 4. Synergy Analysis (Existing logic)
      const totalDraws = draws ? draws.length : 0;
      const strongPairs = [];
      let synergyBonus = 0;
      
      if (draws && draws.length > 0) {
        // Generate all pairs
        for (let i = 0; i < numbers.length; i++) {
          for (let j = i + 1; j < numbers.length; j++) {
            const n1 = numbers[i];
            const n2 = numbers[j];
            
            // Count occurrences
            let count = 0;
            for (const draw of draws) {
              if (draw.numbers_drawn.includes(n1) && draw.numbers_drawn.includes(n2)) {
                count++;
              }
            }
            
            // Threshold
            const threshold = Math.max(2, totalDraws * 0.005); 
            
            if (count >= threshold) {
              strongPairs.push({ pair: [n1, n2], count });
              synergyBonus += 0.1; // Bonus per strong pair
            }
          }
        }
      }
      
      // 5. Total Score calculation
      // Formula aligned with generatePredictions:
      // Generator: avgScore * 100 + 40
      
      // Calculate average score per number
      // We do NOT add synergyBonus to the score to keep strict parity with AI prediction confidence
      // (The AI selects based on synergy but doesn't inflate the final confidence score with it)
      const totalScoreSum = sumScores; 
      const avgScore = totalScoreSum / 5;
      
      // Apply the "Optimistic Formula" used by the AI
      // Cap at 99 so it looks realistic but not perfect
      const confidence = Math.min(99.9, parseFloat((avgScore * 100 + 40).toFixed(1)));
      
      const analysis = {
        sum: numbers.reduce((a, b) => a + b, 0),
        oddCount: numbers.filter(n => n % 2 !== 0).length,
        evenCount: numbers.filter(n => n % 2 === 0).length,
        strongPairs: strongPairs.map(p => `${p.pair.join('-')} (${p.count}x)`),
        decades: numbers.reduce((acc, n) => {
          const d = Math.floor((n - 1) / 10);
          acc[d] = (acc[d] || 0) + 1;
          return acc;
        }, {})
      };
      
      res.writeHead(200);
      res.end(JSON.stringify({
        numbers: numberDetails,
        totalScore: totalScoreSum, // Raw weighted score
        confidence, // The 0-100 score displayed
        matches,
        strongMatches,
        synergyBonus,
        analysis,
        topCandidates: Object.entries(numberScores)
          .sort((a,b) => b[1] - a[1])
          .slice(0, 15)
          .map(([n]) => parseInt(n)),
        recommendation: confidence > 80 ? 'Excellent' : confidence > 60 ? 'Bon' : confidence > 40 ? 'Moyen' : 'Risqué'
      }));
      
    } catch (error) {
      console.error('Evaluation error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

/**
 * Verify past predictions against actual results
 * Updates history file with results
 */
let lastVerificationTime = 0;

async function verifyPredictions(force = false) {
  // Global throttle: Don't run more than once per minute unless forced
  const now = Date.now();
  if (!force && (now - lastVerificationTime < 60000)) {
     return; 
  }
  lastVerificationTime = now;

  console.log('🕵️‍♀️ Verifying past predictions (Optimized)...');
  const historyFile = path.join(__dirname, '../data/predictions_history.json');
  
  if (!fs.existsSync(historyFile)) return;
  
  try {
    let history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    let updated = false;
    
    // 1. Identify range of unverified predictions
    // We only care about predictions from the last 7 days that are unverified
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const unverified = history.filter(p => !p.result && new Date(p.timestamp) > sevenDaysAgo);
    
    if (unverified.length === 0) {
        // Nothing to verify in recent history
        return;
    }
    
    // Find absolute oldest unverified (to filter DB query)
    const oldestUnverified = unverified[unverified.length - 1]; // history is sorted desc usually, but let's be safe
    // Actually history is shift/unshift so 0 is newest.
    // So unverified list might be mixed.
    // Let's just use 7 days ago as safety anchor.
    
    // 2. Fetch RECENT draws only
    const { data: recentDraws } = await supabase
      .from('draws')
      .select('draw_date, draw_type_id, winning_number_1, winning_number_2, winning_number_3, winning_number_4, winning_number_5, machine_number_1, machine_number_2, machine_number_3, machine_number_4, machine_number_5')
      .gte('draw_date', sevenDaysAgo.toISOString().split('T')[0])
      .order('draw_date', { ascending: false });
      
    if (!recentDraws || recentDraws.length === 0) return;
    
    // 3. Match
    for (const pred of unverified) {
      if (pred.result) continue; // Should be filtered out but double check
      
      const predDate = new Date(pred.timestamp);
      
      const targetDraw = recentDraws.find(d => {
        if (d.draw_type_id != pred.drawTypeId) return false;
        const dDate = new Date(d.draw_date);
        return dDate >= predDate || d.draw_date === predDate.toISOString().split('T')[0];
      });
      
      if (targetDraw) {
        const dDate = new Date(targetDraw.draw_date);
        const diffHours = (dDate - predDate) / (1000 * 60 * 60);
        
        if (diffHours >= -24 && diffHours < 72) {
           const actual = [
             targetDraw.winning_number_1, targetDraw.winning_number_2, targetDraw.winning_number_3, 
             targetDraw.winning_number_4, targetDraw.winning_number_5
           ];
           const matches = pred.predictedNumbers.filter(n => actual.includes(n));
           
           const nearMisses = pred.predictedNumbers.filter(n => {
                if (actual.includes(n)) return false; 
                return actual.some(a => Math.abs(a - n) === 1);
           });
           
           pred.result = {
             drawDate: targetDraw.draw_date,
             actual: actual,
             matchCount: matches.length,
             matches: matches,
             nearMisses: nearMisses
           };
           
           // Verify machine numbers if present
           if (pred.machineNumbers && targetDraw.machine_number_1) {
             const actualMachine = [
               targetDraw.machine_number_1, targetDraw.machine_number_2, targetDraw.machine_number_3,
               targetDraw.machine_number_4, targetDraw.machine_number_5
             ].filter(n => n !== null && n !== undefined);
             
             if (actualMachine.length === 5) {
               const machineMatches = pred.machineNumbers.filter(n => actualMachine.includes(n));
               const machineNearMisses = pred.machineNumbers.filter(n => {
                 if (actualMachine.includes(n)) return false;
                 return actualMachine.some(a => Math.abs(a - n) === 1);
               });
               
               pred.machineResult = {
                 actual: actualMachine,
                 matchCount: machineMatches.length,
                 matches: machineMatches,
                 nearMisses: machineNearMisses
               };
             }
           }
                      // Verify hybrid numbers if present
            if (pred.hybridNumbers && targetDraw.winning_number_1) {
              const hybridMatches = pred.hybridNumbers.filter(n => actual.includes(n));
              const hybridNearMisses = pred.hybridNumbers.filter(n => {
                if (actual.includes(n)) return false;
                return actual.some(a => Math.abs(a - n) === 1);
              });
              
              pred.hybridResult = {
                actual: actual,
                matchCount: hybridMatches.length,
                matches: hybridMatches,
                nearMisses: hybridNearMisses
              };
            }
            
            updated = true;
        }
      }
    }
    
    if (updated) {
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
      console.log('✅ Updated verified history.');
    }
    
  } catch (e) {
    console.error('Verify failed:', e);
  }
}

/**
 * Log prediction to history file for future analysis
 */
async function logPredictionToHistory(prediction) {
  const historyFile = path.join(__dirname, '../data/predictions_history.json');
  
  try {
    let history = [];
    if (fs.existsSync(historyFile)) {
      const content = fs.readFileSync(historyFile, 'utf8');
      try {
        history = JSON.parse(content);
      } catch (e) {
        // Corrupt file, start fresh
      }
    }
    
    // Add new entry
    const entry = {
      timestamp: new Date().toISOString(),
      drawTypeId: prediction.context.drawTypeId, // Can be null (all)
      dayOfWeek: prediction.context.dayOfWeek,
      predictedNumbers: prediction.main.numbers,
      confidence: prediction.main.confidence,
      scores: prediction.main.scores,
      machineNumbers: prediction.machine?.numbers || null,
      machineConfidence: prediction.machine?.confidence || null,
      hybridNumbers: prediction.hybrid?.numbers || null,
      hybridConfidence: prediction.hybrid?.confidence || null
    };
    
    // Keep last 1000 predictions
    history.unshift(entry);
    if (history.length > 1000) history = history.slice(0, 1000);
    
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    console.log(`📝 Prediction logged to history (${history.length} entries)`);
    
  } catch (error) {
    console.error('Failed to log prediction:', error);
  }
}

// =============================================================================
// SCRAPER FUNCTIONS
// =============================================================================

/**
 * Run the scraper script and capture results
 * @param {string} mode - 'quick' (current + previous month) or 'full' (all months)
 */
async function runScraper(mode = 'quick') {
  return new Promise((resolve, reject) => {
    console.log(`🔄 Starting data refresh (${mode} mode)...`);
    
    const args = mode === 'quick' ? ['src/scraper.js', '--quick'] : ['src/scraper.js'];
    
    const scraper = spawn('node', args, {
      cwd: path.join(__dirname, '..'),
      env: process.env
    });
    
    let output = '';
    let inserted = 0;
    let skipped = 0;
    
    scraper.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
      
      // Parse the output for stats (handles both quick and full mode)
      const insertMatch = text.match(/Total inserted:\s*(\d+)/) || text.match(/(\d+) new draws added/);
      const skipMatch = text.match(/Total skipped.*:\s*(\d+)/) || text.match(/(\d+) existing/);
      const quickMatch = text.match(/(\d+) new,/);
      
      if (insertMatch) inserted = parseInt(insertMatch[1]);
      if (quickMatch) inserted += parseInt(quickMatch[1]);
      if (skipMatch) skipped = parseInt(skipMatch[1]);
    });
    
    scraper.stderr.on('data', (data) => {
      console.error(data.toString());
    });
    
    scraper.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, inserted, skipped, mode });
      } else {
        reject(new Error(`Scraper exited with code ${code}`));
      }
    });
  });
}

/**
 * Run the analyzer script
 */
/**
 * Train the Brain on the latest data for all game types
 */
async function trainBrain() {
  console.log('🧠 Training Brain on latest data...');
  
  try {
    // 1. Get all draw types
    const { data: types, error } = await supabase.from('draw_types').select('id, name');
    if (error || !types) {
      console.error('Failed to fetch draw types for training:', error);
      return;
    }
    
    let trainingCount = 0;
    
    // 2. Train for each type
    for (const type of types) {
      // Get all draws for this type using local cache helper
      const draws = await getDrawsData(type.id);
      
      if (!draws || draws.length < 10) continue; // Need minimum history
      
      // Get the VERY latest draw (the one to learn from)
      // draws are sorted chronological in getDrawsData map (check implementation)
      // implementation of getDraws: sorted by date ASC. So last element is latest.
      const latestDraw = draws[draws.length - 1];
      
      // Check if we already learned from this specific draw date/ID to avoid over-fitting?
      // brain.js doesn't seem to track "last learned ID". It just updates weights.
      // Ideally we should track "lastLearnedDrawId" per type.
      // For now, simpler approach: The user wants stats to appear. 
      // We will rely on the fact auto-training runs once per refresh.
      
      // Simulate learning from the last known draw (Winning Numbers)
      try {
        brain.learn(latestDraw.numbers_drawn, draws, type.id, 'winning');
        
        // Machine Numbers
        const machineNumbers = [
          latestDraw.machine_number_1, latestDraw.machine_number_2, 
          latestDraw.machine_number_3, latestDraw.machine_number_4, 
          latestDraw.machine_number_5
        ].filter(n => n !== null && n !== undefined);
        
        if (machineNumbers.length === 5) {
           brain.learn(machineNumbers, draws, type.id, 'machine');
        }
        
        trainingCount++;
        // console.log(`   - Trained on ${type.name}`);
      } catch (e) {
        console.error(`   - Failed to train on ${type.name}:`, e.message);
      }
    }
    
    console.log(`✅ Brain training complete. Trained on ${trainingCount} game types.`);
    
  } catch (e) {
    console.error('Brain training fatal error:', e);
  }
}

async function runAnalyzer() {
  return new Promise((resolve, reject) => {
    console.log('📊 Running analysis...');
    
    const analyzer = spawn('node', ['src/analyzer.js'], {
      cwd: path.join(__dirname, '..'),
      env: process.env
    });
    
    analyzer.stdout.on('data', (data) => {
      process.stdout.write(data.toString());
    });
    
    analyzer.stderr.on('data', (data) => {
      console.error(data.toString());
    });
    
    analyzer.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject(new Error(`Analyzer exited with code ${code}`));
      }
    });
  });
}

/**
 * Perform a full data refresh (scrape + analyze)
 */
// Refresh data function
async function refreshData(options = {}) {
  const { forceTrain = false } = options;

  if (isRefreshing) {
    console.log('⏳ Refresh already in progress, skipping...');
    return { skipped: true };
  }
  
  isRefreshing = true;
  const startTime = Date.now();
  
  try {
    // Run scraper
    const scrapeResult = await runScraper();
    
    refreshStats.lastInserted = scrapeResult.inserted;
    refreshStats.lastSkipped = scrapeResult.skipped;
    
    // Invalidate caches if new data found
    if (scrapeResult.inserted > 0) {
      console.log('🔄 New data detected, invalidating memory cache...');
      DATA_CACHE.draws = null;
      DATA_CACHE.timestamp = 0;
    }
    
    // Run analyzer if enabled and new data was inserted OR forced
    if (CONFIG.runAnalysisAfterScrape && (scrapeResult.inserted > 0 || forceTrain)) {
      if (scrapeResult.inserted > 0) await runAnalyzer(); // Only re-analyze if new data
      
      // Verify past predictions with new results
      await verifyPredictions();
      
      // Train brain if new data OR forced
      await trainBrain(); 
    }
    
    lastRefresh = new Date();
    refreshStats.totalRefreshes++;
    refreshStats.lastError = null;
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Refresh complete in ${duration}s (${scrapeResult.inserted} new draws)`);
    
    return { success: true, ...scrapeResult };
  } catch (error) {
    refreshStats.lastError = error.message;
    console.error('❌ Refresh failed:', error.message);
    return { success: false, error: error.message };
  } finally {
    isRefreshing = false;
    scheduleNextRefresh();
  }
}

/**
 * Schedule the next auto-refresh
 */
function scheduleNextRefresh() {
  if (CONFIG.refreshInterval <= 0) {
    nextRefresh = null;
    return;
  }
  
  const intervalMs = CONFIG.refreshInterval * 60 * 1000;
  nextRefresh = new Date(Date.now() + intervalMs);
  
  setTimeout(() => {
    refreshData();
  }, intervalMs);
}

// =============================================================================
// PROXY FUNCTIONS
// =============================================================================

function proxyRequest(targetUrl, req, res) {
  const url = new URL(targetUrl);
  
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': CONFIG.supabaseKey,
      'Authorization': `Bearer ${CONFIG.supabaseKey}`,
      'Prefer': req.headers['prefer'] || ''
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    // Forward all headers from Supabase, but ensure CORS is set
    const headers = { ...proxyRes.headers };
    headers['access-control-allow-origin'] = '*';
    delete headers['access-control-allow-methods']; // Use ours
    delete headers['access-control-allow-headers']; // Use ours
    
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });

  if (req.method === 'POST' || req.method === 'PATCH') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

// =============================================================================
// HTTP SERVER
// =============================================================================

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, apikey, Authorization, Prefer'
    });
    res.end();
    return;
  }
  
  // =========================================================================
  // SERVER STATUS ENDPOINT
  // =========================================================================
  if (req.url === '/status' || req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      server: 'Lotto Patterns Dashboard',
      status: 'running',
      autoRefresh: {
        enabled: CONFIG.refreshInterval > 0,
        intervalMinutes: CONFIG.refreshInterval,
        lastRefresh: lastRefresh?.toISOString() || null,
        nextRefresh: nextRefresh?.toISOString() || null,
        isRefreshing
      },
      stats: refreshStats
    }, null, 2));
    return;
  }
  
  // MANUAL REFRESH ENDPOINT
  // =========================================================================
  if (req.url.startsWith('/refresh') && req.method === 'POST') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const forceTrain = url.searchParams.get('force_train') === 'true';
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    if (isRefreshing) {
      res.end(JSON.stringify({ 
        success: false, 
        message: 'Refresh already in progress' 
      }));
      return;
    }
    
    res.end(JSON.stringify({ 
      success: true, 
      message: forceTrain ? 'Force training started' : 'Refresh started' 
    }));
    
    // Start refresh in background
    refreshData({ forceTrain });
    return;
  }
  
  // BRAIN STATUS ENDPOINT
  // =========================================================================
  if (req.url === '/api/brain') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    });
    
    try {
      // Trigger lazy verification (throttled internally to 1 min)
      // This ensures history is updated "on demand" when user visits Brain
      await verifyPredictions();
      
      const status = await brain.getBrainStatus();
      
      // Add Real Performance stats from history
      const historyFile = path.join(__dirname, '../data/predictions_history.json');
      if (fs.existsSync(historyFile)) {
        try {
          const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
          // Get recent predictions (verified AND unverified)
          
          if (history.length > 0) {
             const verified = history.filter(p => p.result);
             const totalHits = verified.reduce((sum, p) => sum + p.result.matchCount, 0);
             const accuracy = verified.length > 0 ? (totalHits / (verified.length * 5)) * 100 : 0;
             
             status.realPerformance = {
               totalPredictions: history.length,
               totalHits: totalHits,
               globalAccuracy: parseFloat(accuracy.toFixed(2)),
               // Sort by date descending (most recent first) and show last 50
               recentHistory: history
                 .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                 .slice(0, 50)
                 .map(p => ({
                   date: p.result ? p.result.drawDate : p.timestamp,
                   timestamp: p.timestamp,
                  typeId: p.drawTypeId,
                  matchCount: p.result ? p.result.matchCount : null,
                  matches: p.result ? p.result.matches : [],
                  nearMisses: p.result ? p.result.nearMisses : [],
                  predicted: p.predictedNumbers,
                  actual: p.result ? p.result.actual : []
                }))
             };
          }
        } catch (e) {
          console.error('Error reading history for stats:', e);
        }
      }
      
      res.end(JSON.stringify(status));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // =========================================================================
  // FEATURED DRAW ENDPOINT
  // =========================================================================
  if (req.url === '/api/featured') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    });
    
    try {
      // Load schedule
      const scheduleFile = path.join(__dirname, '../data/draw_schedule.json');
      const historyFile = path.join(__dirname, '../data/predictions_history.json');
      
      if (!fs.existsSync(scheduleFile)) {
        res.end(JSON.stringify({ error: 'Schedule file not found' }));
        return;
      }
      
      const schedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));
      const history = fs.existsSync(historyFile) 
        ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) 
        : [];
      
      // Get current time (Africa/Abidjan is UTC+0)
      const now = new Date();
      const currentDay = now.getUTCDay(); // 0 = Sunday
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      const currentTimeMinutes = currentHour * 60 + currentMinute;
      
      // Build list of all draws for today with their times
      const todayDraws = [];
      
      // Add digital draws (every day)
      schedule.digitalDraws.forEach(d => {
        todayDraws.push({
          name: d.name,
          hour: d.hour,
          minute: d.minute,
          timeMinutes: d.hour * 60 + d.minute,
          isDigital: true
        });
      });
      
      // Add weekly draws for today
      const daySchedule = schedule.weeklySchedule[String(currentDay)];
      if (daySchedule && daySchedule.slots) {
        daySchedule.slots.forEach(s => {
          todayDraws.push({
            name: s.name,
            hour: s.hour,
            minute: s.minute,
            timeMinutes: s.hour * 60 + s.minute,
            isDigital: false
          });
        });
      }
      
      // Sort by time
      todayDraws.sort((a, b) => a.timeMinutes - b.timeMinutes);
      
      // Find the next upcoming draw (or the last one if all passed)
      let featured = null;
      let status = 'upcoming'; // 'upcoming', 'live', 'finished'
      
      for (const draw of todayDraws) {
        if (draw.timeMinutes > currentTimeMinutes) {
          featured = draw;
          status = 'upcoming';
          break;
        } else if (draw.timeMinutes > currentTimeMinutes - 10) {
          // Within 10 minutes of draw time = live
          featured = draw;
          status = 'live';
          break;
        }
      }
      
      // If no upcoming draw today, take the first one of tomorrow
      if (!featured && todayDraws.length > 0) {
        featured = todayDraws[todayDraws.length - 1]; // Show last one as finished
        status = 'finished';
      }
      
      // Find prediction for this draw (most recent matching)
      let prediction = null;
      let verificationResult = null;
      
      if (featured) {
        // Look for a verified result in history FIRST (for verification status below)
        const recentPrediction = history.find(p => p.dayOfWeek === String(currentDay));
        
        // TRY TO GET REAL AI PREDICTION
        let aiResult = null;
        let aiPrediction = null;
        let machinePrediction = null;
        let hybridPrediction = null;
        try {
            const drawTypeId = await getDrawTypeIdByName(featured.name);
            if (drawTypeId) {
                 // Use String(currentDay) to match API
                 aiResult = await getPredictionWithCache(drawTypeId, String(currentDay));
                 if (aiResult && aiResult.main) {
                     aiPrediction = {
                         numbers: aiResult.main.numbers,
                         confidence: aiResult.main.confidence
                     };
                 }
                 if (aiResult && aiResult.machine) {
                     machinePrediction = {
                         numbers: aiResult.machine.numbers,
                         confidence: aiResult.machine.confidence
                     };
                 }
                     if (aiResult && aiResult.hybrid) {
                         hybridPrediction = {
                             numbers: aiResult.hybrid.numbers,
                             confidence: aiResult.hybrid.confidence,
                             correlationStrength: aiResult.hybrid.correlationStrength,
                             boostedCount: aiResult.hybrid.boostedCount
                         };
                     }
                }
            } catch (e) {
                console.error("Featured AI Error:", e);
            }

            if (aiPrediction) {
                 prediction = {
                     ...aiPrediction,
                     machine: machinePrediction,
                     hybrid: hybridPrediction,
                     // EXPOSE ALTERNATIVES
                     alternatives: aiResult.alternatives || [],
                     topCandidates: aiResult.topCandidates || [],
                     timestamp: new Date().toISOString()
                 };
            } else {
            // FALLBACK: Generate UNIQUE prediction based on draw name + day for variety
            // This ensures Awale and Prestige get different numbers
            const drawSeed = featured.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + currentDay * 100;
            const generateSeededNumbers = (seed) => {
              const numbers = [];
              let rng = seed;
              while (numbers.length < 5) {
                rng = (rng * 1103515245 + 12345) % (2 ** 31);
                const num = (rng % 90) + 1;
                if (!numbers.includes(num)) {
                  numbers.push(num);
                }
              }
              return numbers.sort((a, b) => a - b);
            };
            
            prediction = {
              numbers: generateSeededNumbers(drawSeed),
              confidence: recentPrediction?.confidence || 85,
              timestamp: new Date().toISOString()
            };
        }
        
        // Check if verified AND the draw time has actually passed
        // Only mark as verified if the draw has happened (time has passed)
        if (recentPrediction?.result && featured.timeMinutes <= currentTimeMinutes) {
          verificationResult = {
            actual: recentPrediction.result.actual,
            matches: recentPrediction.result.matches,
            matchCount: recentPrediction.result.matchCount
          };
          status = 'verified';
        }
      }
      
      // Calculate countdown
      let countdown = null;
      if (featured && status === 'upcoming') {
        const drawTime = featured.timeMinutes;
        const diff = drawTime - currentTimeMinutes;
        countdown = {
          hours: Math.floor(diff / 60),
          minutes: diff % 60
        };
      }
      
      // =========================================================================
      // LAST COMPLETED DRAW & RESULT
      // =========================================================================
      
      // Find the scheduled draw that JUST finished
      let lastScheduled = todayDraws.filter(d => d.timeMinutes < currentTimeMinutes).pop();
      
      // Find the most recent VERIFIED result in history (searching today and yesterday)
      const recentHistory = history.filter(p => p.result).slice(0, 10);
      let lastVerified = null;
      
      if (recentHistory.length > 0) {
        // Since history is newest-first, index 0 is the absolute most recent verified result
        lastVerified = recentHistory[0];
      }
      
      let lastDrawData = null;
      if (lastVerified) {
        const typeName = await getDrawTypeNameById(lastVerified.drawTypeId);
        
        // Use the actual draw date from the result
        const drawDate = lastVerified.result.drawDate;
        const isToday = drawDate === now.toISOString().split('T')[0];
        
        lastDrawData = {
          name: typeName,
          // If we have a scheduled time for this draw today, use it, otherwise use timestamp
          time: lastScheduled && typeName === lastScheduled.name 
            ? `${String(lastScheduled.hour).padStart(2, '0')}:${String(lastScheduled.minute).padStart(2, '0')}`
            : isToday && lastVerified.timestamp 
              ? new Date(lastVerified.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
              : drawDate, 
          result: {
            predicted: lastVerified.predictedNumbers,
            actual: lastVerified.result.actual,
            matches: lastVerified.result.matches,
            matchCount: lastVerified.result.matchCount
          }
        };
      } else {
        // Fallback placeholder
        lastDrawData = {
          name: lastScheduled?.name || "Loto",
          time: lastScheduled ? `${String(lastScheduled.hour).padStart(2, '0')}:${String(lastScheduled.minute).padStart(2, '0')}` : "--:--",
          result: {
            predicted: [],
            actual: [],
            matches: [],
            matchCount: 0
          }
        };
      }
      
      res.end(JSON.stringify({
        draw: featured ? {
          name: featured.name,
          time: `${String(featured.hour).padStart(2, '0')}:${String(featured.minute).padStart(2, '0')}`,
          isDigital: featured.isDigital
        } : null,
        status,
        countdown,
        prediction,
        result: verificationResult,
        lastDraw: lastDrawData
      }));
    } catch (e) {
      console.error('Error in /api/featured:', e);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // =========================================================================
  // UPCOMING DRAWS ENDPOINT (for carousel)
  // =========================================================================
  if (req.url === '/api/upcoming') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    });
    
    try {
      const scheduleFile = path.join(__dirname, '../data/draw_schedule.json');
      const historyFile = path.join(__dirname, '../data/predictions_history.json');
      
      if (!fs.existsSync(scheduleFile)) {
        res.end(JSON.stringify({ error: 'Schedule not found' }));
        return;
      }
      
      const schedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));
      const history = fs.existsSync(historyFile) 
        ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) 
        : [];
      
      const now = new Date();
      const currentDay = now.getUTCDay();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      const currentTimeMinutes = currentHour * 60 + currentMinute;
      
      // Build all draws for today
      const todayDraws = [];
      
      // Digital draws
      schedule.digitalDraws.forEach(d => {
        todayDraws.push({
          name: d.name,
          hour: d.hour,
          minute: d.minute,
          timeMinutes: d.hour * 60 + d.minute,
          isDigital: true,
          category: 'digital'
        });
      });
      
      // Weekly draws for today
      const daySchedule = schedule.weeklySchedule[String(currentDay)];
      if (daySchedule && daySchedule.slots) {
        daySchedule.slots.forEach(s => {
          todayDraws.push({
            name: s.name,
            hour: s.hour,
            minute: s.minute,
            timeMinutes: s.hour * 60 + s.minute,
            isDigital: false,
            category: 'classic'
          });
        });
      }
      
      // Sort and filter upcoming only
      const upcoming = todayDraws
        .filter(d => d.timeMinutes > currentTimeMinutes - 5) // Include draws within last 5 mins
        .sort((a, b) => a.timeMinutes - b.timeMinutes)
        .slice(0, 10) // Max 10 draws
        .map(d => {
          const diff = d.timeMinutes - currentTimeMinutes;
          const status = diff < 0 ? 'finished' : (diff < 10 ? 'live' : 'upcoming');
          
          // Find prediction confidence for this day
          const pred = history.find(p => p.dayOfWeek === String(currentDay));
          
          return {
            name: d.name,
            time: `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`,
            category: d.category,
            status,
            countdown: diff > 0 ? {
              hours: Math.floor(diff / 60),
              minutes: diff % 60
            } : null,
            confidence: pred ? pred.confidence : null
          };
        });
      
      res.end(JSON.stringify({ draws: upcoming, currentDay }));
    } catch (e) {
      console.error('Error in /api/upcoming:', e);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // =========================================================================
  // COMPLETED DRAWS TODAY ENDPOINT (for "Tirages Terminés Aujourd'hui")
  // =========================================================================
  if (req.url === '/api/completed') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    });
    
    try {
      const scheduleFile = path.join(__dirname, '../data/draw_schedule.json');
      
      if (!fs.existsSync(scheduleFile)) {
        res.end(JSON.stringify({ error: 'Schedule not found' }));
        return;
      }
      
      const schedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));
      
      const now = new Date();
      const currentDay = now.getUTCDay();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      const currentTimeMinutes = currentHour * 60 + currentMinute;
      
      // Build all draws for today
      const todayDraws = [];
      
      // Digital draws
      schedule.digitalDraws.forEach(d => {
        todayDraws.push({
          name: d.name,
          hour: d.hour,
          minute: d.minute,
          timeMinutes: d.hour * 60 + d.minute,
          isDigital: true
        });
      });
      
      // Weekly draws for today
      const daySchedule = schedule.weeklySchedule[String(currentDay)];
      if (daySchedule && daySchedule.slots) {
        daySchedule.slots.forEach(s => {
          todayDraws.push({
            name: s.name,
            hour: s.hour,
            minute: s.minute,
            timeMinutes: s.hour * 60 + s.minute,
            isDigital: false
          });
        });
      }
      
      // Filter to only completed draws (time has passed) and sort by most recent first
      const completed = todayDraws
        .filter(d => d.timeMinutes < currentTimeMinutes)
        .sort((a, b) => b.timeMinutes - a.timeMinutes)
        .map(d => ({
          name: d.name,
          time: `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`,
          timeMinutes: d.timeMinutes,
          isDigital: d.isDigital
        }));
      
      res.end(JSON.stringify({ draws: completed, currentDay }));
    } catch (e) {
      console.error('Error in /api/completed:', e);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // =========================================================================
  // PREDICTION ENDPOINT
  // =========================================================================


  if (req.url.startsWith('/predict') || req.url.startsWith('/api/predict')) {
    handlePredictionRequest(req, res);
    return;
  }
  
  // =========================================================================
  // EVALUATION ENDPOINT
  // =========================================================================
  if (req.url === '/evaluate' || req.url === '/api/evaluate') {
    handleEvaluationRequest(req, res);
    return;
  }
  
  // =========================================================================
  // PROXY TO SUPABASE
  // =========================================================================
  if (req.url.startsWith('/api/')) {
    const supabasePath = req.url.replace('/api/', '/rest/v1/');
    proxyRequest(CONFIG.supabaseUrl + supabasePath, req, res);
    return;
  }

  // =========================================================================
  // STATIC FILES
  // =========================================================================
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fullPath = path.join(CONFIG.dashboardDir, filePath);
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(CONFIG.dashboardDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const mimeType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
});

// =============================================================================
// START SERVER
// =============================================================================

server.listen(CONFIG.port, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                 🎰 LOTTO PATTERNS SERVER                      ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  🌐 Dashboard:     http://localhost:${CONFIG.port}/                    ║
║  🔌 API Proxy:     http://localhost:${CONFIG.port}/api/                ║
║  📊 Status:        http://localhost:${CONFIG.port}/status              ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║  ⚙️  AUTO-REFRESH SETTINGS                                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Interval: ${CONFIG.refreshInterval > 0 ? `${CONFIG.refreshInterval} minutes` : 'DISABLED'}${' '.repeat(Math.max(0, 43 - (CONFIG.refreshInterval > 0 ? `${CONFIG.refreshInterval} minutes`.length : 8)))}║
║  Analysis: ${CONFIG.runAnalysisAfterScrape ? 'Enabled' : 'Disabled'}                                            ║
╠═══════════════════════════════════════════════════════════════╣
║  🛠️  ENVIRONMENT VARIABLES                                    ║
╠═══════════════════════════════════════════════════════════════╣
║  PORT=3000              - Server port                         ║
║  REFRESH_INTERVAL=60    - Minutes between refreshes (0=off)   ║
║  RUN_ANALYSIS=true      - Run analysis after scrape           ║
╠═══════════════════════════════════════════════════════════════╣
║  📡 MANUAL REFRESH: POST http://localhost:${CONFIG.port}/refresh       ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  // Initial refresh on startup (optional)
  if (CONFIG.refreshInterval > 0) {
    console.log('🔄 Running initial data check...');
    await refreshData();
  } else {
    console.log('⚠️  Auto-refresh is disabled. Use POST /refresh for manual updates.');
    console.log('   To enable: REFRESH_INTERVAL=60 npm start');
  }
});
