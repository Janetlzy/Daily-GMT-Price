// Configuration
const STORAGE_KEY = 'gmt_usdc_price_data';
const SYMBOL = 'GMTUSDC';
const START_DATE = '2026-01-01';
const BINANCE_API = 'https://api.binance.com/api/v3';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeApp();
});

// Theme management
function initializeTheme() {
    // Check for saved theme preference or default to system preference
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme) {
        applyTheme(savedTheme === 'dark');
    } else {
        applyTheme(prefersDark);
    }
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches);
        }
    });
}

function toggleTheme() {
    const isDark = document.body.classList.contains('dark-mode');
    const newTheme = !isDark;
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
}

function applyTheme(isDark) {
    if (isDark) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

async function initializeApp() {
    updateStatus('Initializing...');
    
    // Load existing data
    const existingData = loadStoredData();
    
    // Check if we need to fetch new data
    const today = new Date().toISOString().split('T')[0];
    const lastStoredDate = existingData.length > 0 
        ? existingData[existingData.length - 1].date 
        : null;
    
    // Check if we need to fetch today's data or historical data
    const needsFetch = !lastStoredDate || lastStoredDate < today;
    
    if (needsFetch) {
        await fetchAndStoreData(existingData);
    } else {
        displayData(existingData);
        updateStatus('Data loaded from storage');
    }
    
    // Set up daily fetch at UTC 00:00
    scheduleDailyFetch();
    
    // Update display info
    updateDisplayInfo();
}

async function fetchAndStoreData(existingData = []) {
    updateStatus('Fetching data from Binance...');
    
    try {
        const today = new Date();
        const startDate = new Date(START_DATE);
        
        // Create a map of existing dates for quick lookup
        const existingDates = new Set(existingData.map(d => d.date));
        
        // Fetch historical klines data
        const newData = await fetchHistoricalData(startDate, today, existingDates);
        
        // Merge with existing data
        const allData = [...existingData, ...newData];
        
        // Sort by date
        allData.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Remove duplicates
        const uniqueData = removeDuplicates(allData);
        
        // Store in localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(uniqueData));
        
        // Display the data
        displayData(uniqueData);
        updateStatus('Data fetched and stored successfully');
        updateDisplayInfo();
        
    } catch (error) {
        console.error('Error fetching data:', error);
        showError(`Error fetching data: ${error.message}`);
        updateStatus('Error fetching data');
        
        // Display existing data if available
        if (existingData.length > 0) {
            displayData(existingData);
        }
    }
}

async function fetchHistoricalData(startDate, endDate, existingDates) {
    const newData = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Calculate total days
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    // Fetch in batches to avoid rate limits (Binance allows up to 1000 klines per request)
    const batchSize = 1000;
    let currentStart = new Date(start);
    
    while (currentStart <= end) {
        const batchEnd = new Date(currentStart);
        batchEnd.setDate(batchEnd.getDate() + batchSize - 1);
        if (batchEnd > end) batchEnd.setTime(end.getTime());
        
        try {
            // Get timestamps for the batch
            const startTime = new Date(Date.UTC(
                currentStart.getUTCFullYear(),
                currentStart.getUTCMonth(),
                currentStart.getUTCDate(),
                0, 0, 0, 0
            )).getTime();
            
            const endTime = new Date(Date.UTC(
                batchEnd.getUTCFullYear(),
                batchEnd.getUTCMonth(),
                batchEnd.getUTCDate(),
                23, 59, 59, 999
            )).getTime();
            
            // Fetch klines for this batch
            const klines = await fetchKlines(startTime, endTime);
            
            if (klines && klines.length > 0) {
                klines.forEach(candle => {
                    // Candle format: [openTime, open, high, low, close, volume, ...]
                    const openTime = parseInt(candle[0]);
                    const openPrice = parseFloat(candle[1]);
                    
                    // Convert timestamp to date string (YYYY-MM-DD)
                    const date = new Date(openTime);
                    const dateStr = date.toISOString().split('T')[0];
                    
                    // Only add if we don't already have this date
                    if (!existingDates.has(dateStr) && dateStr >= START_DATE) {
                        newData.push({
                            date: dateStr,
                            price: openPrice.toFixed(6)
                        });
                        existingDates.add(dateStr); // Mark as added
                    }
                });
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.error(`Error fetching batch from ${currentStart.toISOString().split('T')[0]}:`, error);
        }
        
        // Move to next batch
        currentStart.setDate(currentStart.getDate() + batchSize);
    }
    
    return newData;
}

async function fetchKlines(startTime, endTime) {
    // Fetch up to 1000 daily candles
    const url = `${BINANCE_API}/klines?symbol=${SYMBOL}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
}

async function fetchTodayPrice() {
    try {
        const today = new Date();
        const todayStart = new Date(Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate(),
            0, 0, 0, 0
        ));
        const todayEnd = new Date(Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate(),
            23, 59, 59, 999
        ));
        
        // Fetch today's daily candle
        const klines = await fetchKlines(todayStart.getTime(), todayEnd.getTime());
        
        if (klines && klines.length > 0) {
            // Use opening price (at UTC 00:00)
            return parseFloat(klines[0][1]).toFixed(6);
        }
        
        // Fallback to current price if no candle available yet
        const url = `${BINANCE_API}/ticker/price?symbol=${SYMBOL}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return parseFloat(data.price).toFixed(6);
    } catch (error) {
        console.error('Error fetching today price:', error);
        throw error;
    }
}

function loadStoredData() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Error loading stored data:', error);
        return [];
    }
}

function removeDuplicates(data) {
    const seen = new Set();
    return data.filter(item => {
        if (seen.has(item.date)) {
            return false;
        }
        seen.add(item.date);
        return true;
    });
}

function displayData(data) {
    const container = document.getElementById('tableContainer');
    
    if (data.length === 0) {
        container.innerHTML = '<div class="loading">No data available</div>';
        return;
    }
    
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>GMT vs USDC</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    // Display in reverse chronological order (newest first)
    const sortedData = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sortedData.forEach(item => {
        // Ensure price is always 6 digits, even if stored with fewer
        const price = parseFloat(item.price).toFixed(6);
        html += `
            <tr>
                <td>${item.date}</td>
                <td>${price}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

function updateStatus(message) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function updateDisplayInfo() {
    const data = loadStoredData();
    const lastUpdateEl = document.getElementById('lastUpdate');
    const nextFetchEl = document.getElementById('nextFetch');
    
    if (data.length > 0) {
        const lastDate = data[data.length - 1].date;
        if (lastUpdateEl) {
            lastUpdateEl.textContent = lastDate;
        }
    }
    
    // Calculate next fetch time (UTC 00:00 tomorrow)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    
    if (nextFetchEl) {
        nextFetchEl.textContent = tomorrow.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
}

function showError(message) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.innerHTML = `<div class="error">${message}</div>`;
    
    // Remove error after 5 seconds
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 5000);
}

function scheduleDailyFetch() {
    // Calculate time until next UTC 00:00
    const now = new Date();
    const nextFetch = new Date(now);
    nextFetch.setUTCDate(nextFetch.getUTCDate() + 1);
    nextFetch.setUTCHours(0, 0, 0, 0);
    
    const msUntilNext = nextFetch.getTime() - now.getTime();
    
    // Schedule the fetch
    setTimeout(async () => {
        await fetchAndStoreData(loadStoredData());
        
        // Schedule next fetch (24 hours later)
        setInterval(async () => {
            await fetchAndStoreData(loadStoredData());
        }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntilNext);
    
    console.log(`Next fetch scheduled for: ${nextFetch.toISOString()}`);
}

async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    
    try {
        await fetchAndStoreData(loadStoredData());
    } catch (error) {
        showError(`Error refreshing: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh Now';
    }
}
