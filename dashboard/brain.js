// Brain Dashboard Logic

let drawTypes = [];
let recentHistory = []; // Global store for filtering
let currentBet = 200; // Default bet amount

document.addEventListener('DOMContentLoaded', () => {
    loadBrainData();
    loadFeaturedDraw();
    loadUpcomingDraws();
    loadCompletedDraws(); // New: Load completed draws for today
    initGainsSimulator();
    initHistoryFilters();
    
    // Auto refresh every 30s
    setInterval(loadBrainData, 30000);
    setInterval(loadFeaturedDraw, 15000); // Featured updates faster
    setInterval(loadUpcomingDraws, 30000);
    setInterval(loadCompletedDraws, 60000); // Completed draws refresh every minute
});

// =============================================================================
// GAINS SIMULATOR
// =============================================================================

function initGainsSimulator() {
    const buttons = document.querySelectorAll('.bet-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update gains
            currentBet = parseInt(btn.dataset.amount);
            updateGainsDisplay(currentBet);
        });
    });
    
    // Initial calculation
    updateGainsDisplay(currentBet);
}

function updateGainsDisplay(bet) {
    // Official Loto Bonheur multipliers (approximate)
    const multipliers = {
        5: 5000,  // 5/5 = bet × 5000
        4: 500,   // 4/5 = bet × 500
        3: 50,    // 3/5 = bet × 50
        2: 5      // 2/5 = bet × 5
    };
    
    const formatFcfa = (amount) => {
        return amount.toLocaleString('fr-FR') + ' Fcfa';
    };
    
    document.getElementById('gain5').textContent = formatFcfa(bet * multipliers[5]);
    document.getElementById('gain4').textContent = formatFcfa(bet * multipliers[4]);
    document.getElementById('gain3').textContent = formatFcfa(bet * multipliers[3]);
    document.getElementById('gain2').textContent = formatFcfa(bet * multipliers[2]);
}

// =============================================================================
// UPCOMING DRAWS CAROUSEL
// =============================================================================

async function loadUpcomingDraws() {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    
    try {
        const res = await fetch('/api/upcoming');
        const data = await res.json();
        
        if (data.error || !data.draws || data.draws.length === 0) {
            track.innerHTML = '<div class="draw-card"><div class="draw-card-name">Aucun tirage</div></div>';
            return;
        }
        
        track.innerHTML = data.draws.map(draw => {
            const isLive = draw.status === 'live';
            const countdownStr = draw.countdown 
                ? `${String(draw.countdown.hours).padStart(2, '0')}h ${String(draw.countdown.minutes).padStart(2, '0')}m`
                : (draw.status === 'finished' ? 'Terminé' : 'Bientôt');
            
            return `
                <div class="draw-card ${isLive ? 'live' : ''}">
                    <div class="draw-card-name">${draw.name}</div>
                    <div class="draw-card-time">${draw.time}</div>
                    <div class="draw-card-countdown">${isLive ? '🔴 EN COURS' : '⏱ ' + countdownStr}</div>
                    ${draw.confidence ? `
                        <div class="draw-card-confidence">
                            🧠 <span class="confidence-value">${draw.confidence}%</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
    } catch (e) {
        console.error('Error loading upcoming draws:', e);
        track.innerHTML = '<div class="draw-card"><div class="draw-card-name">Erreur</div></div>';
    }
}

// =============================================================================
// COMPLETED DRAWS TODAY (Schedule-based)
// =============================================================================

async function loadCompletedDraws() {
    const container = document.getElementById('completedDrawsContainer');
    if (!container) return;
    
    try {
        const res = await fetch('/api/completed');
        const data = await res.json();
        
        if (data.error || !data.draws || data.draws.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 20px;">Aucun tirage terminé pour aujourd\'hui.</div>';
            return;
        }
        
        // Sort by time descending (most recent first)
        const sortedDraws = data.draws.sort((a, b) => b.timeMinutes - a.timeMinutes);
        
        container.innerHTML = sortedDraws.map(draw => {
            const statusIcon = draw.isDigital ? '🎲' : '🎯';
            const categoryBadge = draw.isDigital 
                ? '<span style="background: rgba(79, 172, 254, 0.2); color: #4facfe; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; margin-left: 8px;">Digital</span>'
                : '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; margin-left: 8px;">Classique</span>';
            
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.2em;">${statusIcon}</span>
                        <div>
                            <div style="font-weight: 500; color: #e2e8f0;">${draw.name}${categoryBadge}</div>
                            <div style="font-size: 0.85em; color: #64748b;">Terminé à ${draw.time}</div>
                        </div>
                    </div>
                    <span class="badge badge-neutral" style="font-size: 0.8em;">✅ Terminé</span>
                </div>
            `;
        }).join('');
        
    } catch (e) {
        console.error('Error loading completed draws:', e);
        container.innerHTML = '<div style="text-align: center; color: #f87171; padding: 20px;">Erreur de chargement.</div>';
    }
}

// =============================================================================
// FEATURED DRAW - NEXT + LAST RESULT
// =============================================================================

async function loadFeaturedDraw() {
    try {
        const res = await fetch('/api/featured');
        const data = await res.json();
        
        if (data.error) {
            console.error('Featured error:', data.error);
            return;
        }
        
        // =====================================================================
        // NEXT DRAW CARD
        // =====================================================================
        const nextCard = document.getElementById('nextDrawCard');
        const nextStatus = document.getElementById('nextDrawStatus');
        const nextName = document.getElementById('nextDrawName');
        const nextTime = document.getElementById('nextDrawTime');
        const nextCountdown = document.getElementById('nextCountdownValue');
        const nextGagnants = document.getElementById('nextGagnantsNumbers');
        const nextMachine = document.getElementById('nextMachineNumbers');
        const nextHybrid = document.getElementById('nextHybridNumbers');
        const hybridConfidence = document.getElementById('hybridConfidence');
        const hybridInfo = document.getElementById('hybridInfo');
        
        if (data.draw && data.status === 'upcoming') {
            nextCard.style.display = 'block';
            nextStatus.textContent = '⏳ En attente';
            nextStatus.className = 'badge badge-neutral';
            nextName.textContent = data.draw.name;
            nextTime.textContent = `Tirage à ${data.draw.time}`;
            
            // Countdown
            if (data.countdown) {
                const h = String(data.countdown.hours).padStart(2, '0');
                const m = String(data.countdown.minutes).padStart(2, '0');
                nextCountdown.textContent = `${h}h ${m}m`;
            }
            
            // Render Gagnants prediction (blue)
            nextGagnants.innerHTML = '';
            if (data.prediction && data.prediction.numbers) {
                data.prediction.numbers.forEach(num => {
                    nextGagnants.appendChild(createBall(num, 'blue'));
                });
            } else {
                nextGagnants.innerHTML = '<span style="color: #64748b;">En calcul...</span>';
            }
            
            // Render Machine prediction (green) - USE REAL DATA FROM API
            nextMachine.innerHTML = '';
            if (data.prediction && data.prediction.machine && data.prediction.machine.numbers) {
                data.prediction.machine.numbers.forEach(num => {
                    nextMachine.appendChild(createBall(num, 'green'));
                });
            } else {
                nextMachine.innerHTML = '<span style="color: #64748b;">En calcul...</span>';
            }
            
            // Render Hybrid prediction (purple) - USE REAL DATA FROM API
            nextHybrid.innerHTML = '';
            if (data.prediction && data.prediction.hybrid && data.prediction.hybrid.numbers) {
                data.prediction.hybrid.numbers.forEach(num => {
                    nextHybrid.appendChild(createBall(num, 'purple'));
                });
                // Update confidence and info
                if (hybridConfidence) {
                    hybridConfidence.textContent = `${data.prediction.hybrid.confidence}% confiance`;
                }
                if (hybridInfo) {
                    const boosted = data.prediction.hybrid.boostedCount || 0;
                    const strength = data.prediction.hybrid.correlationStrength 
                        ? Math.round(data.prediction.hybrid.correlationStrength * 100) + '%'
                        : '--';
                    hybridInfo.textContent = `${boosted} numéros boostés • Force corrélation: ${strength}`;
                }
            } else {
                nextHybrid.innerHTML = '<span style="color: #64748b;">En calcul...</span>';
            }

            // Render Alternatives
            const altContainer = document.getElementById('alternativesContainer');
            const altGrid = document.getElementById('nextAlternatives');
            
            if (altContainer && altGrid) {
                if (data.prediction && data.prediction.alternatives && data.prediction.alternatives.length > 0) {
                    altContainer.style.display = 'block';
                    altGrid.innerHTML = '';
                    
                    data.prediction.alternatives.forEach(alt => {
                        const div = document.createElement('div');
                        div.style.cssText = 'background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px;';
                        
                        const nums = alt.numbers.join(', ');
                        
                        div.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75em; color: #94a3b8; margin-bottom: 4px;">
                                <span>${alt.icon}</span>
                                <span>${alt.name}</span>
                            </div>
                            <div style="font-size: 0.85em; font-weight: 600; color: #e2e8f0; letter-spacing: 0.5px;">
                                ${nums}
                            </div>
                        `;
                        altGrid.appendChild(div);
                    });
                } else {
                    altContainer.style.display = 'none';
                }
            }
        } else if (data.status === 'live') {
            nextStatus.textContent = '🔴 EN COURS';
            nextStatus.className = 'badge badge-success';
        } else {
            // No upcoming draw, show placeholder
            nextName.textContent = 'Aucun tirage imminent';
            nextTime.textContent = 'Vérifiez le carousel ci-dessous';
            nextGagnants.innerHTML = '<span style="color: #64748b;">--</span>';
            nextMachine.innerHTML = '<span style="color: #64748b;">--</span>';
            if (nextHybrid) nextHybrid.innerHTML = '<span style="color: #64748b;">--</span>';
        }
        
        // =====================================================================
        // LAST RESULT CARD - Use lastDraw from featured API
        // =====================================================================
        const lastCard = document.getElementById('lastResultCard');
        const lastScore = document.getElementById('lastResultScore');
        const lastName = document.getElementById('lastResultName');
        const lastTime = document.getElementById('lastResultTime');
        const lastRealGagnants = document.getElementById('lastRealGagnants');
        const lastPredGagnants = document.getElementById('lastPredGagnants');
        const lastRealMachine = document.getElementById('lastRealMachine');
        const lastPredMachine = document.getElementById('lastPredMachine');
        
        if (data.lastDraw) {
            lastCard.style.display = 'block';
            lastName.textContent = data.lastDraw.name;
            lastTime.textContent = `Terminé à ${data.lastDraw.time}`;
            
            if (data.lastDraw.result) {
                const matchCount = data.lastDraw.result.matchCount || 0;
                lastScore.textContent = `${matchCount}/5 Hits`;
                lastScore.className = matchCount >= 2 ? 'badge badge-success' : 'badge badge-neutral';
                
                const actualNums = data.lastDraw.result.actual || [];
                const predictedNums = data.lastDraw.result.predicted || [];
                const matches = data.lastDraw.result.matches || [];
                
                // Gagnants - Real (first 5 of actual)
                lastRealGagnants.innerHTML = '';
                actualNums.slice(0, 5).forEach(num => {
                    const isHit = matches.includes(num);
                    lastRealGagnants.appendChild(createBall(num, isHit ? 'gold' : 'gray', 36));
                });
                
                // Gagnants - Predicted
                lastPredGagnants.innerHTML = '';
                predictedNums.slice(0, 5).forEach(num => {
                    const isHit = matches.includes(num);
                    lastPredGagnants.appendChild(createBall(num, isHit ? 'gold' : 'blue', 36));
                });
                
                // Machine - Real (if available)
                lastRealMachine.innerHTML = '';
                const realMachine = actualNums.slice(5, 10);
                if (realMachine.length > 0) {
                    realMachine.forEach(num => {
                        lastRealMachine.appendChild(createBall(num, 'gray', 36));
                    });
                } else {
                    lastRealMachine.innerHTML = '<span style="color: #64748b; font-size: 0.85em;">N/A</span>';
                }
                
                // Machine - Predicted
                lastPredMachine.innerHTML = '';
                const predMachine = generateMachineNumbers(predictedNums);
                predMachine.forEach(num => {
                    // Check if this machine number appears in the ACTUAL Gagnants result
                    const isCrossMatch = actualNums.slice(0, 5).includes(num);
                    
                    // If cross-match, use special styling (purple/pink glow)
                    if (isCrossMatch) {
                        const ball = createBall(num, 'green', 36);
                        ball.style.border = '2px solid #d946ef'; // Fuchsia border
                        ball.style.boxShadow = '0 0 10px rgba(217, 70, 239, 0.5)';
                        lastPredMachine.appendChild(ball);
                    } else {
                        lastPredMachine.appendChild(createBall(num, 'green', 36));
                    }
                });
            } else {
                // No verified result yet for last draw
                lastScore.textContent = 'En attente';
                lastScore.className = 'badge badge-neutral';
                lastRealGagnants.innerHTML = '<span style="color: #64748b;">Résultat en attente...</span>';
                lastPredGagnants.innerHTML = '<span style="color: #64748b;">--</span>';
                lastRealMachine.innerHTML = '<span style="color: #64748b;">--</span>';
                lastPredMachine.innerHTML = '<span style="color: #64748b;">--</span>';
            }
        } else {
            lastCard.style.display = 'none';
        }
        
    } catch (e) {
        console.error('Error loading featured draw:', e);
    }
}

// Helper: Create a styled ball
function createBall(num, color, size = 45) {
    const ball = document.createElement('span');
    const bgMap = {
        'blue': 'linear-gradient(135deg, #4facfe, #00f2fe)',
        'green': 'linear-gradient(135deg, #10b981, #34d399)',
        'purple': 'linear-gradient(135deg, #a855f7, #ec4899)',
        'gold': 'linear-gradient(135deg, #fbbf24, #f59e0b)',
        'gray': 'rgba(255,255,255,0.1)'
    };
    const colorMap = {
        'blue': '#fff',
        'green': '#fff',
        'purple': '#fff',
        'gold': '#000',
        'gray': '#e2e8f0'
    };
    ball.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        font-weight: bold;
        font-size: ${size > 40 ? '1.1em' : '0.9em'};
        background: ${bgMap[color] || bgMap.gray};
        color: ${colorMap[color] || colorMap.gray};
        ${color === 'gold' ? 'box-shadow: 0 0 10px rgba(251, 191, 36, 0.5);' : ''}
        ${color === 'gray' ? 'border: 1px solid rgba(255,255,255,0.2);' : ''}
    `;
    ball.textContent = num;
    return ball;
}

// Helper: Generate machine numbers from remaining pool
function generateMachineNumbers(gagnants) {
    const allNumbers = Array.from({length: 90}, (_, i) => i + 1);
    const available = allNumbers.filter(n => !gagnants.includes(n));
    const machineNums = [];
    for (let i = 0; i < 5 && i < available.length; i++) {
        machineNums.push(available[(i * 15 + 7) % available.length]);
    }
    return machineNums.sort((a, b) => a - b);
}

async function loadDrawTypes() {
    if (drawTypes.length > 0) return;
    try {
        const res = await fetch('/api/draw_types');
        if (res.ok) {
            const data = await res.json();
            drawTypes = data;
        }
    } catch (e) {
        console.error('Error loading draw types:', e);
    }
}

function populateTypeFilter() {
    const filter = document.getElementById('typeFilter');
    if (!filter || drawTypes.length === 0) return;
    
    // Clear except "All"
    filter.innerHTML = '<option value="all">Tous les jeux</option>';
    
    // Sort and add types
    const sortedTypes = [...drawTypes].sort((a, b) => a.name.localeCompare(b.name));
    sortedTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        filter.appendChild(opt);
    });
}

function initHistoryFilters() {
    const typeFilter = document.getElementById('typeFilter');
    const dayFilter = document.getElementById('dayFilter');
    
    if (typeFilter) {
        typeFilter.addEventListener('change', () => updateHistoryTable());
    }
    
    if (dayFilter) {
        dayFilter.addEventListener('change', () => updateHistoryTable());
    }
}

function getDrawTypeName(id) {
    const type = drawTypes.find(t => t.id == id);
    return type ? type.name : `Jeu #${id}`;
}

async function loadBrainData() {
    console.log('🧠 Loading Brain Data...');
    
    // Ensure types are loaded
    await loadDrawTypes();
    populateTypeFilter();
    
    try {
        const res = await fetch('/api/brain');
        const brain = await res.json();
        
        // 1. Update Header Info
        const now = new Date();
        document.getElementById('lastUpdate').textContent = `Dernière MAJ: ${now.toLocaleTimeString()}`;
        
        // 2. Real Stats (Sidebar)
        if (brain.realPerformance) {
            const acc = brain.realPerformance.globalAccuracy || 0;
            const hits = brain.realPerformance.totalHits || 0;
            
            document.getElementById('globalAccuracy').textContent = acc.toFixed(1) + '%';
            document.getElementById('totalHits').textContent = hits;
        }
        
        // 3. Strategy Weights
        updateStrategies(brain.weights);
        
        // 4. Training Top Stats (Sidebar)
        updateTrainingStats(brain.stats);
        
        // 4.5 Training Leaderboard (Main)
        updateLeaderboard(brain.stats);
        
        // 5. History Table
        if (brain.realPerformance && brain.realPerformance.recentHistory) {
            recentHistory = brain.realPerformance.recentHistory;
            updateHistoryTable();
            updateRecordBook();
        }
        
        // 6. Logs
        updateLogs(brain.history);
        
    } catch (e) {
        console.error('Error loading brain:', e);
    }
}

function updateStrategies(weights) {
    const container = document.getElementById('strategyContainer');
    if (!container || !weights) return;
    
    container.innerHTML = '';
    const sorted = Object.entries(weights).sort((a,b) => b[1] - a[1]);
    
    const labels = {
        hot: 'Chauds 🔥',
        due: 'Dus ⏰',
        correlation: 'Corrélations 🔗',
        position: 'Position 📍',
        balanced: 'Équilibre ⚖️',
        statistical: 'Statistique 📊',
        finales: 'Finales 🔢'
    };
    
    sorted.forEach(([key, val]) => {
        const pct = Math.round(val * 100);
        const isNew = key === 'statistical' || key === 'finales';
        const labelText = labels[key] || key;
        const div = document.createElement('div');
        div.className = 'strategy-item';
        div.innerHTML = `
            <div class="strategy-info">
                <span>${labelText}${isNew ? ' <span class="badge" style="background: rgba(251, 146, 60, 0.2); color: #fb923c; font-size: 0.7em; margin-left: 5px;">NOUVEAU</span>' : ''}</span>
                <span>${pct}%</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
        `;
        container.appendChild(div);
    });

    // Add Tactical Neighbor indicator
    const tacticalDiv = document.createElement('div');
    tacticalDiv.className = 'strategy-item';
    tacticalDiv.style.marginTop = '15px';
    tacticalDiv.style.paddingTop = '10px';
    tacticalDiv.style.borderTop = '1px dashed rgba(255,255,255,0.1)';
    tacticalDiv.innerHTML = `
        <div class="strategy-info" style="color: #fb923c;">
            <span>Tactical Neighbors (±1) 🤏</span>
            <span class="badge" style="background: rgba(251, 146, 60, 0.2); color: #fb923c; font-size: 0.7em;">ACTIF</span>
        </div>
        <div style="font-size: 0.75em; color: #94a3b8;">
            Redistribution tactique de 15% pour couvrir les zones de probabilité.
        </div>
    `;
    container.appendChild(tacticalDiv);
}

function updateTrainingStats(stats) {
    const container = document.getElementById('topTrainingList');
    if (!container || !stats || !stats.byType) return;
    
    container.innerHTML = '';
    
    // Sort by accuracy DESC, then Hits DESC
    const types = Object.entries(stats.byType)
        .sort((a,b) => {
            if (b[1].accuracy !== a[1].accuracy) return b[1].accuracy - a[1].accuracy;
            return b[1].totalHits - a[1].totalHits;
        })
        .slice(0, 5); // Top 5
        
    types.forEach(([id, s]) => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9em;';
        
        div.innerHTML = `
            <span style="color: #cbd5e0;">${getDrawTypeName(id)}</span>
            <div>
                <span style="color: #4facfe; font-weight: bold;">${s.accuracy.toFixed(1)}%</span>
                <span style="color: #64748b; font-size: 0.85em; margin-left: 5px;">(${s.totalHits} hits)</span>
            </div>
        `;
        container.appendChild(div);
    });
}

function updateLeaderboard(stats) {
    const tbody = document.getElementById('trainingLeaderboardBody');
    if (!tbody || !stats || !stats.byType) return;
    
    tbody.innerHTML = '';
    
    // Sort logic: Accuracy DESC -> Hits DESC -> Draws DESC
    const types = Object.entries(stats.byType)
        .sort((a,b) => {
            if (b[1].accuracy !== a[1].accuracy) return b[1].accuracy - a[1].accuracy;
            if (b[1].totalHits !== a[1].totalHits) return b[1].totalHits - a[1].totalHits;
            return b[1].totalDraws - a[1].totalDraws;
        });
        
    if (types.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #64748b;">Aucune donnée d\'entraînement par jeu.</td></tr>';
        return;
    }

    types.forEach(([id, s], index) => {
        const rank = index + 1;
        let rankBadge = `<span style="color: #64748b; font-weight: bold; margin-right: 10px;">#${rank}</span>`;
        if (rank === 1) rankBadge = '🥇 ';
        if (rank === 2) rankBadge = '🥈 ';
        if (rank === 3) rankBadge = '🥉 ';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500; color: #e2e8f0;">${rankBadge} ${getDrawTypeName(id)}</td>
            <td style="color: #4facfe; font-weight: bold;">${s.accuracy.toFixed(1)}%</td>
            <td style="color: #34d399;">${s.totalHits}</td>
            <td style="color: #94a3b8;">${s.totalDraws}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updateHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    
    if (!recentHistory || recentHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #64748b;">Aucune donnée vérifiée pour le moment.</td></tr>';
        return;
    }

    const typeFilter = document.getElementById('typeFilter')?.value || 'all';
    const dayFilter = document.getElementById('dayFilter')?.value || 'all';

    // Apply filters and HIDE pending results
    const filteredHistory = recentHistory.filter(h => {
        // 1. Must be verified (has matchCount)
        if (h.matchCount === null || h.matchCount === undefined) return false;
        
        // 2. Type Filter
        if (typeFilter !== 'all' && String(h.typeId) !== typeFilter) return false;
        
        // 3. Day Filter
        if (dayFilter !== 'all') {
            const hDate = new Date(h.date);
            if (String(hDate.getDay()) !== dayFilter) return false;
        }
        
        return true;
    });

    if (filteredHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #64748b;">Aucun résultat correspondant aux critères.</td></tr>';
        return;
    }

    // Deduplicate: Keep only one entry per (Draw Contents)
    // We'll keep the most recent one
    const uniqueHistory = [];
    const seen = new Set();
    
    // Sort by raw timestamp descending so we process the latest first
    const forDeduplication = [...filteredHistory].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    forDeduplication.forEach(item => {
        // Key based on type and the actual numbers (represents the draw) 
        // AND the predicted numbers (to distinguish different predictions if needed, 
        // but the user wants to keep only the latest if they are the same).
        const key = `${item.typeId}_${item.predicted.join(',')}_${item.actual.join(',')}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueHistory.push(item);
        }
    });

    tbody.innerHTML = '';
    
    // Sort by date descending (most recent first)
    const sortedHistory = [...uniqueHistory].sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
    });
    
    sortedHistory.forEach(h => {
        const date = new Date(h.date).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        
        let scoreClass = 'badge-neutral';
        let scoreText = '⏳ En attente';
        let actualText = 'En attente...';
        
        // If matchCount is a number (including 0), it's verified
        if (h.matchCount !== null && h.matchCount !== undefined) {
            const isHit = h.matchCount > 0;
            const nearMissCount = h.nearMisses ? h.nearMisses.length : 0;
            
            scoreClass = isHit ? 'badge-success' : (nearMissCount > 0 ? 'badge-warning' : 'badge-neutral');
            
            let badgeText = isHit ? `✅ ${h.matchCount}/5` : '0/5';
            if (nearMissCount > 0) badgeText += ` (+${nearMissCount} 🤏)`;
            
            scoreText = badgeText;
            actualText = h.actual.join(', ');
        }
        
        // Format predicted numbers
        const formatPredicted = (nums, matches, nearMisses) => {
            return nums.map(n => {
                if (matches && matches.includes(n)) {
                    return `<span style="color: #4ade80; font-weight: bold; text-shadow: 0 0 5px rgba(74, 222, 128, 0.4);">${n}</span>`;
                }
                if (nearMisses && nearMisses.includes(n)) {
                    return `<span style="color: #fb923c; font-weight: bold; border-bottom: 2px dotted #fb923c;" title="Voisin (±1)">${n}</span>`;
                }
                return n;
            }).join(', ');
        };
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: #94a3b8;">${date}</td>
            <td style="font-weight: 500;">${getDrawTypeName(h.typeId)}</td>
            <td style="font-family: monospace; color: #a5b4fc;">${formatPredicted(h.predicted, h.matches, h.nearMisses)}</td>
            <td style="font-family: monospace; color: #e2e8f0;">${actualText}</td>
            <td><span class="badge ${scoreClass}">${scoreText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// =============================================================================
// RECORD BOOK - Top 5 Best Records
// =============================================================================

function updateRecordBook() {
    const tbody = document.getElementById('recordBookBody');
    const countBadge = document.getElementById('recordCount');
    if (!tbody) return;
    
    if (!recentHistory || recentHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="record-empty">Aucun record enregistré pour le moment.</td></tr>';
        return;
    }
    
    // 1. Filter to verified entries only
    const verified = recentHistory.filter(h => 
        h.matchCount !== null && h.matchCount !== undefined
    );

    if (verified.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="record-empty">Aucun résultat vérifié pour le moment.</td></tr>';
        return;
    }

    // 2. Sort by matchCount DESC (primary), then Date DESC (secondary)
    // This ensures we process the BEST records first.
    const sortedCandidates = [...verified].sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return new Date(b.date) - new Date(a.date);
    });

    // 3. Deduplicate by Draw (Date + Type)
    // Since we sorted by score DESC, the first time we see a draw, it's the BEST score for that draw.
    const uniqueDraws = new Map();
    const finalRecords = [];

    for (const record of sortedCandidates) {
        // Create a unique key for the DRAW event only
        const drawKey = `${record.date}_${record.typeId}`;
        
        if (!uniqueDraws.has(drawKey)) {
            uniqueDraws.set(drawKey, true);
            finalRecords.push(record);
        }
    }
    
    // Take top 5
    const top5 = finalRecords.slice(0, 5);
    
    // Update count badge
    if (countBadge) {
        countBadge.textContent = `Top ${top5.length}`;
    }
    
    tbody.innerHTML = '';
    
    const rankIcons = ['🥇', '🥈', '🥉'];
    
    top5.forEach((record, index) => {
        const rank = index < 3 
            ? `<span class="record-rank">${rankIcons[index]}</span>` 
            : `<span class="record-rank" style="color: #64748b; font-size: 1em;">#${index + 1}</span>`;
        
        // Format date
        const date = new Date(record.date).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Format predicted numbers with hits highlighted
        const matches = record.matches || [];
        const predictedHTML = record.predicted.map(n => {
            if (matches.includes(n)) {
                return `<span class="hit">${n}</span>`;
            }
            return `${n}`;
        }).join(', ');
        
        // Format actual numbers
        const actualHTML = record.actual.map(n => {
            if (matches.includes(n)) {
                return `<span class="hit">${n}</span>`;
            }
            return `${n}`;
        }).join(', ');
        
        // Hits badge
        const hitsClass = `hits-${Math.min(record.matchCount, 5)}`;
        const hitsText = `${record.matchCount}/5`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rank}</td>
            <td style="color: #94a3b8; white-space: nowrap;">${date}</td>
            <td style="font-weight: 500;">${getDrawTypeName(record.typeId)}</td>
            <td class="record-nums">${predictedHTML}</td>
            <td class="record-nums">${actualHTML}</td>
            <td style="text-align: center;"><span class="record-hits ${hitsClass}">${hitsText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function updateLogs(history) {
    const container = document.getElementById('brainLogs');
    if (!container || !history) return;
    
    container.innerHTML = '';
    
    const logs = [...history].reverse().slice(0, 50); 
    
    logs.forEach(entry => {
        const date = new Date(entry.date).toLocaleTimeString();
        const div = document.createElement('div');
        div.className = 'log-entry';
        
        const scores = Object.entries(entry.scores)
            .filter(([k,v]) => v > 0)
            .map(([k,v]) => `${k}:${v}`)
            .join(', ');
            
        div.innerHTML = `
            <span class="log-time">[${date}]</span>
            <span>Training round completed. Result: ${scores || 'No match'}</span>
        `;
        container.appendChild(div);
    });
}

/**
 * Toggle Carousel Visibility
 */
function toggleCarousel() {
    const wrapper = document.getElementById('carouselWrapper');
    const icon = document.getElementById('carouselToggleIcon');
    
    if (!wrapper) return;
    
    if (wrapper.style.display === 'none') {
        wrapper.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(0deg)';
    } else {
        wrapper.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(-90deg)';
    }
}

/**
 * Scroll Carousel
 * @param {number} direction -1 for left, 1 for right
 */
function scrollCarousel(direction) {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    
    // Scroll by width of 2 visible items
    const firstCard = track.querySelector('.draw-card');
    let itemWidth = 240; // Fallback
    
    if (firstCard) {
        itemWidth = firstCard.offsetWidth + 20; // Width + Gap
    }
    
    const scrollAmount = itemWidth * 2;
    
    track.scrollBy({
        left: direction * scrollAmount,
        behavior: 'smooth'
    });
}

// Expose to window for HTML onclick
window.toggleCarousel = toggleCarousel;
window.scrollCarousel = scrollCarousel;
