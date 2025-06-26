// Training Centres Application - Fixed DuckDB Integration
// This version resolves the apache-arrow module loading issues

class TrainingCentresApp {
    constructor() {
        this.map = null;
        this.duckdb = null;
        this.conn = null;
        this.useDuckDB = false;
        this.trainingCentres = [];
        this.gridData = [];
        this.boundaryData = null;
        this.layers = {
            boundaries: null,
            centres: null,
            grid: null
        };
        this.filters = {
            subjects: [],
            aimLevels: [],
            population: { min: 0, max: 10000 },
            imdScore: { min: 0, max: 100 }
        };
        
        this.init();
    }

    async init() {
        this.updateLoadingMessage('Initializing application...');
        
        try {
            // Try to initialize DuckDB with proper error handling
            await this.initializeDuckDB();
            
            // Initialize the map
            this.initializeMap();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Load initial data
            await this.loadInitialData();
            
            // Hide loading screen and show app
            this.hideLoadingScreen();
            
            console.log('Application initialized successfully');
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showError('Failed to initialize application. Please refresh the page.');
        }
    }

    async initializeDuckDB() {
        this.updateLoadingMessage('Loading DuckDB for high-performance data processing...');
        
        try {
            // Use dynamic import with proper error handling
            const duckdbModule = await this.loadDuckDBWithFallback();
            
            if (duckdbModule) {
                const { AsyncDuckDB } = duckdbModule;
                
                // Create DuckDB instance
                this.duckdb = new AsyncDuckDB();
                await this.duckdb.instantiate();
                this.conn = await this.duckdb.connect();
                this.useDuckDB = true;
                
                console.log('✅ DuckDB initialized successfully');
                this.updateLoadingMessage('DuckDB ready for high-performance queries...');
            } else {
                throw new Error('DuckDB module failed to load');
            }
        } catch (error) {
            console.warn('⚠️ DuckDB initialization failed, using JavaScript fallback:', error.message);
            this.useDuckDB = false;
            this.updateLoadingMessage('Using JavaScript fallback for data processing...');
        }
    }

    async loadDuckDBWithFallback() {
        const attempts = [
            // Try with import maps first (modern approach)
            () => import('@duckdb/duckdb-wasm'),
            
            // Fallback to direct CDN import with explicit apache-arrow
            async () => {
                // Load apache-arrow first
                const arrow = await import('https://cdn.jsdelivr.net/npm/apache-arrow@latest/es2015/apache-arrow.js');
                window.arrow = arrow;
                
                // Then load DuckDB
                return await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser.mjs');
            },
            
            // Alternative CDN
            async () => {
                const arrow = await import('https://unpkg.com/apache-arrow@latest/es2015/apache-arrow.js');
                window.arrow = arrow;
                return await import('https://unpkg.com/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser.mjs');
            }
        ];

        for (let i = 0; i < attempts.length; i++) {
            try {
                console.log(`Attempting DuckDB load method ${i + 1}...`);
                const module = await attempts[i]();
                console.log(`✅ DuckDB loaded successfully with method ${i + 1}`);
                return module;
            } catch (error) {
                console.warn(`❌ DuckDB load method ${i + 1} failed:`, error.message);
                if (i === attempts.length - 1) {
                    throw error;
                }
            }
        }
    }

    initializeMap() {
        this.updateLoadingMessage('Setting up interactive map...');
        
        // Initialize Leaflet map
        this.map = L.map('map').setView([51.4545, -2.5879], 10); // Bristol area

        // Add base layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Create layer groups
        this.layers.boundaries = L.layerGroup().addTo(this.map);
        this.layers.centres = L.layerGroup().addTo(this.map);
        this.layers.grid = L.layerGroup().addTo(this.map);

        console.log('Map initialized');
    }

    setupEventListeners() {
        // File upload
        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        document.getElementById('file-input').addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files[0]);
        });

        // Filter controls
        document.getElementById('apply-filters').addEventListener('click', () => {
            this.applyFilters();
        });

        document.getElementById('clear-filters').addEventListener('click', () => {
            this.clearFilters();
        });

        // Slider updates
        document.getElementById('pop-slider').addEventListener('input', (e) => {
            document.getElementById('pop-value').textContent = e.target.value;
        });

        document.getElementById('imd-slider').addEventListener('input', (e) => {
            document.getElementById('imd-value').textContent = e.target.value;
        });
    }

    async loadInitialData() {
        this.updateLoadingMessage('Loading training centres data...');
        
        try {
            // Simulate loading training centres data
            this.trainingCentres = await this.generateSampleTrainingCentres();
            
            // Display training centres on map
            this.displayTrainingCentres();
            
            // Update UI
            this.updateFilterOptions();
            this.updateStatistics();
            
            console.log(`Loaded ${this.trainingCentres.length} training centres`);
        } catch (error) {
            console.error('Failed to load training centres:', error);
            this.showError('Failed to load training centres data');
        }
    }

    async generateSampleTrainingCentres() {
        // Generate sample data for demonstration
        const subjects = ['Engineering', 'Healthcare', 'IT & Digital', 'Construction', 'Business', 'Education'];
        const aimLevels = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'];
        const centres = [];

        for (let i = 0; i < 50; i++) {
            centres.push({
                id: i + 1,
                name: `Training Centre ${i + 1}`,
                lat: 51.4545 + (Math.random() - 0.5) * 0.2,
                lng: -2.5879 + (Math.random() - 0.5) * 0.3,
                subjects: [subjects[Math.floor(Math.random() * subjects.length)]],
                aimLevels: [aimLevels[Math.floor(Math.random() * aimLevels.length)]],
                capacity: Math.floor(Math.random() * 500) + 50,
                address: `Address ${i + 1}, Bristol`,
                contact: `contact${i + 1}@example.com`
            });
        }

        return centres;
    }

    displayTrainingCentres() {
        this.layers.centres.clearLayers();

        this.trainingCentres.forEach(centre => {
            const marker = L.circleMarker([centre.lat, centre.lng], {
                radius: 8,
                fillColor: '#007bff',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.bindPopup(`
                <div>
                    <h4>${centre.name}</h4>
                    <p><strong>Subjects:</strong> ${centre.subjects.join(', ')}</p>
                    <p><strong>Aim Levels:</strong> ${centre.aimLevels.join(', ')}</p>
                    <p><strong>Capacity:</strong> ${centre.capacity}</p>
                    <p><strong>Address:</strong> ${centre.address}</p>
                </div>
            `);

            this.layers.centres.addLayer(marker);
        });
    }

    updateFilterOptions() {
        // Get unique subjects and aim levels
        const subjects = [...new Set(this.trainingCentres.flatMap(c => c.subjects))];
        const aimLevels = [...new Set(this.trainingCentres.flatMap(c => c.aimLevels))];

        // Update subject filter
        const subjectSelect = document.getElementById('subject-filter');
        subjectSelect.innerHTML = '';
        subjects.forEach(subject => {
            const option = document.createElement('option');
            option.value = subject;
            option.textContent = subject;
            subjectSelect.appendChild(option);
        });

        // Update aim level filter
        const aimLevelSelect = document.getElementById('aim-level-filter');
        aimLevelSelect.innerHTML = '';
        aimLevels.forEach(level => {
            const option = document.createElement('option');
            option.value = level;
            option.textContent = level;
            aimLevelSelect.appendChild(option);
        });
    }

    applyFilters() {
        // Get filter values
        const selectedSubjects = Array.from(document.getElementById('subject-filter').selectedOptions)
            .map(option => option.value);
        const selectedAimLevels = Array.from(document.getElementById('aim-level-filter').selectedOptions)
            .map(option => option.value);
        const popThreshold = parseInt(document.getElementById('pop-slider').value);
        const imdThreshold = parseInt(document.getElementById('imd-slider').value);

        // Filter training centres
        this.layers.centres.clearLayers();

        const filteredCentres = this.trainingCentres.filter(centre => {
            const subjectMatch = selectedSubjects.length === 0 || 
                selectedSubjects.some(s => centre.subjects.includes(s));
            const aimLevelMatch = selectedAimLevels.length === 0 || 
                selectedAimLevels.some(l => centre.aimLevels.includes(l));
            const capacityMatch = centre.capacity >= popThreshold;

            return subjectMatch && aimLevelMatch && capacityMatch;
        });

        // Display filtered centres
        filteredCentres.forEach(centre => {
            const marker = L.circleMarker([centre.lat, centre.lng], {
                radius: 8,
                fillColor: '#28a745',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.bindPopup(`
                <div>
                    <h4>${centre.name}</h4>
                    <p><strong>Subjects:</strong> ${centre.subjects.join(', ')}</p>
                    <p><strong>Aim Levels:</strong> ${centre.aimLevels.join(', ')}</p>
                    <p><strong>Capacity:</strong> ${centre.capacity}</p>
                </div>
            `);

            this.layers.centres.addLayer(marker);
        });

        this.updateStatistics(filteredCentres.length);
    }

    clearFilters() {
        document.getElementById('subject-filter').selectedIndex = -1;
        document.getElementById('aim-level-filter').selectedIndex = -1;
        document.getElementById('pop-slider').value = 0;
        document.getElementById('imd-slider').value = 0;
        document.getElementById('pop-value').textContent = '0';
        document.getElementById('imd-value').textContent = '0';

        this.displayTrainingCentres();
        this.updateStatistics();
    }

    updateStatistics(filteredCount = null) {
        document.getElementById('total-centres').textContent = this.trainingCentres.length;
        document.getElementById('filtered-centres').textContent = 
            filteredCount !== null ? filteredCount : this.trainingCentres.length;
        document.getElementById('coverage-area').textContent = 'West of England';
    }

    async handleFileUpload(file) {
        if (!file) return;

        try {
            this.updateLoadingMessage(`Processing ${file.name}...`);
            
            const text = await file.text();
            let data;

            if (file.name.endsWith('.csv')) {
                data = this.parseCSV(text);
            } else if (file.name.endsWith('.json') || file.name.endsWith('.geojson')) {
                data = JSON.parse(text);
            } else {
                throw new Error('Unsupported file format');
            }

            console.log('File uploaded and parsed:', data);
            this.showSuccess(`Successfully loaded ${file.name}`);
            
        } catch (error) {
            console.error('File upload failed:', error);
            this.showError(`Failed to process ${file.name}: ${error.message}`);
        }
    }

    parseCSV(text) {
        const lines = text.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim()) {
                const values = lines[i].split(',').map(v => v.trim());
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index];
                });
                data.push(row);
            }
        }

        return data;
    }

    // Utility methods
    updateLoadingMessage(message) {
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.textContent = message;
        }
        console.log(message);
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        const app = document.getElementById('app');
        
        setTimeout(() => {
            loadingScreen.style.display = 'none';
            app.style.display = 'block';
        }, 500);
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }

    showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.remove();
        }, 3000);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing Training Centres application...');
    window.app = new TrainingCentresApp();
});

// Export for module use
export default TrainingCentresApp;
