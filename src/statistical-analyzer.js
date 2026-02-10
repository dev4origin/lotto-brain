/**
 * Statistical Analysis Engine
 * 
 * Focuses on:
 * 1. Co-occurrence Lift: (P(A and B) / (P(A) * P(B))). 
 *    Identifies pairs that appear together more than random chance.
 * 2. Conditional Probability (Followers): P(B in T+1 | A in T).
 *    Identifies numbers that often follow specific numbers in the next draw.
 */

/**
 * Calculate Co-occurrence Lift for all pairs
 * @param {number[][]} draws - Array of draws, each an array of numbers
 */
export function calculateLift(draws) {
  const totalDraws = draws.length;
  if (totalDraws < 10) return {};

  const freq = {};
  const pairFreq = {};

  draws.forEach(numbers => {
    const sorted = [...numbers].sort((a, b) => a - b);
    
    // Individual frequency
    sorted.forEach(n => {
      freq[n] = (freq[n] || 0) + 1;
    });

    // Pair frequency
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        pairFreq[key] = (pairFreq[key] || 0) + 1;
      }
    }
  });

  const lifts = {};
  Object.entries(pairFreq).forEach(([pair, count]) => {
    const [a, b] = pair.split('-').map(Number);
    
    // P(A) = freq[A] / totalDraws
    // P(B) = freq[B] / totalDraws
    // P(A and B) = count / totalDraws
    // Lift = P(A and B) / (P(A) * P(B))
    // Simplifies to: (count * totalDraws) / (freq[A] * freq[B])
    
    const lift = (count * totalDraws) / (freq[a] * freq[b]);
    
    // We only care about high-confidence lifts (min 3 occurrences to avoid noise)
    if (count >= 3 && lift > 1.2) {
      lifts[pair] = {
        lift: parseFloat(lift.toFixed(3)),
        count,
        a, b
      };
    }
  });

  return lifts;
}

/**
 * Calculate Conditional Probability (Followers)
 * @param {number[][]} draws - Array of draws (oldest to newest)
 */
export function calculateFollowers(draws) {
  const totalPairs = draws.length - 1;
  if (totalPairs < 10) return {};

  const followerCounts = {}; // { anchor: { follower: count } }
  const anchorFreq = {};

  for (let i = 0; i < draws.length - 1; i++) {
    const current = draws[i];
    const next = draws[i + 1];

    current.forEach(anchor => {
      anchorFreq[anchor] = (anchorFreq[anchor] || 0) + 1;
      
      if (!followerCounts[anchor]) followerCounts[anchor] = {};
      
      next.forEach(follower => {
        followerCounts[anchor][follower] = (followerCounts[anchor][follower] || 0) + 1;
      });
    });
  }

  const conditionalProbs = {};
  Object.entries(followerCounts).forEach(([anchor, followers]) => {
    const freqA = anchorFreq[anchor];
    const topFollowers = Object.entries(followers)
      .map(([num, count]) => ({
        number: parseInt(num),
        probability: parseFloat((count / freqA).toFixed(3)),
        count
      }))
      .filter(f => f.count >= 3 && f.probability > 0.1) // Minimum thresholds
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 10);

    if (topFollowers.length > 0) {
      conditionalProbs[anchor] = topFollowers;
    }
  });

  return conditionalProbs;
}

export default { calculateLift, calculateFollowers };
