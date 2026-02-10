/**
 * LSTM Neural Network Predictor
 * 
 * Uses Long Short-Term Memory (LSTM) neural networks to learn patterns
 * from historical lottery data and generate predictions.
 * 
 * Architecture:
 * - Input: Sequence of past N draws (each draw = 5 numbers + metadata)
 * - LSTM layers: Learn temporal patterns in the sequence
 * - Output: Probability distribution over all 90 numbers
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Model save directory
const MODEL_DIR = path.join(__dirname, '../models');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Sequence length: how many past draws to consider
  sequenceLength: 20,
  
  // Model architecture
  lstmUnits: 64,
  denseUnits: 128,
  dropout: 0.2,
  
  // Training settings
  epochs: 50,
  batchSize: 32,
  validationSplit: 0.2,
  learningRate: 0.001,
  
  // Number pool
  maxNumber: 90,
  numbersPerDraw: 5
};

// =============================================================================
// DATA PREPARATION
// =============================================================================

/**
 * Convert draws to feature vectors
 * Each draw becomes a vector of:
 * - 5 normalized numbers (0-1 range)
 * - Day of week (one-hot encoded, 7 values)
 * - Sum normalized
 * - Odd/Even ratio
 */
function drawToFeatures(draw) {
  const numbers = [
    draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
    draw.winning_number_4, draw.winning_number_5
  ].filter(n => n);
  
  // Normalize numbers to 0-1 range
  const normalizedNumbers = numbers.map(n => n / CONFIG.maxNumber);
  
  // Pad to 5 numbers if needed
  while (normalizedNumbers.length < 5) {
    normalizedNumbers.push(0);
  }
  
  // Day of week (0-6) normalized
  const dayOfWeek = (draw.day_of_week || 0) / 6;
  
  // Sum normalized (theoretical max is 430: 86+87+88+89+90)
  const sum = numbers.reduce((a, b) => a + b, 0);
  const normalizedSum = sum / 430;
  
  // Odd/Even ratio
  const oddCount = numbers.filter(n => n % 2 === 1).length;
  const oddRatio = oddCount / 5;
  
  return [...normalizedNumbers, dayOfWeek, normalizedSum, oddRatio];
}

/**
 * Create multi-hot encoding for target (which numbers appeared)
 */
function drawToTarget(draw) {
  const target = new Array(CONFIG.maxNumber).fill(0);
  
  [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
   draw.winning_number_4, draw.winning_number_5].forEach(n => {
    if (n && n >= 1 && n <= CONFIG.maxNumber) {
      target[n - 1] = 1;
    }
  });
  
  return target;
}

/**
 * Prepare training sequences
 * Input: sequence of N draws
 * Output: which numbers appeared in draw N+1
 */
function prepareSequences(draws) {
  const sequences = [];
  const targets = [];
  
  for (let i = CONFIG.sequenceLength; i < draws.length; i++) {
    // Get sequence of past draws
    const sequence = [];
    for (let j = i - CONFIG.sequenceLength; j < i; j++) {
      sequence.push(drawToFeatures(draws[j]));
    }
    
    // Target is the next draw
    const target = drawToTarget(draws[i]);
    
    sequences.push(sequence);
    targets.push(target);
  }
  
  return { sequences, targets };
}

// =============================================================================
// LSTM MODEL (TensorFlow.js)
// =============================================================================

let tf = null;

async function loadTensorFlow() {
  if (tf) return tf;
  
  try {
    // Use pure JS TensorFlow first (more compatible)
    tf = await import('@tensorflow/tfjs');
    console.log('   Using TensorFlow.js (pure JS)');
  } catch (e) {
    try {
      // Try native TensorFlow as fallback
      tf = await import('@tensorflow/tfjs-node');
      console.log('   Using TensorFlow.js Node (native)');
    } catch (e2) {
      console.error('TensorFlow.js not available. Install with: npm install @tensorflow/tfjs');
      return null;
    }
  }
  
  return tf;
}

/**
 * Build simplified neural network model
 * Using GRU instead of LSTM (faster, similar performance)
 */
async function buildModel() {
  const tensorflow = await loadTensorFlow();
  if (!tensorflow) return null;
  
  const model = tensorflow.sequential();
  
  // Features: 5 numbers + day + sum + oddRatio = 8
  const featuresPerDraw = 8;
  
  // Flatten the input sequence for simpler processing
  model.add(tensorflow.layers.flatten({
    inputShape: [CONFIG.sequenceLength, featuresPerDraw]
  }));
  
  // Dense hidden layers
  model.add(tensorflow.layers.dense({
    units: 256,
    activation: 'relu'
  }));
  model.add(tensorflow.layers.dropout({ rate: 0.3 }));
  
  model.add(tensorflow.layers.dense({
    units: 128,
    activation: 'relu'
  }));
  model.add(tensorflow.layers.dropout({ rate: 0.2 }));
  
  model.add(tensorflow.layers.dense({
    units: 64,
    activation: 'relu'
  }));
  
  // Output layer: probability for each of 90 numbers
  model.add(tensorflow.layers.dense({
    units: CONFIG.maxNumber,
    activation: 'sigmoid'
  }));
  
  // Compile model
  model.compile({
    optimizer: tensorflow.train.adam(CONFIG.learningRate),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });
  
  return model;
}

/**
 * Train the LSTM model
 */
async function trainModel(drawTypeId = null) {
  console.log('🧠 LSTM Neural Network Training');
  console.log('═'.repeat(50));
  console.log('');
  
  const tensorflow = await loadTensorFlow();
  if (!tensorflow) {
    console.error('TensorFlow not available');
    return null;
  }
  
  // Fetch draws
  console.log('📊 Loading training data...');
  let query = supabase
    .from('draws')
    .select('*')
    .order('draw_date', { ascending: true });
  
  if (drawTypeId) {
    query = query.eq('draw_type_id', drawTypeId);
  }
  
  const { data: draws, error } = await query;
  
  if (error || !draws || draws.length < CONFIG.sequenceLength + 10) {
    console.error('Not enough data for training');
    return null;
  }
  
  console.log(`   Loaded ${draws.length} draws`);
  
  // Prepare sequences
  console.log('🔄 Preparing sequences...');
  const { sequences, targets } = prepareSequences(draws);
  console.log(`   Created ${sequences.length} training sequences`);
  
  // Convert to tensors
  const xsTensor = tensorflow.tensor3d(sequences);
  const ysTensor = tensorflow.tensor2d(targets);
  
  console.log(`   Input shape: [${xsTensor.shape}]`);
  console.log(`   Output shape: [${ysTensor.shape}]`);
  
  // Build model
  console.log('');
  console.log('🏗️ Building LSTM model...');
  const model = await buildModel();
  
  if (!model) {
    xsTensor.dispose();
    ysTensor.dispose();
    return null;
  }
  
  model.summary();
  
  // Train
  console.log('');
  console.log('🎓 Training model...');
  console.log(`   Epochs: ${CONFIG.epochs}`);
  console.log(`   Batch size: ${CONFIG.batchSize}`);
  console.log('');
  
  const history = await model.fit(xsTensor, ysTensor, {
    epochs: CONFIG.epochs,
    batchSize: CONFIG.batchSize,
    validationSplit: CONFIG.validationSplit,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if ((epoch + 1) % 10 === 0 || epoch === 0) {
          console.log(`   Epoch ${epoch + 1}/${CONFIG.epochs} - Loss: ${logs.loss.toFixed(4)}, Acc: ${(logs.acc * 100).toFixed(1)}%`);
        }
      }
    }
  });
  
  // Save model weights and topology manually
  console.log('');
  console.log('💾 Saving model...');
  
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }
  
  const lstmModelDir = path.join(MODEL_DIR, 'lstm-model');
  if (!fs.existsSync(lstmModelDir)) {
    fs.mkdirSync(lstmModelDir, { recursive: true });
  }
  
  // Save model topology
  const modelTopology = model.toJSON();
  fs.writeFileSync(
    path.join(lstmModelDir, 'model.json'),
    JSON.stringify({
      modelTopology,
      format: 'layers-model',
      generatedBy: 'LottoPatterns',
      convertedBy: null
    }, null, 2)
  );
  
  // Save weights
  const weights = model.getWeights();
  const weightData = [];
  for (const w of weights) {
    const data = await w.data();
    weightData.push({
      name: w.name,
      shape: w.shape,
      dtype: w.dtype,
      data: Array.from(data)
    });
  }
  
  fs.writeFileSync(
    path.join(lstmModelDir, 'weights.json'),
    JSON.stringify(weightData)
  );
  
  console.log(`   Model saved to: ${lstmModelDir}`);
  
  // Cleanup
  xsTensor.dispose();
  ysTensor.dispose();
  
  // Save training config and stats
  const stats = {
    trainedAt: new Date().toISOString(),
    drawTypeId,
    totalDraws: draws.length,
    sequencesUsed: sequences.length,
    finalLoss: history.history.loss[history.history.loss.length - 1],
    finalAccuracy: history.history.acc[history.history.acc.length - 1],
    config: CONFIG
  };
  
  fs.writeFileSync(
    path.join(MODEL_DIR, 'training-stats.json'),
    JSON.stringify(stats, null, 2)
  );
  
  console.log('');
  console.log('✅ Training complete!');
  console.log(`   Final loss: ${stats.finalLoss.toFixed(4)}`);
  console.log(`   Final accuracy: ${(stats.finalAccuracy * 100).toFixed(1)}%`);
  
  return { model, history, stats };
}

/**
 * Load a saved model from JSON files
 */
async function loadModel() {
  const tensorflow = await loadTensorFlow();
  if (!tensorflow) return null;
  
  const modelJsonPath = path.join(MODEL_DIR, 'lstm-model', 'model.json');
  const weightsJsonPath = path.join(MODEL_DIR, 'lstm-model', 'weights.json');
  
  if (!fs.existsSync(modelJsonPath) || !fs.existsSync(weightsJsonPath)) {
    console.log('   No saved model found. Train first with: npm run train-lstm');
    return null;
  }
  
  try {
    // Rebuild the model architecture
    const model = await buildModel();
    
    // Load weights
    const weightData = JSON.parse(fs.readFileSync(weightsJsonPath, 'utf8'));
    const weightTensors = weightData.map(w => 
      tensorflow.tensor(w.data, w.shape, w.dtype)
    );
    
    model.setWeights(weightTensors);
    
    console.log('   Loaded neural network model');
    return model;
  } catch (e) {
    console.error('Error loading model:', e.message);
    return null;
  }
}

/**
 * Generate predictions using the trained LSTM model
 */
async function predictWithLSTM(draws, count = 5) {
  const tensorflow = await loadTensorFlow();
  if (!tensorflow) return null;
  
  // Load model
  const model = await loadModel();
  if (!model) return null;
  
  // Prepare input sequence (last N draws)
  const recentDraws = draws.slice(-CONFIG.sequenceLength);
  
  if (recentDraws.length < CONFIG.sequenceLength) {
    console.log(`   Need at least ${CONFIG.sequenceLength} draws for prediction`);
    return null;
  }
  
  // Convert to features
  const sequence = recentDraws.map(d => drawToFeatures(d));
  
  // Create tensor [1, sequenceLength, features]
  const inputTensor = tensorflow.tensor3d([sequence]);
  
  // Predict
  const prediction = model.predict(inputTensor);
  const probabilities = await prediction.data();
  
  // Cleanup
  inputTensor.dispose();
  prediction.dispose();
  
  // Get top N numbers by probability
  const numberProbs = Array.from(probabilities).map((prob, idx) => ({
    number: idx + 1,
    probability: prob
  }));
  
  numberProbs.sort((a, b) => b.probability - a.probability);
  
  // Select top numbers
  const selected = numberProbs.slice(0, count).map(n => n.number);
  selected.sort((a, b) => a - b);
  
  // Calculate confidence as average probability
  const avgProb = numberProbs
    .slice(0, count)
    .reduce((sum, n) => sum + n.probability, 0) / count;
  
  return {
    numbers: selected,
    confidence: parseFloat((avgProb * 100).toFixed(1)),
    topProbabilities: numberProbs.slice(0, 15).map(n => ({
      number: n.number,
      probability: parseFloat((n.probability * 100).toFixed(2))
    })),
    strategy: 'lstm'
  };
}

// =============================================================================
// CLI COMMANDS
// =============================================================================

async function main() {
  const command = process.argv[2] || 'predict';
  
  switch (command) {
    case 'train':
      await trainModel();
      break;
      
    case 'predict':
      console.log('🧠 LSTM Prediction');
      console.log('═'.repeat(50));
      
      // Get recent draws
      const { data: draws } = await supabase
        .from('draws')
        .select('*')
        .order('draw_date', { ascending: true });
      
      if (draws && draws.length >= CONFIG.sequenceLength) {
        const prediction = await predictWithLSTM(draws, 5);
        
        if (prediction) {
          console.log('');
          console.log('🔮 LSTM Prediction:');
          console.log(`   Numbers: ${prediction.numbers.join(' - ')}`);
          console.log(`   Confidence: ${prediction.confidence}%`);
          console.log('');
          console.log('📊 Top 10 Probabilities:');
          prediction.topProbabilities.slice(0, 10).forEach(n => {
            console.log(`   ${n.number.toString().padStart(2)}: ${n.probability}%`);
          });
        }
      } else {
        console.log('Not enough data for prediction');
      }
      break;
      
    default:
      console.log('Usage: node lstm-predictor.js [train|predict]');
  }
}

// Run if executed directly
if (process.argv[1].includes('lstm-predictor')) {
  main().catch(console.error);
}

// Exports
export { CONFIG, loadModel, predictWithLSTM, trainModel };
export default { trainModel, loadModel, predictWithLSTM, CONFIG };
