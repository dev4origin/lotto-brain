/**
 * Lotto Patterns Dashboard
 * Interactive visualization of lottery analysis
 */

// API Base URL (local proxy to avoid CORS)
const API_BASE = '/api';

// State
let selectedDrawType = 'all';
let drawTypes = [];
let allDraws = [];

// =====================================================
// API HELPERS
// =====================================================

async function fetchAPI(table, params = {}) {
  const url = new URL(`${API_BASE}/${table}`, window.location.origin);
  
  // Add query params
  if (params.select) url.searchParams.set('select', params.select);
  if (params.order) url.searchParams.set('order', params.order);
  if (params.limit) url.searchParams.set('limit', params.limit);
  if (params.filter) {
    Object.entries(params.filter).forEach(([key, val]) => {
      url.searchParams.set(key, `eq.${val}`);
    });
  }
  
  const headers = {};
  if (params.count) headers['Prefer'] = 'count=exact';
  
  const res = await fetch(url, { headers });
  const data = await res.json();
  
  return {
    data: Array.isArray(data) ? data : [],
    count: params.count ? parseInt(res.headers.get('content-range')?.split('/')[1] || data.length) : null,
    error: null
  };
}

// =====================================================
// INITIALIZATION
// =====================================================

async function init() {
  console.log('🎰 Initializing Lotto Patterns Dashboard...');
  
  try {
    // Check server status first
    await checkServerStatus();
    
    await loadDrawTypes();
    await loadHeaderStats();
    await loadAllData();
    
    // Set up event listeners
    document.getElementById('drawTypeSelect').addEventListener('change', handleDrawTypeChange);
    document.getElementById('refreshData').addEventListener('click', handleRefreshData);
    
    // New AI predictions button
    const refreshPredictionsBtn = document.getElementById('refreshPredictions');
    if (refreshPredictionsBtn) {
      refreshPredictionsBtn.addEventListener('click', loadAIPredictions);
    }
    
    // Evaluator
    const evalBtn = document.getElementById('evaluateBtn');
    if (evalBtn) {
      evalBtn.addEventListener('click', handleEvaluate);
    }
    
    // Load AI predictions
    await loadAIPredictions();
    
    // Start periodic status check (every 30 seconds)
    setInterval(checkServerStatus, 30000);
    
    // Init Brain UI
    await initBrainFeatures();
    
    console.log('✅ Dashboard initialized successfully');
  } catch (error) {
    console.error('Error initializing dashboard:', error);
    updateStatusUI('error', 'Erreur de connexion');
  }
}

// =====================================================
// SERVER STATUS & REFRESH
// =====================================================

async function checkServerStatus() {
  try {
    const res = await fetch('/status');
    const status = await res.json();
    
    if (status.autoRefresh?.isRefreshing) {
      updateStatusUI('refreshing', 'Actualisation en cours...');
    } else if (status.autoRefresh?.lastRefresh) {
      const lastRefresh = new Date(status.autoRefresh.lastRefresh);
      const timeAgo = getTimeAgo(lastRefresh);
      updateStatusUI('online', `Dernière MAJ: ${timeAgo}`);
    } else {
      updateStatusUI('online', 'Serveur connecté');
    }
    
    return status;
  } catch (error) {
    updateStatusUI('error', 'Serveur hors ligne');
    return null;
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'à l\'instant';
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)}h`;
  return `il y a ${Math.floor(seconds / 86400)}j`;
}

function updateStatusUI(status, text) {
  const indicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  
  indicator.className = 'status-indicator ' + status;
  statusText.textContent = text;
}

async function handleRefreshData() {
  const btn = document.getElementById('refreshData');
  const originalText = btn.querySelector('.refresh-text').textContent;
  
  // Update button state
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.refresh-text').textContent = 'Actualisation...';
  updateStatusUI('refreshing', 'Actualisation en cours...');
  
  try {
    // Trigger server-side refresh
    const res = await fetch('/refresh', { method: 'POST' });
    const result = await res.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Refresh failed');
    }
    
    // Poll for completion
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const status = await checkServerStatus();
      
      if (status && !status.autoRefresh?.isRefreshing) {
        // Refresh complete, reload data
        await loadAllData();
        await loadHeaderStats();
        await loadAIPredictions();
        
        updateStatusUI('online', 'Données actualisées!');
        
        // Notify User
        if (localStorage.getItem('notify_predictions') === 'true' && 'Notification' in window) {
           if (Notification.permission === 'granted') {
             new Notification('🔮 Lotto Patterns', {
               body: 'De nouvelles prédictions sont disponibles suite au dernier tirage !'
             });
           }
        }
        break;
      }
      attempts++;
    }
  } catch (error) {
    console.error('Refresh error:', error);
    updateStatusUI('error', 'Échec de l\'actualisation');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.refresh-text').textContent = originalText;
  }
}

// =====================================================
// DATA LOADING
// =====================================================

async function loadDrawTypes() {
  const { data, error } = await fetchAPI('draw_types', {
    select: 'id,name,category',
    order: 'name.asc'
  });
  
  if (error || !data) {
    console.error('Error loading draw types:', error);
    return;
  }
  
  drawTypes = data;
  
  // Populate select with Groups
  const select = document.getElementById('drawTypeSelect');
  select.innerHTML = '<option value="all">Tous les types de tirages</option>';
  
  // Define Groups
  const groups = {
    'Quotidien & Spécial': [],
    'Lundi': [],
    'Mardi': [],
    'Mercredi': [],
    'Jeudi': [],
    'Vendredi': [],
    'Samedi': [],
    'Dimanche': []
  };
  
  // Mapping logic based on analysis
  const dayMapping = {
    'monday': 'Lundi', 'monday special': 'Lundi', 'akwaba': 'Lundi', 
    'tuesday': 'Mardi', 'lucky tuesday': 'Mardi', 'emergence': 'Mardi', 'sika': 'Mardi',
    'midweek': 'Mercredi', 'fortune': 'Mercredi', 'baraka': 'Mercredi',
    'thursday': 'Jeudi', 'fortune thursday': 'Jeudi', 'privilege': 'Jeudi', 'monni': 'Jeudi',
    'friday': 'Vendredi', 'friday bonanza': 'Vendredi', 'solution': 'Vendredi', 'wari': 'Vendredi',
    'national': 'Samedi', 'moaye': 'Samedi', 'soutra': 'Samedi', 'diamant': 'Samedi',
    'sunday': 'Dimanche', 'benediction': 'Dimanche', 'prestige': 'Dimanche', 'awale': 'Dimanche', 'espoir': 'Dimanche'
  };

  data.forEach(type => {
    const name = type.name.toLowerCase();
    
    // 1. Priority: Digital & Special Weekend & Varied -> Quotidien
    if (name.includes('digital') || name.includes('weekend') || name.includes('day off') || name.includes('nuit')) {
      groups['Quotidien & Spécial'].push(type);
      return;
    }
    
    let assigned = false;
    
    // 2. Specific Day Mapping
    // Use exact matches or strong keywords to avoid confusion (e.g. 'Reveil' is specifically Monday, but 'Digital Reveil' is caught above)
    if (name === 'reveil' || name === 'etoile' || name === 'la matinale' || name === 'premiere heure' || name === 'kado' || name === 'cash') {
       // Manual overrides for short names
       if (name === 'reveil' || name === 'etoile') groups['Lundi'].push(type);
       if (name === 'la matinale') groups['Mardi'].push(type);
       if (name === 'premiere heure') groups['Mercredi'].push(type);
       if (name === 'kado') groups['Jeudi'].push(type);
       if (name === 'cash') groups['Vendredi'].push(type);
       assigned = true;
    } else {
        for (const [key, group] of Object.entries(dayMapping)) {
          if (name.includes(key)) {
            groups[group].push(type);
            assigned = true;
            break;
          }
        }
    }
    
    if (!assigned) {
       groups['Quotidien & Spécial'].push(type);
    }
  });
  
  // Render Groups
  Object.entries(groups).forEach(([groupName, types]) => {
    if (types.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = groupName;
      
      types.forEach(type => {
        const option = document.createElement('option');
        option.value = type.id;
        option.textContent = type.name;
        optgroup.appendChild(option);
      });
      
      select.appendChild(optgroup);
    }
  });

  // Intelligent Default Selection based on Day of Week
  const today = new Date().getDay(); // 0 (Sun) - 6 (Sat)
  let defaultType = null;
  
  // Priority list for each day
  const weeklyMap = {
    1: ['Monday Special'],
    2: ['Lucky Tuesday'],
    3: ['Midweek'],
    4: ['Fortune Thursday'],
    5: ['Friday Bonanza'],
    6: ['National'],
    0: ['Reveil']
  };
  
  const preferredNames = weeklyMap[today] || [];
  
  for (const name of preferredNames) {
    const found = data.find(t => t.name.toLowerCase().includes(name.toLowerCase()));
    if (found) {
      defaultType = found.id;
      break;
    }
  }
  
  if (defaultType) {
    select.value = defaultType;
    selectedDrawType = defaultType;
    console.log(`🎯 Auto-selected relevant draw for today (Day ${today}): ${defaultType}`);
  }
  
  console.log(`   Loaded ${drawTypes.length} draw types`);
}

async function loadHeaderStats() {
  // Total draws - optimized count
  const { count } = await fetchAPI('draws', {
    select: 'id',
    count: true,
    limit: 1 // We just want the count header
  });
  
  // Total types
  const typeCount = drawTypes.length;
  
  // Date range (light query)
  const { data: latest } = await fetchAPI('draws', {
    select: 'draw_date',
    order: 'draw_date.desc',
    limit: 1
  });
  
  const { data: oldest } = await fetchAPI('draws', {
    select: 'draw_date',
    order: 'draw_date.asc',
    limit: 1
  });

  if (count) document.getElementById('totalDraws').textContent = count.toLocaleString();
  document.getElementById('totalTypes').textContent = typeCount;
  
  if (latest?.[0] && oldest?.[0]) {
    const start = new Date(oldest[0].draw_date).getFullYear();
    const end = new Date(latest[0].draw_date).getFullYear();
    document.getElementById('dateRange').textContent = start === end ? start : `${start}-${end}`;
  }
}

async function loadAllData() {
  console.log('📥 Loading analytical data...');
  
  // 1. Fetch data (Optimized: limit to 2000 recent draws for UI performance)
  let params = {
    select: 'winning_number_1,winning_number_2,winning_number_3,winning_number_4,winning_number_5,draw_date,draw_type_id,day_of_week,machine_number_1,machine_number_2,machine_number_3,machine_number_4,machine_number_5',
    order: 'draw_date.desc',
    limit: 2000 
  };
  
  if (selectedDrawType !== 'all') {
    params.filter = { draw_type_id: selectedDrawType };
  }
  
  const { data, error } = await fetchAPI('draws', params);
  
  if (error || !data) {
    console.error('Error loading data:', error);
    return;
  }
  
  allDraws = data.map(d => ({
    ...d,
    numbers: [
      d.winning_number_1, d.winning_number_2, d.winning_number_3, d.winning_number_4, d.winning_number_5
    ].filter(n => n !== null)
  }));
  
  console.log(`📊 Analyzed ${allDraws.length} draws`);
  
  // 2. Process Stats (async with delay to prevent UI freeze)
  const charts = [
    updateHotNumbers,
    updateColdNumbers,
    updateOverdueNumbers,
    updateFrequentPairs,
    updateOddEvenChart,
    updateSumStats,
    updateConsecutiveStats,
    updateFrequencyHeatmap,
    updateDayOfWeekStats,
    updateRecentDraws
  ];

  // Show loading state on charts
  document.querySelectorAll('.stat-content, .chart-card').forEach(el => {
    if (!el.querySelector('.loading-skeleton')) {
       // Optional: Add loading class
    }
  });

  // Execute updates sequentially with a small tick to let UI breathe
  for (const updateFn of charts) {
    await new Promise(resolve => setTimeout(resolve, 10)); // 10ms breathing room
    updateFn();
  }
}

// =====================================================
// UI UPDATES
// =====================================================

function handleDrawTypeChange(event) {
  selectedDrawType = event.target.value;
  
  // Clear existing data to prevent "mixing"
  document.getElementById('hotNumbers').innerHTML = '<div class="loading-skeleton"></div>';
  document.getElementById('coldNumbers').innerHTML = '<div class="loading-skeleton"></div>';
  document.getElementById('overdueNumbers').innerHTML = '<div class="loading-skeleton"></div>';
  document.getElementById('frequentPairs').innerHTML = '<div class="loading-skeleton"></div>';
  document.getElementById('sumStats').innerHTML = '<div class="loading-skeleton"></div>';
  
  // Reload data with optimization
  loadAllData().then(() => {
    // Reload AI with new type
    loadAIPredictions(); 
  });
}

async function updateHotNumbers() {
  const container = document.getElementById('hotNumbers');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Count number frequency
  const counts = {};
  for (const draw of allDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) counts[num] = (counts[num] || 0) + 1;
    });
  }
  
  // Get top 5
  const top5 = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  container.innerHTML = top5.map(([num, count]) => `
    <div class="number-pill hot">
      <span class="number">${num}</span>
      <span class="count">${count}x</span>
    </div>
  `).join('');
}

async function updateColdNumbers() {
  const container = document.getElementById('coldNumbers');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Count number frequency
  const counts = {};
  for (let i = 1; i <= 90; i++) counts[i] = 0;
  
  for (const draw of allDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) counts[num]++;
    });
  }
  
  // Get bottom 5
  const bottom5 = Object.entries(counts)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5);
  
  container.innerHTML = bottom5.map(([num, count]) => `
    <div class="number-pill cold">
      <span class="number">${num}</span>
      <span class="count">${count}x</span>
    </div>
  `).join('');
}

async function updateOverdueNumbers() {
  const container = document.getElementById('overdueNumbers');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Track last seen
  const lastSeen = {};
  for (let i = 1; i <= 90; i++) lastSeen[i] = null;
  
  for (const draw of allDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num && !lastSeen[num]) {
        lastSeen[num] = draw.draw_date;
      }
    });
  }
  
  const today = new Date();
  const overdue = Object.entries(lastSeen)
    .map(([num, date]) => ({
      number: num,
      days: date ? Math.floor((today - new Date(date)) / (1000 * 60 * 60 * 24)) : 9999
    }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);
  
  container.innerHTML = overdue.map(item => `
    <div class="number-pill overdue">
      <span class="number">${item.number}</span>
      <span class="count">${item.days}j</span>
    </div>
  `).join('');
}

async function updateFrequentPairs() {
  const container = document.getElementById('frequentPairs');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Count pairs
  const pairs = {};
  
  for (const draw of allDraws) {
    const nums = [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].filter(n => n).sort((a, b) => a - b);
    
    for (let i = 0; i < nums.length - 1; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const key = `${nums[i]}-${nums[j]}`;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  }
  
  // Get top 5
  const top5 = Object.entries(pairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  container.innerHTML = top5.map(([pair, count]) => {
    const [n1, n2] = pair.split('-');
    return `
      <div class="pair-item">
        <div class="pair-numbers">
          <span>${n1}</span>
          <span>${n2}</span>
        </div>
        <span class="pair-count">${count} fois</span>
      </div>
    `;
  }).join('');
}

async function updateOddEvenChart() {
  const container = document.getElementById('oddEvenChart');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Count distributions
  const distributions = {};
  
  for (const draw of allDraws) {
    const nums = [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].filter(n => n);
    
    const oddCount = nums.filter(n => n % 2 === 1).length;
    const evenCount = 5 - oddCount;
    const pattern = `${oddCount}I/${evenCount}P`;
    distributions[pattern] = (distributions[pattern] || 0) + 1;
  }
  
  const total = allDraws.length || 1;
  const sorted = Object.entries(distributions).sort((a, b) => b[1] - a[1]);
  
  container.innerHTML = sorted.slice(0, 5).map(([pattern, count]) => {
    const percentage = ((count / total) * 100).toFixed(1);
    return `
      <div class="dist-bar">
        <span class="dist-label">${pattern}</span>
        <div class="dist-track">
          <div class="dist-fill" style="width: ${percentage}%">
            <span>${percentage}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function updateSumStats() {
  const container = document.getElementById('sumStats');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  const sums = allDraws.map(draw => 
    (draw.winning_number_1 || 0) + (draw.winning_number_2 || 0) + 
    (draw.winning_number_3 || 0) + (draw.winning_number_4 || 0) + 
    (draw.winning_number_5 || 0)
  ).filter(s => s > 0);
  
  const min = Math.min(...sums);
  const max = Math.max(...sums);
  const avg = (sums.reduce((a, b) => a + b, 0) / sums.length).toFixed(0);
  sums.sort((a, b) => a - b);
  const median = sums[Math.floor(sums.length / 2)];
  
  container.innerHTML = `
    <div class="sum-stat">
      <div class="value">${min}</div>
      <div class="label">Minimum</div>
    </div>
    <div class="sum-stat">
      <div class="value">${max}</div>
      <div class="label">Maximum</div>
    </div>
    <div class="sum-stat">
      <div class="value">${avg}</div>
      <div class="label">Moyenne</div>
    </div>
    <div class="sum-stat">
      <div class="value">${median}</div>
      <div class="label">Médiane</div>
    </div>
  `;
}

async function updateConsecutiveStats() {
  const container = document.getElementById('consecutiveStats');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Count by type
  const stats = {};
  
  for (const draw of allDraws) {
    const typeName = drawTypes.find(t => t.id === draw.draw_type_id)?.name || 'Unknown';
    if (!stats[typeName]) {
      stats[typeName] = { total: 0, withConsecutive: 0 };
    }
    
    const nums = [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].filter(n => n).sort((a, b) => a - b);
    
    let hasConsecutive = false;
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i + 1] - nums[i] === 1) {
        hasConsecutive = true;
        break;
      }
    }
    
    stats[typeName].total++;
    if (hasConsecutive) stats[typeName].withConsecutive++;
  }
  
  const sorted = Object.entries(stats)
    .map(([type, s]) => ({
      type,
      percentage: ((s.withConsecutive / s.total) * 100).toFixed(1)
    }))
    .sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage))
    .slice(0, 5);
  
  container.innerHTML = sorted.map(item => `
    <div class="consecutive-item">
      <span class="consecutive-label">${item.type.substring(0, 15)}</span>
      <div class="consecutive-bar">
        <div class="consecutive-fill" style="width: ${item.percentage}%"></div>
      </div>
      <span class="consecutive-value">${item.percentage}%</span>
    </div>
  `).join('');
}

async function updateFrequencyHeatmap() {
  const container = document.getElementById('frequencyHeatmap');
  const info = document.getElementById('heatmapInfo');
  
  // Update info text
  if (info) {
    const typeName = drawTypes.find(t => t.id == selectedDrawType)?.name || 'Tous les tirages';
    info.innerHTML = `Tendances pour <strong style="color: #a855f7">${typeName}</strong> • ${allDraws.length} tirages analysés`;
  }
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  // Count all numbers
  const counts = {};
  for (let i = 1; i <= 90; i++) counts[i] = 0;
  
  for (const draw of allDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) counts[num]++;
    });
  }
  
  const maxCount = Math.max(...Object.values(counts));
  
  container.innerHTML = Array.from({ length: 90 }, (_, i) => {
    const num = i + 1;
    const count = counts[num];
    const intensity = maxCount > 0 ? count / maxCount : 0;
    
    // Color from blue (cold) to red (hot)
    const hue = 240 - (intensity * 240); // Blue to Red
    const saturation = 70 + (intensity * 30);
    const lightness = 25 + (intensity * 25);
    
    return `
      <div class="heatmap-cell" 
           style="background: hsl(${hue}, ${saturation}%, ${lightness}%)"
           data-count="${num}: ${count}x">
        ${num}
      </div>
    `;
  }).join('');
}

async function updateDayOfWeekStats() {
  const container = document.getElementById('dayOfWeekStats');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Aucune donnée</p>';
    return;
  }
  
  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const dayStats = {};
  
  for (const draw of allDraws) {
    const dayName = dayNames[draw.day_of_week] || 'Unknown';
    if (!dayStats[dayName]) {
      dayStats[dayName] = {};
    }
    
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) dayStats[dayName][num] = (dayStats[dayName][num] || 0) + 1;
    });
  }
  
  container.innerHTML = Object.entries(dayStats).map(([day, counts]) => {
    const top5 = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([num]) => num);
    
    return `
      <div class="day-item">
        <div class="day-name">${day}</div>
        <div class="day-numbers">
          ${top5.map(n => `<span class="day-number">${n}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

async function updateRecentDraws() {
  const container = document.getElementById('recentDrawsBody');
  
  if (!allDraws.length) {
    container.innerHTML = '<tr><td colspan="4">Aucune donnée</td></tr>';
    return;
  }
  
  const recent = allDraws.slice(0, 10);
  
  container.innerHTML = recent.map(draw => `
    <tr>
      <td class="date">${new Date(draw.draw_date).toLocaleDateString('fr-FR')}</td>
      <td class="type">${drawTypes.find(t => t.id === draw.draw_type_id)?.name || '-'}</td>
      <td>
        <div class="winning-numbers">
          <span>${draw.winning_number_1}</span>
          <span>${draw.winning_number_2}</span>
          <span>${draw.winning_number_3}</span>
          <span>${draw.winning_number_4}</span>
          <span>${draw.winning_number_5}</span>
        </div>
      </td>
      <td>
        <div class="machine-numbers">
          ${draw.machine_number_1 ? `
            <span>${draw.machine_number_1}</span>
            <span>${draw.machine_number_2}</span>
            <span>${draw.machine_number_3}</span>
            <span>${draw.machine_number_4}</span>
            <span>${draw.machine_number_5}</span>
          ` : '-'}
        </div>
      </td>
    </tr>
  `).join('');
}

// =====================================================
// PREDICTIONS & ALERTS
// =====================================================

const PREDICTION_WEIGHTS = {
  hotNumber: 0.25,
  coldNumber: 0.15,
  overdueNumber: 0.20,
  dayOfWeek: 0.15,
  positionFreq: 0.10,
  pairs: 0.10,
  sumRange: 0.05
};

function calculateNumberScores(draws) {
  const scores = {};
  const freq = {};
  const lastSeen = {};
  
  // Initialize
  for (let i = 1; i <= 90; i++) {
    scores[i] = 0;
    freq[i] = 0;
    lastSeen[i] = { date: null, days: 9999 };
  }
  
  const today = new Date();
  
  // Calculate frequency and last seen
  for (const draw of draws) {
    const nums = [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
                  draw.winning_number_4, draw.winning_number_5];
    
    for (const num of nums) {
      if (num) {
        freq[num]++;
        if (!lastSeen[num].date) {
          lastSeen[num].date = draw.draw_date;
          lastSeen[num].days = Math.floor((today - new Date(draw.draw_date)) / (1000 * 60 * 60 * 24));
        }
      }
    }
  }
  
  const maxFreq = Math.max(...Object.values(freq));
  const minFreq = Math.min(...Object.values(freq));
  const validDays = Object.values(lastSeen).filter(l => l.days < 9999);
  const maxDays = validDays.length ? Math.max(...validDays.map(l => l.days)) : 1;
  
  // Score each number
  for (let num = 1; num <= 90; num++) {
    // Hot number score
    const hotScore = maxFreq > 0 ? (freq[num] / maxFreq) * PREDICTION_WEIGHTS.hotNumber * 100 : 0;
    
    // Cold number score (contrarian)
    const coldScore = maxFreq > minFreq ? 
      ((maxFreq - freq[num]) / (maxFreq - minFreq)) * PREDICTION_WEIGHTS.coldNumber * 100 : 0;
    
    // Overdue score
    const overdueScore = maxDays > 0 && lastSeen[num].days < 9999 ? 
      (lastSeen[num].days / maxDays) * PREDICTION_WEIGHTS.overdueNumber * 100 : 0;
    
    scores[num] = hotScore + coldScore + overdueScore;
  }
  
  return { scores, freq, lastSeen };
}

function generatePrediction(scores, draws) {
  // Calculate sum stats
  const sums = draws.map(d => 
    (d.winning_number_1 || 0) + (d.winning_number_2 || 0) + (d.winning_number_3 || 0) +
    (d.winning_number_4 || 0) + (d.winning_number_5 || 0)
  ).filter(s => s > 0);
  
  sums.sort((a, b) => a - b);
  const q1 = sums[Math.floor(sums.length * 0.25)] || 100;
  const q3 = sums[Math.floor(sums.length * 0.75)] || 300;
  
  // Sort numbers by score
  const sortedNumbers = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([num, score]) => ({ number: parseInt(num), score }));
  
  const predictions = [];
  const strategies = ['hot', 'mixed', 'balanced'];
  
  for (const strategy of strategies) {
    let pool;
    if (strategy === 'hot') {
      pool = sortedNumbers.slice(0, 25).map(n => n.number);
    } else if (strategy === 'mixed') {
      pool = [...sortedNumbers.slice(0, 15), ...sortedNumbers.slice(-15)].map(n => n.number);
    } else {
      pool = sortedNumbers.map(n => n.number);
    }
    
    let attempt = 0;
    while (attempt < 500) {
      // Pick 5 random numbers from pool
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 5).sort((a, b) => a - b);
      
      // Check sum is in acceptable range
      const sum = selected.reduce((a, b) => a + b, 0);
      if (sum >= q1 && sum <= q3) {
        const avgScore = selected.reduce((acc, num) => acc + scores[num], 0) / 5;
        const confidence = Math.min(95, Math.max(15, avgScore * 2));
        
        predictions.push({
          numbers: selected,
          sum,
          confidence: parseFloat(confidence.toFixed(1)),
          strategy
        });
        break;
      }
      attempt++;
    }
  }
  
  return predictions.sort((a, b) => b.confidence - a.confidence);
}

function generateAlerts(draws, lastSeen, freq) {
  const alerts = [];
  
  // Overdue alerts
  for (let num = 1; num <= 90; num++) {
    if (lastSeen[num].days >= 30 && lastSeen[num].days < 9999) {
      alerts.push({
        type: 'overdue',
        number: num,
        daysSince: lastSeen[num].days,
        message: `Le numéro ${num} n'est pas sorti depuis ${lastSeen[num].days} jours`,
        severity: lastSeen[num].days > 60 ? 'high' : 'medium'
      });
    }
  }
  
  // Hot streak alerts (recent frequency)
  const recentDraws = draws.slice(0, 30);
  const recentFreq = {};
  for (let i = 1; i <= 90; i++) recentFreq[i] = 0;
  
  for (const draw of recentDraws) {
    [draw.winning_number_1, draw.winning_number_2, draw.winning_number_3,
     draw.winning_number_4, draw.winning_number_5].forEach(num => {
      if (num) recentFreq[num]++;
    });
  }
  
  for (let num = 1; num <= 90; num++) {
    if (recentFreq[num] >= 5) {
      alerts.push({
        type: 'hot_streak',
        number: num,
        recentCount: recentFreq[num],
        message: `Le numéro ${num} est en série chaude!`,
        detail: `${recentFreq[num]}x dans les 30 derniers tirages`,
        severity: 'high'
      });
    }
  }
  
  // Sort by severity
  const severityOrder = { high: 3, medium: 2, low: 1 };
  alerts.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  
  return alerts.slice(0, 10);
}

// =====================================================
// AI PREDICTIONS
// =====================================================

async function loadAIPredictions() {
  const mainContainer = document.getElementById('mainPrediction');
  const alternativesContainer = document.getElementById('alternativesGrid');
  const candidatesContainer = document.getElementById('candidatesList');
  const alertsContainer = document.getElementById('alertsList');
  const refreshBtn = document.getElementById('refreshPredictions');
  
  // Show loading state
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }
  
  mainContainer.innerHTML = `
    <div class="prediction-loading">
      <div class="loading-spinner"></div>
      <p>Génération des prédictions IA...</p>
    </div>
  `;
  
  try {
    // Get current filters
    const drawTypeId = document.getElementById('drawTypeSelect').value;
    const currentDay = new Date().getDay(); // 0-6
    
    // Build URL
    let url = '/predict';
    const params = new URLSearchParams();
    
    // Always use current day for prediction focus
    params.append('day', currentDay);
    
    if (drawTypeId && drawTypeId !== 'all') {
      params.append('type', drawTypeId);
    }
    
    const response = await fetch(`${url}?${params.toString()}&_t=${Date.now()}`);
    const predictions = await response.json();
    
    if (predictions.error) {
      throw new Error(predictions.error);
    }
    
    // Render main prediction with all three types
    console.log('🔮 Prediction Context:', predictions.context);
    renderMainPrediction(mainContainer, predictions.main, predictions.machine, predictions.hybrid, predictions.context, predictions.lastPerformance);
    
    // Render alternatives
    renderAlternatives(alternativesContainer, predictions.alternatives);
    
    // Render top candidates
    renderCandidates(candidatesContainer, predictions.topCandidates);
    
    // Render alerts
    renderAlerts(alertsContainer, predictions.alerts);
    
    console.log('✅ AI Predictions loaded', predictions.cached ? '(cached)' : '(fresh)');
    
  } catch (error) {
    console.error('Error loading AI predictions:', error);
    mainContainer.innerHTML = `
      <div class="prediction-loading">
        <p>❌ Erreur de chargement des prédictions</p>
        <p style="font-size: 0.875rem; color: #a0a0b0;">${error.message}</p>
      </div>
    `;
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }
  }
}

function renderMainPrediction(container, main, machine, hybrid, context = {}, lastPerformance = null) {
  if (!main || !main.numbers) {
    container.innerHTML = '<p>Aucune prédiction disponible</p>';
    return;
  }
  
  // Format context info
  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const dayName = context.dayOfWeek !== null && context.dayOfWeek !== undefined ? dayNames[context.dayOfWeek] : '';
  
  let typeName = '';
  if (context.drawTypeId) {
    const type = drawTypes.find(t => t.id == context.drawTypeId);
    typeName = type ? type.name : 'Tirage spécifique';
  } else {
    typeName = 'Tous les tirages';
  }
  
  const contextBadge = dayName ? `${dayName} • ${typeName}` : typeName;
  
  // --- LAST PERFORMANCE HTML GENERATION ---
  let lastPerfHtml = '';
  if (lastPerformance) {
     const matches = lastPerformance.matches || [];
     const count = lastPerformance.matchCount;
     const color = count >= 3 ? '#22c55e' : count >= 2 ? '#3b82f6' : '#ef4444';
     const date = new Date(lastPerformance.date).toLocaleDateString('fr-FR');
     
     lastPerfHtml = `
       <div class="last-performance" style="
          margin-bottom: 20px; 
          padding: 12px 16px; 
          background: rgba(15, 23, 42, 0.6); 
          border-left: 4px solid ${color}; 
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
       ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
             <span style="font-size: 0.85rem; color: #94a3b8; display: flex; align-items: center; gap: 6px;">
               <span>📜</span> Résultat du ${date}
             </span>
             <span style="font-size: 0.9rem; font-weight: 700; color: ${color}; background: rgba(0,0,0,0.2); padding: 2px 8px; border-radius: 99px;">
               ${count}/5 trouvé(s)
             </span>
          </div>
          
          <div style="display: grid; grid-template-columns: auto 1fr; row-gap: 8px; column-gap: 12px; align-items: center;">
             <!-- Predicted -->
             <div style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Prédit</div>
             <div style="display: flex; gap: 6px;">
                ${lastPerformance.predicted.map(n => {
                   const isMatch = matches.includes(n);
                   return `<span style="
                      width: 26px; height: 26px; 
                      display: flex; align-items: center; justify-content: center; 
                      border-radius: 50%; 
                      background: ${isMatch ? color : 'rgba(255,255,255,0.03)'}; 
                      color: ${isMatch ? '#fff' : '#94a3b8'}; 
                      font-weight: ${isMatch ? '700' : '500'};
                      font-size: 0.85rem;
                      transition: all 0.2s;
                   ">${n}</span>`;
                }).join('')}
             </div>
             
             <!-- Actual -->
             <div style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Réel</div>
             <div style="display: flex; gap: 6px;">
                ${lastPerformance.actual.map(n => {
                   const isMatch = matches.includes(n);
                   return `<span style="
                      width: 26px; height: 26px; 
                      display: flex; align-items: center; justify-content: center; 
                      border-radius: 50%; 
                      background: ${isMatch ? color : 'rgba(255,255,255,0.03)'}; 
                      color: ${isMatch ? '#fff' : '#cbd5e1'}; 
                      font-weight: 700;
                      border: 1px solid ${isMatch ? color : 'rgba(148, 163, 184, 0.2)'};
                      font-size: 0.85rem;
                   ">${n}</span>`;
                }).join('')}
             </div>
          </div>
       </div>
     `;
  }

  // Helper function to render a prediction card
  const renderPredictionCard = (pred, label, icon, color, extraInfo = '') => {
    if (!pred || !pred.numbers) return '';
    
    return `
      <div class="prediction-label" style="color: ${color};">${icon} ${label}</div>
      <div class="prediction-numbers">
        ${pred.numbers.map(n => `<div class="prediction-number" style="border-color: ${color};">${n}</div>`).join('')}
      </div>
      <div class="prediction-meta">
        <div class="meta-item">
          <span class="meta-label">Somme</span>
          <span class="meta-value">${pred.sum}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Confiance</span>
          <span class="meta-value confidence" style="color: ${color};">${pred.confidence}%</span>
        </div>
        ${extraInfo}
      </div>
    `;
  };

  container.innerHTML = `
    <div class="prediction-context">
      <span class="context-badge">${contextBadge}</span>
      <span class="context-info">${context.drawsAnalyzed || 0} tirages analysés</span>
    </div>
    
    ${lastPerfHtml}
    
    <!-- Prediction Tabs -->
    <div class="prediction-tabs" style="display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid rgba(148, 163, 184, 0.1);">
      <button class="pred-tab active" data-tab="hybrid" style="flex: 1; padding: 12px; background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2)); border: none; border-bottom: 3px solid #a855f7; color: #fff; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 8px 8px 0 0;">
        ⭐ Hybride (Recommandé)
      </button>
      <button class="pred-tab" data-tab="main" style="flex: 1; padding: 12px; background: rgba(59, 130, 246, 0.1); border: none; border-bottom: 3px solid transparent; color: #94a3b8; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 8px 8px 0 0;">
        🎯 Gagnants
      </button>
      <button class="pred-tab" data-tab="machine" style="flex: 1; padding: 12px; background: rgba(34, 197, 94, 0.1); border: none; border-bottom: 3px solid transparent; color: #94a3b8; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 8px 8px 0 0;">
        🎰 Machine
      </button>
    </div>
    
    <!-- Hybrid Prediction -->
    <div class="pred-content" data-content="hybrid" style="display: block;">
      ${renderPredictionCard(hybrid, 'Prédiction Hybride', '⭐', '#a855f7', `
        <div class="meta-item">
          <span class="meta-label">Méthode</span>
          <span class="meta-value" style="color:#fb923c; font-size:0.75em;">Boost Corrélation</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Force Corrélation</span>
          <span class="meta-value" style="color:#22c55e;">${hybrid ? (hybrid.correlationStrength * 100).toFixed(0) : 0}%</span>
        </div>
      `)}
      ${hybrid ? `<div style="margin-top: 12px; padding: 10px; background: rgba(168, 85, 247, 0.1); border-radius: 8px; font-size: 0.85rem; color: #cbd5e1;">
        💡 <strong>Hybride</strong> combine les patterns des numéros gagnants ET machine. ${hybrid.boostedCount} numéros boostés par <strong>Analyses Statistiques</strong> et corrélation historique.
      </div>` : ''}
    </div>
    
    <!-- Main Prediction -->
    <div class="pred-content" data-content="main" style="display: none;">
      ${renderPredictionCard(main, 'Numéros Gagnants', '🎯', '#3b82f6', `
        <div class="meta-item">
          <span class="meta-label">Stratégie</span>
          <span class="meta-value" style="color:#fb923c; font-size:0.8em;">Tactical ±1</span>
        </div>
      `)}
    </div>
    
    <!-- Machine Prediction -->
    <div class="pred-content" data-content="machine" style="display: none;">
      ${renderPredictionCard(machine, 'Numéros Machine', '🎰', '#22c55e', `
        <div class="meta-item">
          <span class="meta-label">Type</span>
          <span class="meta-value" style="color:#06b6d4; font-size:0.8em;">Machine Brain</span>
        </div>
      `)}
      ${machine ? `<div style="margin-top: 12px; padding: 10px; background: rgba(34, 197, 94, 0.1); border-radius: 8px; font-size: 0.85rem; color: #cbd5e1;">
        🎰 <strong>Machine</strong> analyse les patterns des numéros de machine pour prédire les prochains.
      </div>` : ''}
    </div>
  `;
  
  // Add tab switching logic
  const tabs = container.querySelectorAll('.pred-tab');
  const contents = container.querySelectorAll('.pred-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update tabs
      tabs.forEach(t => {
        t.classList.remove('active');
        t.style.borderBottomColor = 'transparent';
        t.style.color = '#94a3b8';
        t.style.background = 'rgba(148, 163, 184, 0.05)';
      });
      
      tab.classList.add('active');
      if (targetTab === 'hybrid') {
        tab.style.borderBottomColor = '#a855f7';
        tab.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))';
        tab.style.color = '#fff';
      } else if (targetTab === 'main') {
        tab.style.borderBottomColor = '#3b82f6';
        tab.style.background = 'rgba(59, 130, 246, 0.2)';
        tab.style.color = '#fff';
      } else if (targetTab === 'machine') {
        tab.style.borderBottomColor = '#22c55e';
        tab.style.background = 'rgba(34, 197, 94, 0.2)';
        tab.style.color = '#fff';
      }
      
      // Update content
      contents.forEach(content => {
        content.style.display = content.dataset.content === targetTab ? 'block' : 'none';
      });
    });
  });
}

function renderAlternatives(container, alternatives) {
  if (!alternatives || !alternatives.length) {
    container.innerHTML = '<p>Aucune alternative disponible</p>';
    return;
  }
  
  container.innerHTML = alternatives.map(alt => `
    <div class="alternative-card">
      <div class="alternative-header">
        <span class="alternative-icon">${alt.icon}</span>
        <span class="alternative-name">${alt.name}</span>
      </div>
      <div class="alternative-numbers">
        ${alt.numbers.map(n => `<span class="alt-number">${n}</span>`).join('')}
      </div>
      <div class="alternative-desc">${alt.description}</div>
    </div>
  `).join('');
}

function renderCandidates(container, candidates) {
  if (!candidates || !candidates.length) {
    container.innerHTML = '<p>Aucun candidat disponible</p>';
    return;
  }
  
  // Get max score for relative bar sizing
  const maxScore = Math.max(...candidates.map(c => c.score));
  
  container.innerHTML = candidates.slice(0, 10).map((c, i) => {
    const barWidth = (c.score / maxScore) * 100;
    return `
      <div class="candidate-item">
        <span class="candidate-rank">#${i + 1}</span>
        <span class="candidate-number">${c.number.toString().padStart(2, '0')}</span>
        <div class="candidate-bar">
          <div class="candidate-bar-fill" style="width: ${barWidth}%"></div>
        </div>
        <span class="candidate-score">${c.score.toFixed(3)}</span>
      </div>
    `;
  }).join('');
}

function renderAlerts(container, alerts) {
  if (!alerts || !alerts.length) {
    container.innerHTML = '<p style="color: #a0a0b0;">Aucune alerte pour le moment</p>';
    return;
  }
  
  container.innerHTML = alerts.map(alert => `
    <div class="alert-item">
      <div class="alert-number">${alert.number}</div>
      <div class="alert-info">
        <div class="alert-label">+${alert.overdueBy} tirages en retard</div>
        <div class="alert-detail">
          Vu il y a ${alert.currentGap} tirages • Cycle moyen: ${alert.avgCycle.toFixed(0)}
        </div>
      </div>
    </div>
  `).join('');
}

async function updatePredictions() {
  const container = document.getElementById('predictionsGrid');
  
  if (!allDraws.length) {
    container.innerHTML = '<p>Chargement des données...</p>';
    return;
  }
  
  const { scores, freq, lastSeen } = calculateNumberScores(allDraws);
  const predictions = generatePrediction(scores, allDraws);
  
  const strategyIcons = {
    hot: '🔥',
    mixed: '🎯',
    balanced: '⚖️'
  };
  
  const strategyNames = {
    hot: 'Numéros Chauds',
    mixed: 'Stratégie Mixte',
    balanced: 'Équilibré'
  };
  
  container.innerHTML = predictions.map((pred, index) => {
    const confidenceClass = pred.confidence >= 70 ? 'high' : pred.confidence >= 40 ? 'medium' : 'low';
    const isTop = index === 0;
    
    return `
      <div class="prediction-item ${isTop ? 'high-confidence' : ''}">
        <div class="prediction-type">
          <span class="prediction-type-icon">${strategyIcons[pred.strategy]}</span>
          <span class="prediction-type-name">${strategyNames[pred.strategy]}</span>
        </div>
        <div class="prediction-numbers">
          ${pred.numbers.map(n => `<span class="prediction-number">${n}</span>`).join('')}
        </div>
        <div class="prediction-meta">
          <span class="confidence-badge ${confidenceClass}">
            ⭐ ${pred.confidence}%
          </span>
          <span class="prediction-sum">Σ ${pred.sum}</span>
        </div>
      </div>
    `;
  }).join('');
  
  // Also update alerts
  await updateAlerts(lastSeen, freq);
}

async function updateAlerts(lastSeen, freq) {
  const container = document.getElementById('alertsList');
  
  if (!lastSeen || !freq) {
    const result = calculateNumberScores(allDraws);
    lastSeen = result.lastSeen;
    freq = result.freq;
  }
  
  const alerts = generateAlerts(allDraws, lastSeen, freq);
  
  if (alerts.length === 0) {
    container.innerHTML = '<p>Aucune alerte pour le moment</p>';
    return;
  }
  
  const alertIcons = {
    overdue: '⏰',
    hot_streak: '🔥'
  };
  
  container.innerHTML = alerts.map(alert => `
    <div class="alert-item ${alert.severity}">
      <span class="alert-icon">${alertIcons[alert.type]}</span>
      <div class="alert-content">
        <div class="alert-message">${alert.message}</div>
        ${alert.detail ? `<div class="alert-detail">${alert.detail}</div>` : ''}
      </div>
      <span class="alert-number">${alert.number}</span>
    </div>
  `).join('');
}

function handleGeneratePredictions() {
  const btn = document.getElementById('generatePredictions');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Génération...';
  
  setTimeout(() => {
    updatePredictions();
    btn.disabled = false;
    btn.innerHTML = '<span>🎲</span> Générer Nouvelles Prédictions';
  }, 500);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);


// =====================================================
// INTERACTIVE EVALUATOR
// =====================================================

async function handleEvaluate() {
  // Get values from inputs
  const inputs = Array.from(document.querySelectorAll('.eval-input'));
  let numbers = [];
  
  // Validation détaillée
  const rawValues = inputs.map(input => input.value.trim());
  
  // 1. Vérifier si tous les champs sont remplis
  if (rawValues.some(v => v === '')) {
    alert('Veuillez remplir tous les 5 champs.');
    return;
  }
  
  // 2. Convertir et vérifier les limites (1-90)
  numbers = rawValues.map(v => parseInt(v));
  const invalidNum = numbers.find(n => isNaN(n) || n < 1 || n > 90);
  if (invalidNum !== undefined) {
    alert(`Le numéro "${invalidNum}" n'est pas valide. Entrez des numéros entre 1 et 90.`);
    return;
  }
  
  // 3. Vérifier les doublons
  if (new Set(numbers).size !== 5) {
    alert('Vous avez entré des numéros en double. Veuillez entrer 5 numéros distincts.');
    return;
  }
  
  const resultDiv = document.getElementById('evaluationResult');
  const btn = document.getElementById('evaluateBtn');
  const originalBtnContent = btn.innerHTML;
  
  // UI State: Loading
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Analyse...';
  resultDiv.style.display = 'none';
  
  try {
    const drawTypeId = document.getElementById('drawTypeSelect').value;
    
    // Call API
    const response = await fetch('/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        numbers: numbers,
        drawTypeId: drawTypeId === 'all' ? null : drawTypeId,
        dayOfWeek: new Date().getDay() // Consistency with AI Prediction context
      })
    });
    
    const result = await response.json();
    
    if (result.error) throw new Error(result.error);
    
    // Construct Result HTML
    const verdictClass = `verdict-${result.recommendation.toLowerCase()}`;
    const matchClass = result.matches > 3 ? '#22c55e' : result.matches > 1 ? '#3b82f6' : '#ef4444';
    
    // Tactical Analysis
    const top15 = result.topCandidates || [];
    const tacticalMatches = numbers.filter(n => {
        const detail = result.numbers.find(d => d.number === n);
        const isGood = detail && detail.isWarm; // Already a good pick
        
        return !isGood && top15.some(cand => Math.abs(cand - n) <= 1); // Is a neighbor of a top candidate
    });

    const html = `
      <div class="result-header">
        <div>
          <div class="detail-label">SCORE IA</div>
          <div class="result-score" style="color: ${result.confidence > 70 ? '#22c55e' : result.confidence > 50 ? '#3b82f6' : '#ef4444'}">
            ${result.confidence}/100
          </div>
        </div>
        <div class="result-verdict ${verdictClass}">
          ${result.recommendation}
        </div>
      </div>
      
      <div class="result-details">
        <div class="detail-item">
          <div class="detail-value">${result.strongMatches}</div>
          <div class="detail-label">⭐ Stars</div>
        </div>
        <div class="detail-item">
          <div class="detail-value" style="color: ${matchClass}">${result.matches}/5</div>
          <div class="detail-label">Correspondance</div>
        </div>
        
        <!-- Tactical Zone (New) -->
        <div class="detail-item" style="border: 1px dashed #fb923c; background: rgba(251, 146, 60, 0.1);">
          <div class="detail-value" style="color: #fb923c;">${tacticalMatches.length}</div>
          <div class="detail-label">Zone Tactique (±1)</div>
        </div>

        <div class="detail-item">
          <div class="detail-value">${result.analysis.sum}</div>
          <div class="detail-label">Somme</div>
        </div>
        
        ${tacticalMatches.length > 0 ? `
        <div class="detail-item" style="grid-column: 1 / -1; margin-top: 10px;">
           <div class="detail-label" style="color:#fb923c; margin-bottom:5px;">🎯 Couverture Voisins (Near Miss Potential)</div>
           <div style="display:flex; gap:8px; justify-content:center;">
             ${tacticalMatches.map(n => `<span class="badge" style="background:rgba(251,146,60,0.2); color:#fb923c;">${n}</span>`).join('')}
           </div>
        </div>
        ` : ''}
        
        ${result.analysis.strongPairs && result.analysis.strongPairs.length > 0 ? `
        <div class="detail-item" style="grid-column: 1 / -1; margin-top: var(--space-md);">
          <div class="detail-label" style="margin-bottom: var(--space-sm);">Paires Fortes (Synergie)</div>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            ${result.analysis.strongPairs.map(p => 
              `<span style="background: rgba(168, 85, 247, 0.2); color: #d8b4fe; padding: 4px 12px; border-radius: 99px; font-size: 0.8rem; border: 1px solid rgba(168, 85, 247, 0.3);">🔗 ${p}</span>`
            ).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
    
    resultDiv.innerHTML = html;
    resultDiv.style.display = 'block';
    
  } catch (error) {
    console.error('Evaluation error:', error);
    resultDiv.innerHTML = `<p style="color: #ef4444; text-align: center;">Erreur: ${error.message}</p>`;
    resultDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnContent;
  }
}
// =====================================================
// BRAIN AI FUNCTIONS
// =====================================================

async function initBrainFeatures() {
  const btn = document.getElementById('showBrain');
  const modal = document.getElementById('brainModal');
  const close = document.querySelector('.close-modal');
  const toggle = document.getElementById('notifyToggle');
  
  if (btn && modal) {
    btn.addEventListener('click', () => {
      modal.style.display = 'block';
      loadBrainStatus();
    });
    
    close.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    window.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }
  
  // Notification Toggle
  if (toggle) {
    // Load saved preference
    const saved = localStorage.getItem('notify_predictions');
    toggle.checked = saved === 'true';
    
    toggle.addEventListener('change', async (e) => {
      const checked = e.target.checked;
      localStorage.setItem('notify_predictions', checked);
      
      if (checked) {
        // Request permission
        if ('Notification' in window) {
           const permission = await Notification.requestPermission();
           if (permission !== 'granted') {
             alert('Vous devez autoriser les notifications dans votre navigateur.');
             e.target.checked = false;
           } else {
             new Notification('Lotto Patterns', { body: 'Notifications activées ! 🚀' });
           }
        }
      }
    });
  }
}

async function loadBrainStatus() {
  const container = document.getElementById('brainWeights');
  if (!container) return;
  
  try {
    const res = await fetch('/api/brain');
    const brain = await res.json();
    
    // 0. Update Global Stats
    if (brain.stats) {
       const acc = brain.stats.globalAccuracy || 0;
       const hits = brain.stats.totalHits || 0;
       const total = brain.stats.totalDraws || 0;
       
       const accuracyEl = document.getElementById('brainAccuracy');
       const hitsEl = document.getElementById('brainHits');
       const totalEl = document.getElementById('brainTotal');
       
       if (accuracyEl) accuracyEl.textContent = acc > 0 ? acc.toFixed(1) + '%' : '0%';
       if (hitsEl) hitsEl.textContent = hits;
       if (totalEl) totalEl.textContent = total;
       
       // 0.5 Update Type Stats
       const typeStatsContainer = document.getElementById('brainTypeStats');
       if (typeStatsContainer && brain.stats.byType) {
           typeStatsContainer.innerHTML = '';
           const types = Object.entries(brain.stats.byType);
           
           if (types.length === 0) {
               typeStatsContainer.innerHTML = '<div class="type-stat-card empty" style="grid-column: 1/-1; text-align: center; padding: 20px; color: #a0aec0;">En attente de données par jeu...<br><small>Lancez une analyse ou attendez le prochain tirage</small></div>';
           } else {
               // Sort by accuracy desc, then totalHits desc, then totalDraws desc
               types.sort((a,b) => {
                   if (b[1].accuracy !== a[1].accuracy) return b[1].accuracy - a[1].accuracy;
                   if (b[1].totalHits !== a[1].totalHits) return b[1].totalHits - a[1].totalHits;
                   return b[1].totalDraws - a[1].totalDraws;
               });
               
               types.forEach(([typeId, stats]) => {
                   // Lookup name from local drawTypes variable
                   let name = typeId;
                   if (typeof drawTypes !== 'undefined') {
                       const found = drawTypes.find(t => t.id == typeId);
                       if (found) name = found.name;
                   }
                   
                   const card = document.createElement('div');
                   card.className = 'type-stat-card';
                   card.innerHTML = `
                       <div class="type-header">
                           <span class="type-name">${name}</span>
                           <span class="type-accuracy">${stats.accuracy ? stats.accuracy.toFixed(1) : 0}%</span>
                       </div>
                       <div class="type-details">
                           <span>✨ ${stats.totalHits} hits</span>
                           <span>📚 ${stats.totalDraws} tirages</span>
                       </div>
                   `;
                   typeStatsContainer.appendChild(card);
               });
           }
       }
    }

    // 0.6 Update Real Performance Stats
    const realStats = brain.realPerformance;
    if (realStats) {
       const realAccEl = document.getElementById('realAccuracy');
       const realHitsEl = document.getElementById('realHits');
       const historyList = document.getElementById('realHistoryList');

       if (realAccEl) realAccEl.textContent = realStats.globalAccuracy.toFixed(1) + '%';
       if (realHitsEl) realHitsEl.textContent = realStats.totalHits;

       if (historyList && realStats.recentHistory) {
           historyList.innerHTML = '';
           if (realStats.recentHistory.length === 0) {
               historyList.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">Aucune donnée vérifiée</div>';
           } else {
               realStats.recentHistory.forEach(h => {
                   const date = new Date(h.date).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
                   
                   // Draw Type Name
                   let typeName = h.typeId;
                   if (typeof drawTypes !== 'undefined') {
                       const t = drawTypes.find(dt => dt.id == h.typeId);
                       if (t) typeName = t.name;
                   }

                   const isHit = h.matchCount > 0;
                   const icon = isHit ? '✨' : '';
                   const matchesStr = h.matches.join(', ');
                   
                   const row = document.createElement('div');
                   row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9em; background: rgba(255,255,255,0.02); margin-bottom: 4px; border-radius: 6px;';
                   
                   row.innerHTML = `
                       <div style="flex: 1;">
                           <div style="font-weight: 600; color: #e2e8f0; margin-bottom: 2px;">${typeName}</div>
                           <div style="font-size: 0.85em; color: #718096;">${date}</div>
                       </div>
                       <div style="text-align: right;">
                           <div style="color: ${isHit ? '#48bb78' : '#cbd5e0'}; font-weight: bold; font-size: 1.1em;">
                               ${h.matchCount}/5 ${icon}
                           </div>
                           ${isHit ? `<div style="font-size: 0.8em; color: #48bb78; margin-top: 2px;">${matchesStr}</div>` : ''}
                       </div>
                   `;
                   historyList.appendChild(row);
               });
           }
       }
    }

    // 1. Update Weights
    container.innerHTML = '';
    
    const strategyNames = {
      hot: 'Numéros Chauds 🔥',
      due: 'Numéros Dus ⏰',
      correlation: 'Corrélations 🔗',
      position: 'Position 📍',
      balanced: 'Équilibre ⚖️'
    };
    
    // Sort by weight desc
    const sortedWeights = Object.entries(brain.weights).sort((a,b) => b[1] - a[1]);
    
    sortedWeights.forEach(([key, value]) => {
      const percentage = Math.round(value * 100);
      const name = strategyNames[key] || key;
      
      const item = document.createElement('div');
      item.className = 'weight-item';
      item.innerHTML = `
        <div class="weight-label">${name}</div>
        <div class="weight-track">
          <div class="weight-fill" style="width: ${percentage}%"></div>
        </div>
        <div class="weight-value">${percentage}%</div>
      `;
      container.appendChild(item);
    });
    
    // 2. Update Logs
    const logContainer = document.getElementById('brainLog');
    if (logContainer && brain.history) {
      logContainer.innerHTML = '';
      
      if (brain.history.length === 0) {
         logContainer.innerHTML = '<div class="log-entry">Aucun historique d\'apprentissage disponible.</div>';
      } else {
        // Recent first
        [...brain.history].reverse().forEach(entry => {
          const date = new Date(entry.date).toLocaleString('fr-FR');
          
          // Format scores nicely
          const scoreParts = [];
          for (const [strat, score] of Object.entries(entry.scores)) {
             if (score > 0) scoreParts.push(`${strat}: ${score} ✅`);
          }
          
          const scoreText = scoreParts.length > 0 ? scoreParts.join(', ') : 'Aucun match';
          
          const div = document.createElement('div');
          div.className = 'log-entry';
          div.innerHTML = `
            <div style="margin-bottom:4px"><span class="log-date">[${date}]</span> Analyse du dernier tirage</div>
            <div style="padding-left:140px; font-size:0.9em; color:#a0aec0;">Performance: ${scoreText}</div>
          `;
          logContainer.appendChild(div);
        });
      }
    }
    
  } catch (e) {
    console.error('Error loading brain status:', e);
    container.innerHTML = '<div class="error">Impossible de charger le cerveau</div>';
  }
}
