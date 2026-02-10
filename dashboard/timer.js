
// Refresh Timer Logic
let timerInterval;

async function updateRefreshTimer() {
  const timerEl = document.getElementById('refreshTimer');
  if (!timerEl) return;
  
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    
    // Support both structures (legacy or new)
    const nextRunVal = data.nextRun || (data.autoRefresh && data.autoRefresh.nextRefresh);
    
    if (nextRunVal) {
      const nextRun = new Date(nextRunVal).getTime();
      
      const update = () => {
        const now = new Date().getTime();
        const diff = nextRun - now;
        
        if (diff <= 0) {
          timerEl.textContent = '⏳ En cours...';
          timerEl.classList.add('soon');
           // Reload page after a short delay to get new data
           if (diff < -5000 && diff > -10000) {
              // Only reload if we haven't just reloaded (simple check)
              if (!sessionStorage.getItem('justReloaded')) {
                  sessionStorage.setItem('justReloaded', 'true');
                  window.location.reload();
              }
           }
        } else {
          sessionStorage.removeItem('justReloaded');
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          
          timerEl.textContent = `⏳ ${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          if (minutes < 5) {
            timerEl.classList.add('soon');
          } else {
            timerEl.classList.remove('soon');
          }
        }
      };
      
      update(); // Immediate
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(update, 1000);
    }
  } catch (e) {
    console.error('Timer error:', e);
    // timerEl.textContent = '⏳ --:--';
  }
}

// Initialize Timer when DOM loads (append to existing listeners)
document.addEventListener('DOMContentLoaded', () => {
    updateRefreshTimer();
});
