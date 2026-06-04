document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const navLinks = document.querySelectorAll('.nav-links li');
    const sections = document.querySelectorAll('.dashboard-section');
    const citySelect = document.getElementById('city-select');
    const yearInput = document.getElementById('year-input');
    const refreshBtn = document.getElementById('refresh-btn');
    
    // Global State
    let currentCity = '';
    let currentYear = new Date().getFullYear();

    // 1. Initialize Application
    async function init() {
        await loadCities();
        await loadMetrics();
        
        // Show first section
        switchSection('dashboard');
        
        // Load initial data for all sections
        fetchData();
        
        // Event Listeners
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                navLinks.forEach(l => l.classList.remove('active'));
                e.target.classList.add('active');
                switchSection(e.target.dataset.target);
            });
        });
        
        refreshBtn.addEventListener('click', () => {
            currentCity = citySelect.value;
            currentYear = parseInt(yearInput.value);
            fetchData();
        });
    }
    
    function switchSection(target) {
        sections.forEach(sec => sec.classList.add('hidden'));
        
        if (target === 'dashboard') {
            document.getElementById('weather-section').classList.remove('hidden');
            document.getElementById('climate-section').classList.remove('hidden');
            document.getElementById('aqi-section').classList.remove('hidden');
        } else {
            const el = document.getElementById(`${target}-section`);
            if(el) el.classList.remove('hidden');
        }
    }

    // 2. Fetch Base Data
    async function loadCities() {
        try {
            const res = await fetch('/api/cities');
            const cities = await res.json();
            
            Object.keys(cities).forEach((city, index) => {
                const option = document.createElement('option');
                option.value = city;
                option.textContent = city;
                citySelect.appendChild(option);
            });
            
            if(Object.keys(cities).length > 0) {
                currentCity = Object.keys(cities)[0];
            }
        } catch (error) {
            console.error('Error loading cities:', error);
        }
    }

    async function loadMetrics() {
        try {
            const res = await fetch('/api/eda/metrics');
            if(res.ok) {
                const metrics = await res.json();
                const container = document.getElementById('metrics-container');
                if(metrics.daily_model) {
                    container.innerHTML = `
                        <p><strong>MAE:</strong> ${metrics.daily_model.mae} °C</p>
                        <p><strong>Baseline MAE:</strong> ${metrics.daily_model.baseline_mae || 'N/A'} °C</p>
                        <p><strong>R² Score:</strong> ${metrics.daily_model.r2_score}</p>
                        <p><strong>Samples:</strong> ${metrics.dataset.total_samples}</p>
                    `;
                }
            }
        } catch (error) {
            console.error('Error loading metrics', error);
        }
    }

    // 3. Update Dashboard Views
    function fetchData() {
        const cityDisplays = document.querySelectorAll('.city-name-display');
        cityDisplays.forEach(el => el.textContent = currentCity);
        
        const yearDisplays = document.querySelectorAll('.year-display');
        yearDisplays.forEach(el => el.textContent = currentYear);

        updateWeather(currentCity);
        updateClimate(currentYear);
        updateAQI(currentCity);
    }

    // Helpers
    function getTempColor(temp) {
        if (temp >= 35) return "#FF3D00";
        if (temp >= 25) return "#FFEA00";
        if (temp >= 15) return "#00E676";
        return "#00C9FF";
    }

    // --- Weather ---
    async function updateWeather(city) {
        try {
            const res = await fetch(`/api/weather/${city}`);
            if(!res.ok) throw new Error("API Error");
            const data = await res.json();

            if (data.ml_prediction.heatwave_alert) {
                document.getElementById('heatwave-alert').classList.remove('hidden');
            } else {
                document.getElementById('heatwave-alert').classList.add('hidden');
            }

            const mlHighEl = document.getElementById('ml-high');
            const mlLowEl = document.getElementById('ml-low');
            mlHighEl.innerHTML = `${data.ml_prediction.temp_max}°C <span style="font-size:0.4em;color:gray;">±${data.ml_prediction.std_max}</span>`;
            mlHighEl.style.color = getTempColor(data.ml_prediction.temp_max);
            mlLowEl.innerHTML = `${data.ml_prediction.temp_min}°C <span style="font-size:0.4em;color:gray;">±${data.ml_prediction.std_min}</span>`;
            mlLowEl.style.color = getTempColor(data.ml_prediction.temp_min);

            const apiHighEl = document.getElementById('api-high');
            apiHighEl.textContent = `${data.api_forecast.temp_max}°C`;
            apiHighEl.style.color = getTempColor(data.api_forecast.temp_max);
            document.getElementById('api-cond').textContent = data.api_forecast.condition;

            // Trend Chart
            const trendDates = data.trend.map(t => t.time);
            const trendTemps = data.trend.map(t => t.temperature);

            const trace = {
                x: trendDates,
                y: trendTemps,
                type: 'scatter',
                mode: 'lines',
                line: { shape: 'spline', color: '#6366F1', width: 3 },
                fill: 'tozeroy',
                fillcolor: 'rgba(99, 102, 241, 0.1)'
            };

            const layout = {
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { l: 40, r: 20, t: 20, b: 40 },
                font: { color: '#475569' },
                xaxis: { showgrid: false },
                yaxis: { gridcolor: 'rgba(0,0,0,0.1)' }
            };

            Plotly.newPlot('weather-trend-chart', [trace], layout, {responsive: true});

        } catch(e) {
            console.error(e);
        }
    }

    // --- Climate ---
    async function updateClimate(year) {
        try {
            const res = await fetch(`/api/rainfall/${year}`);
            if(!res.ok) throw new Error("API Error");
            const data = await res.json();

            document.getElementById('total-rainfall').textContent = `${data.total_expected} mm`;
            document.getElementById('wettest-month').textContent = data.wettest_month.name;
            document.getElementById('wettest-amount').textContent = `${data.wettest_month.amount} mm`;

            const trace = {
                x: data.months,
                y: data.monthly_rainfall,
                type: 'bar',
                marker: { color: data.monthly_rainfall, colorscale: 'Blues' }
            };

            const layout = {
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { l: 40, r: 20, t: 20, b: 40 },
                font: { color: '#475569' },
                xaxis: { showgrid: false },
                yaxis: { gridcolor: 'rgba(0,0,0,0.1)' }
            };

            Plotly.newPlot('rainfall-bar-chart', [trace], layout, {responsive: true});

        } catch(e) {
            console.error(e);
        }
    }

    // --- AQI ---
    async function updateAQI(city) {
        try {
            const res = await fetch(`/api/aqi/${city}`);
            if(!res.ok) throw new Error("API Error");
            const data = await res.json();

            const aqiInfo = {
                1: { label: "Excellent", color: "rgba(0, 230, 118, 0.6)", text: "#00E676" },
                2: { label: "Fair", color: "rgba(255, 234, 0, 0.6)", text: "#FFEA00" },
                3: { label: "Moderate", color: "rgba(255, 145, 0, 0.6)", text: "#FF9100" },
                4: { label: "Poor", color: "rgba(255, 61, 0, 0.6)", text: "#FF3D00" },
                5: { label: "Hazardous", color: "rgba(213, 0, 0, 0.6)", text: "#D50000" }
            };
            const info = aqiInfo[data.aqi] || { label: "Unknown", color: "rgba(128,128,128,0.5)", text: "#FFF" };

            const statusEl = document.getElementById('aqi-status');
            statusEl.innerHTML = `Status: <span style="color:${info.text}">${info.label}</span>`;

            const categories = Object.keys(data.components);
            const values = Object.values(data.components);

            const trace = {
                type: 'scatterpolar',
                r: values,
                theta: categories,
                fill: 'toself',
                fillcolor: info.color,
                line: { color: info.text }
            };

            const layout = {
                polar: {
                    radialaxis: { visible: true, color: 'rgba(0,0,0,0.3)', gridcolor: 'rgba(0,0,0,0.1)' },
                    angularaxis: { color: '#475569' },
                    bgcolor: 'transparent'
                },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { l: 40, r: 40, t: 40, b: 40 }
            };

            Plotly.newPlot('aqi-radar-chart', [trace], layout, {responsive: true});

        } catch(e) {
            console.error(e);
        }
    }

    init();
});
