const map = L.map('map').setView([51.480, -2.591], 11);

const baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors & CartoDB, © Crown copyright and database rights 2025 OS 0100059651, Contains OS data © Crown copyright [and database right] 2025.'
}).addTo(map);

const ladCodesString = ladCodes.map(code => `'${code}'`).join(',');

let gridStatistics = {
  pop: { min: Infinity, max: -Infinity },
  imd_score_mhclg: { min: Infinity, max: -Infinity },
  hh_caravail_ts045: { min: Infinity, max: -Infinity },
  pop_growth: { min: Infinity, max: -Infinity },
  imd_decile_mhclg: { min: Infinity, max: -Infinity }
};
let gridCentroidsFC = null;
let opacityAmenitiesOrder = 'low-to-high';
let outlineAmenitiesOrder = 'low-to-high';
let isInverseAmenitiesOpacity = false;
let isInverseAmenitiesOutline = false;
let uaBoundariesLayer;
let wardBoundariesLayer;
let ladCodeToNameMap = {};
let wardCodeToNameMap = {};
let AmenitiesCatchmentLayer = null;
let gridTimeMap = {};
let csvDataCache = {};
let fullCsvData = null;
let amenitiesLayerGroup = L.featureGroup();
let selectedAmenitiesAmenities = [];
let selectingFromMap = false;
let selectedAmenitiesFromMap = [];
let grid;
let highlightLayer = null;
let initialLoadComplete = false;
let isUpdatingSliders = false;
let wasAboveZoomThreshold = false;
let gridLayer = null;
let busLinesLayer;
let busStopsLayer;
let roadNetworkLayer;
let WestLinkZonesLayer;
let userLayers = [];
let userLayerCount = 0;
let drawControl;
let currentDrawingLayer = null;
let isDrawingActive = false;
let currentDrawType = null;
drawFeatureGroup = L.featureGroup({
  pane: 'userLayers'
}).addTo(map);
let isCalculatingStats = false;
let isUpdatingVisibility = false;
let isUpdatingFilters = false;
let isUpdatingFilterValues = false;
let currentEditingUserLayer = null;
let activeShapeMode = null; 
let activeActionMode = null;
let originalLayerState = null;
let hasUnsavedChanges = false;
let currentFeatureAttributes = {};
let pendingFeature = null;
let currentUserLayerId = null;
let defaultAttributes = { "Name": "" };
let previousFilterSelections = {
  LA: null,
  Ward: null,
  Range: null,
};
let isUpdatingCatchmentLayer = false;
let lastAmenitiesState = {
  selectingFromMap: false,
  selectedAmenitiesFromMap: [],
  selectedAmenitiesAmenities: []
};
let isUpdatingStyles = false;
let isUpdatingOpacityOutlineFields = false;


function convertMultiPolygonToPolygons(geoJson) {
  // console.log('Converting MultiPolygon to Polygon...');
  return new Promise((resolve) => {
    const features = [];
    const featureCounts = {};
    const totalFeatures = geoJson.features.length;
    let processedCount = 0;
    const batchSize = 50;
    
    function processBatch(startIdx) {
      const endIdx = Math.min(startIdx + batchSize, totalFeatures);
      
      for (let i = startIdx; i < endIdx; i++) {
        const feature = geoJson.features[i];
        const name = feature.properties.LAD24NM || feature.properties.WD24NM || 
                    feature.properties.LSOA21NM || feature.properties.name || 'Unknown';
        featureCounts[name] = (featureCounts[name] || 0) + 1;
        
        if (feature.geometry.type === 'MultiPolygon') {      
          const parts = feature.geometry.coordinates.map((polygonCoords, index) => {
            const area = turf.area(turf.polygon(polygonCoords));
            return { index, area, coords: polygonCoords };
          });
          
          parts.sort((a, b) => b.area - a.area);
                
          if (name === 'North Somerset' || name === 'South Gloucestershire' || 
              (feature.properties.name && feature.properties.name.length > 0)) {
            features.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: parts[0].coords
              },
              properties: feature.properties
            });
          } else {
            feature.geometry.coordinates.forEach(polygonCoords => {
              features.push({
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: polygonCoords
                },
                properties: feature.properties
              });
            });
          }
        } else {
          features.push(feature);
        }
      }
      
      processedCount += (endIdx - startIdx);
      
      const percent = Math.round((processedCount / totalFeatures) * 100);
      
      if (processedCount < totalFeatures) {
        setTimeout(() => requestAnimationFrame(() => processBatch(endIdx)), 0);
      } else {
        const result = {
          type: 'FeatureCollection',
          features: features
        };
        resolve(result);
      }
    }
    
    setTimeout(() => processBatch(0), 0);
  });
}

const layers = {};
const AmenitiesYear = document.getElementById("yearAmenitiesDropdown");
const AmenitiesPurpose = document.querySelectorAll('.checkbox-label input[type="checkbox"]');
const AmenitiesOpacity = document.getElementById("opacityFieldAmenitiesDropdown");
const AmenitiesOutline = document.getElementById("outlineFieldAmenitiesDropdown");
const AmenitiesOpacityRange = document.getElementById('opacityRangeAmenitiesSlider');
const AmenitiesOutlineRange = document.getElementById('outlineRangeAmenitiesSlider');
const AmenitiesInverseOpacity = document.getElementById("inverseOpacityScaleAmenitiesButton");
const AmenitiesInverseOutline = document.getElementById("inverseOutlineScaleAmenitiesButton");
const amenityLayers = {};
const filterTypeDropdown = document.getElementById('filterTypeDropdown');
const filterValueDropdown = document.getElementById('filterValueDropdown');
const debouncedUpdateOpacityOutlineFields = debounce(updateOpacityAndOutlineFields, 1000);

AmenitiesOpacity.value = "None";
AmenitiesOutline.value = "None";

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

AmenitiesYear.addEventListener("change", debounce(() => {
  updateAmenitiesCatchmentLayer();
}, 250));
AmenitiesOpacity.addEventListener("change", () => {
  updateSliderRanges('Amenities', 'Opacity');
  if (!isUpdatingOpacityOutlineFields) {
    debouncedUpdateOpacityOutlineFields();
  }
});
AmenitiesOutline.addEventListener("change", () => {
  updateSliderRanges('Amenities', 'Outline');
  if (!isUpdatingOpacityOutlineFields) {
    debouncedUpdateOpacityOutlineFields();
  }
});
AmenitiesInverseOpacity.addEventListener("click", () => {
  toggleInverseScale('Amenities', 'Opacity');
});
AmenitiesInverseOutline.addEventListener("click", () => {
  toggleInverseScale('Amenities', 'Outline');
});
filterTypeDropdown.addEventListener('change', () => {
  updateFilterValues();
  updateSummaryStatistics(getCurrentFeatures());
  
  const highlightCheckbox = document.getElementById('highlightAreaCheckbox');
  if (filterTypeDropdown.value === 'Range') {
    highlightCheckbox.disabled = true;
    highlightCheckbox.checked = false;
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
  } else {
    highlightCheckbox.disabled = false;
  }
  
  if (document.getElementById('highlightAreaCheckbox').checked) {
    highlightSelectedArea();
  }
});
filterValueDropdown.addEventListener('change', () => {
  updateSummaryStatistics(getCurrentFeatures());
  if (document.getElementById('highlightAreaCheckbox').checked) {
    highlightSelectedArea();
  }
});
document.getElementById('highlightAreaCheckbox').addEventListener('change', function() {
  if (this.checked) {
    highlightSelectedArea();
  } else {
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
  }
});

/**
 * Main application initialization
 * Using a phased loading approach to improve perceived performance
 */
document.addEventListener('DOMContentLoaded', (event) => {
  // console.log('DOM fully loaded, starting application initialization...');
  //showoadingOverlay();
  initializeUI();
  setupMapPanes();
  
  initializeAndConfigureSlider(AmenitiesOpacityRange, isInverseAmenitiesOpacity);
  initializeAndConfigureSlider(AmenitiesOutlineRange, isInverseAmenitiesOutline);
  
  initializeFileUpload();
  setupDrawingTools();
  
  initializeCollapsiblePanels();
  
  loadBaseLayers().then(() => {
    // console.log('Base layers loaded successfully');
    
    map.fire('baselayersloaded');
    initialLoadComplete = true;
    
    loadBackgroundData();
  }).catch(error => {
    console.error('Error loading base layers:', error);
    //hideLoadingOverlay();
    showErrorNotification('Error loading map layers. Please try refreshing the page.');
  });
});

/**
 * Initializes the basic UI components
 * This is the first function called during application initialization
 */
function initializeUI() {
  // console.log('Initializing user interface components...');

  createStaticLegendControls();

  initializeLegendControls();
  
  const dataLayerCategory = document.getElementById('data-layer-category');
  if (dataLayerCategory) {
    dataLayerCategory.style.display = 'none';
  }
  
  setupAdditionalUIListeners();
}

/**
 * Sets up event listeners for UI elements like checkboxes and buttons
 */
function setupAdditionalUIListeners() {
  document.querySelectorAll('.legend-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      if (AmenitiesCatchmentLayer) {
        applyAmenitiesCatchmentLayerStyling();
      }
    });
  });
}

/**
 * Creates and sets up event listeners for static legend controls
 */
function createStaticLegendControls() {
  // console.log('Creating static legend controls...');
  
  const amenitiesCheckbox = document.getElementById('amenitiesCheckbox');
  if (amenitiesCheckbox) {
    amenitiesCheckbox.addEventListener('change', () => {
      if (amenitiesCheckbox.checked) {
        drawSelectedAmenities();
        amenitiesLayerGroup.addTo(map);
      } else {
        map.removeLayer(amenitiesLayerGroup);
      }
    });
  }

  const uaBoundariesCheckbox = document.getElementById('uaBoundariesCheckbox');
  if (uaBoundariesCheckbox) {
    uaBoundariesCheckbox.addEventListener('change', () => {
      if (uaBoundariesLayer) {
        if (uaBoundariesCheckbox.checked) {
          uaBoundariesLayer.setStyle({ opacity: 1 });
        } else {
          uaBoundariesLayer.setStyle({ opacity: 0 });
        }
      }
    });
  }

  const wardBoundariesCheckbox = document.getElementById('wardBoundariesCheckbox');
  if (wardBoundariesCheckbox) {
    wardBoundariesCheckbox.addEventListener('change', () => {
      if (wardBoundariesLayer) {
        if (wardBoundariesCheckbox.checked) {
          wardBoundariesLayer.setStyle({ opacity: 1 });
        } else {
          wardBoundariesLayer.setStyle({ opacity: 0 });
        }
      }
    });
  }
  
  const busStopsCheckbox = document.getElementById('busStopsCheckbox');
  if (busStopsCheckbox) {
    busStopsCheckbox.addEventListener('change', () => {
      if (busStopsLayer) {
        if (busStopsCheckbox.checked) {
          busStopsLayer.eachLayer(layer => {
            layer.setStyle({ 
              opacity: 1, 
              fillOpacity: layer.options._calculatedFillOpacity 
            });
          });
        } else {
          busStopsLayer.eachLayer(layer => {
            layer.setStyle({ opacity: 0, fillOpacity: 0 });
          });
        }
      }
    });
  }
  
  const busLinesCheckbox = document.getElementById('busLinesCheckbox');
  if (busLinesCheckbox) {
    busLinesCheckbox.addEventListener('change', () => {
      if (busLinesLayer) {
        if (busLinesCheckbox.checked) {
          busLinesLayer.eachLayer(layer => {
            layer.setStyle({ opacity: layer.options._calculatedOpacity });
          });
        } else {
          busLinesLayer.setStyle({ opacity: 0 });
        }
      }
    });
  }

  const roadNetworkCheckbox = document.getElementById('roadNetworkCheckbox');
  if (roadNetworkCheckbox) {
    roadNetworkCheckbox.addEventListener('change', () => {
      if (roadNetworkLayer) {
        if (roadNetworkCheckbox.checked) {
          roadNetworkLayer.setStyle({
            opacity: 1,
          });
        } else {
          roadNetworkLayer.setStyle({
            opacity: 0,
          });
        }
      }
    });
  }
}

/**
 * Initializes collapsible legend controls
 */
function initializeLegendControls() {
  // console.log('Initializing legend controls...');
  
  document.querySelectorAll('.legend-category-header').forEach(header => {
    header.addEventListener('click', function() {
      const category = this.closest('.legend-category');
      category.classList.toggle('legend-category-collapsed');
    });
  });
  
  const legendHeader = document.querySelector('.legend-header');
  let isLegendExpanded = true;
  
  if (legendHeader) {
    legendHeader.addEventListener('click', function() {
      isLegendExpanded = !isLegendExpanded;
      
      const legend = document.getElementById('legend');
      legend.classList.toggle('collapsed', !isLegendExpanded);
      
      const legendContent = document.getElementById('legend-content-wrapper');
      if (legendContent) {
        legendContent.style.display = isLegendExpanded ? 'block' : 'none';
      }
    });
  }
}

/**
 * Initializes collapsible panels and their behavior
 */
function initializeCollapsiblePanels() {
  const collapsibleButtons = document.querySelectorAll(".collapsible");
  collapsibleButtons.forEach(button => {
    const content = button.nextElementSibling;
    if (content) {
      content.style.display = "none";
      button.classList.add("collapsed");

      button.addEventListener("click", function() {
        this.classList.toggle("active");
        content.style.display = content.style.display === "block" ? "none" : "block";
        this.classList.toggle("collapsed", content.style.display === "none");
      });
    }
  });

    function handlePanelStateChange(header, isOpen) {
    const dataPanelHeaders = document.querySelectorAll(".panel-header:not(.summary-header)");
    
    if (isOpen) {
      dataPanelHeaders.forEach(otherHeader => {
        if (otherHeader !== header) {
          otherHeader.classList.add("collapsed");
          const otherContent = otherHeader.nextElementSibling;
          if (otherContent) {
            otherContent.style.display = "none";
          }
          
          if (otherHeader.textContent.includes("Journey Time Catchments - Training Centres") && AmenitiesCatchmentLayer) {
            lastAmenitiesState = {
              selectingFromMap,
              selectedAmenitiesFromMap,
              selectedAmenitiesAmenities
            };
            map.removeLayer(AmenitiesCatchmentLayer);
            AmenitiesCatchmentLayer = null;
          } 
        }
      });
    }
    
    if (isOpen && header.textContent.includes("Journey Time Catchments - Training Centres")) {
      if (lastAmenitiesState.selectingFromMap) {
        selectingFromMap = lastAmenitiesState.selectingFromMap;
        selectedAmenitiesFromMap = [...lastAmenitiesState.selectedAmenitiesFromMap];
        
        AmenitiesPurpose.forEach(checkbox => {
          checkbox.checked = lastAmenitiesState.selectedAmenitiesAmenities.includes(checkbox.value);
        });
      }
      
      updateAmenitiesCatchmentLayer();
    } else if (!isOpen && header.textContent.includes("Journey Time Catchments - Training Centres") && AmenitiesCatchmentLayer) {
      lastAmenitiesState = {
        selectingFromMap,
        selectedAmenitiesFromMap,
        selectedAmenitiesAmenities
      };
      map.removeLayer(AmenitiesCatchmentLayer);
      AmenitiesCatchmentLayer = null;
      drawSelectedAmenities([]);
    }
  }

  const panelHeaders = document.querySelectorAll(".panel-header");
  panelHeaders.forEach(header => {
    const content = header.nextElementSibling;
    if (content) {
      content.style.display = "none";
      header.classList.add("collapsed");

      header.addEventListener("click", function() {
        const isCurrentlyOpen = !this.classList.contains('collapsed');
        const willOpen = !isCurrentlyOpen;
        
        this.classList.toggle("collapsed");
        content.style.display = willOpen ? "block" : "none";
        
        if (!this.classList.contains('summary-header')) {
          handlePanelStateChange(this, willOpen);
        }
      });
    }
  });
  
  const summaryHeader = document.getElementById('toggle-summary-panel');
  const summaryContent = document.getElementById('summary-content');
  
  if (summaryHeader && summaryContent) {
    summaryContent.style.display = "none";
    summaryHeader.classList.add("collapsed");
    
    summaryHeader.addEventListener("click", function() {
      const isCollapsed = this.classList.contains("collapsed");
      this.classList.toggle("collapsed");
      summaryContent.style.display = isCollapsed ? "block" : "none";
    });
    
    summaryHeader.addEventListener("click", function() {
      this.classList.toggle("collapsed");
      const isNowCollapsed = this.classList.contains("collapsed");
      summaryContent.style.display = isNowCollapsed ? "none" : "block";
    });
  }
}

/**
 * Creates and sets up map panes with appropriate z-index values
 */
function setupMapPanes() {
  // console.log('Setting up map panes...');
  const existingPanes = document.querySelectorAll('.leaflet-pane[style*="z-index"]');
  existingPanes.forEach(pane => {
    if (pane.className.includes('custom-pane')) {
      pane.parentNode.removeChild(pane);
    }
  });
  
  map.createPane('polygonLayers').style.zIndex = 300;
  map.createPane('boundaryLayers').style.zIndex = 400;
  map.createPane('roadLayers').style.zIndex = 500;
  map.createPane('busLayers').style.zIndex = 600;
  map.createPane('userLayers').style.zIndex = 700;
}

/**
 * Loads base map layers (boundaries, transport infrastructure)
 * @returns {Promise} A promise that resolves when all base layers are loaded
 */
function loadBaseLayers() {
  // console.log('Loading base map layers...');
  showBackgroundLoadingIndicator('Loading map layers...');
  
  return Promise.all([
    loadBoundaryData(),
    loadTransportInfrastructure()
  ]).then(() => {
    hideBackgroundLoadingIndicator();
  });
}

/**
 * Loads boundary data (Local Authorities, Wards)
 * @returns {Promise} A promise that resolves when boundary data is loaded
 */
function loadBoundaryData() {
  // console.log('Loading boundary data...');
  const ladCodesString = ladCodes.map(code => `'${code}'`).join(',');
  
  return Promise.all([
    fetch(`https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_December_2024_Boundaries_UK_BGC/FeatureServer/0/query?outFields=*&where=LAD24CD%20IN%20(${ladCodesString})&f=geojson`)
      .then(response => response.json())
      .then(data => {
        return convertMultiPolygonToPolygons(data).then(convertedData => {
          convertedData.features.forEach(feature => {
            const code = feature.properties.LAD24CD;
            const name = feature.properties.LAD24NM;
            if (code && name) {
              ladCodeToNameMap[code] = name;
            }
          });
          // console.log('LAD lookup map populated:', ladCodeToNameMap);
          
          uaBoundariesLayer = L.geoJSON(convertedData, {
            pane: 'boundaryLayers',
            style: function (feature) {
              return {
                color: 'black',
                weight: 1.5,
                fillOpacity: 0,
                opacity: 0
              };
            },
          }).addTo(map);
        });
      }),
    
    fetch('https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Wards_December_2024_Boundaries_UK_BGC/FeatureServer/0/query?outFields=*&where=1%3D1&geometry=-3.073689%2C51.291726%2C-2.327195%2C51.656841&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson')
      .then(response => response.json())
      .then(data => {
        return convertMultiPolygonToPolygons(data)
          .then(convertedData => {
            const filteredFeatures = convertedData.features.filter(feature => ladCodes.includes(feature.properties.LAD24CD));
            
            filteredFeatures.forEach(feature => {
              const code = feature.properties.WD24CD;
              const name = feature.properties.WD24NM;
              
              if (code && name) {
                wardCodeToNameMap[code] = name;
              }
            });
            // console.log('Ward lookup map populated:', wardCodeToNameMap);
            // console.log('Ward lookup map size:', Object.keys(wardCodeToNameMap).length);
            
            const wardGeoJson = {
              type: 'FeatureCollection',
              features: filteredFeatures
            };

            wardBoundariesLayer = L.geoJSON(wardGeoJson, {
              pane: 'boundaryLayers',
              style: function () {
                return {
                  color: 'black',
                  weight: 1,
                  fillOpacity: 0,
                  opacity: 0
                };
              },
            }).addTo(map);
            // console.log("Ward boundaries layer added to map.");
          });
      })
  ]).catch(error => {
    console.error("Error loading boundary data:", error);
  });
}

/**
 * Loads transport infrastructure (bus lines, stops, road network)
 * @returns {Promise} A promise that resolves when transport infrastructure is loaded
 */
function loadTransportInfrastructure() {
  // console.log('Loading transport infrastructure...');
  
  return Promise.all([
    fetch('https://AmFa6.github.io/TAF_test/lines.geojson')
      .then(response => response.json())
      .then(data => {
        busLinesLayer = L.geoJSON(data, {
          pane: 'busLayers',
          style: function (feature) {
            const frequency = parseFloat(feature.properties.am_peak_service_frequency) || 0;
            const opacity = frequency === 0 ? 0.1 : Math.min(0.1 + (frequency / 6) * 0.4, 0.5);
            
            return {
              color: 'green',
              weight: 2,
              fillOpacity: 0,
              opacity: 0,
              _calculatedOpacity: opacity
            };
          },
        }).addTo(map);
      }),
    
    fetch('https://AmFa6.github.io/TAF_test/stops.geojson')
      .then(response => response.json())
      .then(data => {
        busStopsLayer = L.geoJSON(data, {
          pane: 'busLayers',
          pointToLayer: function(feature, latlng) {
            const frequency = parseFloat(feature.properties.am_peak_combined_frequency) || 0;
            const fillOpacity = frequency === 0 ? 0 : Math.min(frequency / 12, 1);
            
            return L.circleMarker(latlng, {
              radius: 3,
              fillColor: 'green',
              color: 'green',
              weight: 0.5,
              opacity: 0,
              fillOpacity: 0,
              _calculatedFillOpacity: fillOpacity
            });
          }
        }).addTo(map);
      }),
    
    fetch('https://AmFa6.github.io/TAF_test/simplified_network.geojson')
      .then(response => response.json())
      .then(data => {
        roadNetworkLayer = L.geoJSON(data, {
          pane: 'roadLayers',
          style: function (feature) {
            const roadFunction = feature.properties.roadfunction;
            let weight = 0;
            
            if (roadFunction === 'Motorway') {
              weight = 4;
            } else if (roadFunction === 'A Road') {
              weight = 2;
            }
            
            return {
              color: 'white',
              weight: weight,
              opacity: 0,
            };
          },
        }).addTo(map);
      })
  ]).catch(error => {
    console.error("Error loading transport infrastructure:", error);
  });
}

/**
 * Loads heavier data (grid, training centers) in the background
 */
function loadBackgroundData() {
  // console.log('Starting background data loading...');
  
  showBackgroundLoadingIndicator('Loading facilities data...');
  loadTrainingCentres()
    .then(() => {
      // console.log('Training centers loaded successfully');
      hideBackgroundLoadingIndicator();
      
      initializeTrainingCentres();
      
      loadGridData();
    })
    .catch(error => {
      console.error('Error loading training centres:', error);
      hideBackgroundLoadingIndicator();
      showErrorNotification('Error loading training center data. Some features may be limited.');
      
      loadGridData();
    });
}

/**
 * Loads grid data using fast CSV+GeoJSON approach with DuckDB for analytics
 */
async function loadGridData() {
  showBackgroundLoadingIndicator('Loading grid data...');
  
  try {
    console.log('🚀 === Starting fast CSV+GeoJSON data loading ===');
    const totalStartTime = performance.now();
    
    // Load files in parallel - much faster than single parquet
    console.log('📥 Loading CSV and GeoJSON files in parallel...');
    const loadStart = performance.now();
    
    const [data1, data2, csvText1, csvText2] = await Promise.all([
      fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid_1.geojson').then(response => response.json()),
      fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid_2.geojson').then(response => response.json()),
      fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid_1.csv').then(response => response.text()),
      fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid_2.csv').then(response => response.text())
    ]);
    
    const loadTime = performance.now() - loadStart;
    console.log(`✅ Files loaded in ${loadTime.toFixed(2)}ms`);
    
    // Process data quickly without DuckDB overhead
    console.log('� Processing grid data...');
    const processStart = performance.now();
    const processedGrid = await processGridDataFast(data1, data2, csvText1, csvText2);
    const processTime = performance.now() - processStart;
    console.log(`✅ Data processed in ${processTime.toFixed(2)}ms`);
    
    grid = processedGrid;
    
    // Initialize DuckDB in background for analytics (non-blocking)
    console.log('� Initializing DuckDB for analytics (background)...');
    initializeDuckDBForAnalytics(grid);
    
    console.log('�📊 Calculating statistics...');
    const statsStart = performance.now();
    calculateGridStatistics(grid);
    const statsTime = performance.now() - statsStart;
    console.log(`✅ Statistics calculated in ${statsTime.toFixed(2)}ms`);
    
    console.log('🔄 Updating UI components...');
    const uiStart = performance.now();
    updateFilterDropdown();
    updateFilterValues();
    
    if (initialLoadComplete) {
      updateSummaryStatistics(grid.features);
    }
    const uiTime = performance.now() - uiStart;
    console.log(`✅ UI updated in ${uiTime.toFixed(2)}ms`);
    
    hideBackgroundLoadingIndicator();
    
    const totalTime = performance.now() - totalStartTime;
    const totalSeconds = (totalTime / 1000).toFixed(2);
    console.log(`🎉 === TOTAL LOADING TIME: ${totalTime.toFixed(2)}ms (${totalSeconds}s) ===`);
    console.log(`📈 Performance breakdown:`);
    console.log(`   File loading: ${loadTime.toFixed(2)}ms (${((loadTime/totalTime)*100).toFixed(1)}%)`);
    console.log(`   Data processing: ${processTime.toFixed(2)}ms (${((processTime/totalTime)*100).toFixed(1)}%)`);
    console.log(`   Statistics: ${statsTime.toFixed(2)}ms (${((statsTime/totalTime)*100).toFixed(1)}%)`);
    console.log(`   UI update: ${uiTime.toFixed(2)}ms (${((uiTime/totalTime)*100).toFixed(1)}%)`);
    
  } catch (error) {
    console.error("❌ Error loading grid data:", error);
    hideBackgroundLoadingIndicator();
    showErrorNotification("Error loading grid data. Some features may be limited.");
  }
}

/**
 * Wait for DuckDB-WASM ES module to be loaded
 */
async function waitForDuckDBModule() {
  return new Promise((resolve, reject) => {
    if (window.duckdb && window.duckdbLoaded) {
      // console.log('DuckDB-WASM already available');
      resolve();
      return;
    }
    
    const handleDuckDBReady = (event) => {
      // console.log('DuckDB-WASM ready event received:', event.detail);
      window.removeEventListener('duckdb-ready', handleDuckDBReady);
      window.removeEventListener('duckdb-error', handleDuckDBError);
      resolve();
    };
    
    const handleDuckDBError = (event) => {
      console.error('DuckDB-WASM error event received:', event.detail);
      window.removeEventListener('duckdb-ready', handleDuckDBReady);
      window.removeEventListener('duckdb-error', handleDuckDBError);
      reject(new Error(`Failed to load DuckDB-WASM: ${event.detail.message}`));
    };
    
    window.addEventListener('duckdb-ready', handleDuckDBReady);
    window.addEventListener('duckdb-error', handleDuckDBError);
    
    setTimeout(() => {
      window.removeEventListener('duckdb-ready', handleDuckDBReady);
      window.removeEventListener('duckdb-error', handleDuckDBError);
      reject(new Error('Timeout waiting for DuckDB-WASM to load'));
    }, 30000);
  });
}

/**
 * Initialize DuckDB-WASM
 */
async function initializeDuckDB() {
  try {
    // console.log('=== DuckDB-WASM Initialization ===');
    
    if (!window.duckdb) {
      throw new Error('DuckDB-WASM module not available');
    }
    
    // console.log('DuckDB object inspection:');
    // console.log('- typeof:', typeof window.duckdb);
    // console.log('- keys:', Object.keys(window.duckdb));
    
    const requiredMethods = ['getJsDelivrBundles', 'selectBundle', 'AsyncDuckDB', 'ConsoleLogger'];
    const missingMethods = requiredMethods.filter(method => !window.duckdb[method]);
    
    if (missingMethods.length > 0) {
      console.error('Missing required DuckDB methods:', missingMethods);
      throw new Error(`DuckDB-WASM is missing required methods: ${missingMethods.join(', ')}`);
    }
    
    if (!window.duckdbInstance) {
      // console.log('Initializing DuckDB-WASM instance...');
      
      // console.log('Getting bundles...');
      const JSDELIVR_BUNDLES = window.duckdb.getJsDelivrBundles();
      // console.log('Available bundles:', JSDELIVR_BUNDLES);
      
      // console.log('Selecting bundle...');
      const bundle = await window.duckdb.selectBundle(JSDELIVR_BUNDLES);
      // console.log('Selected bundle:', bundle);
      
      // console.log('Creating worker...');
      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );
      const worker = new Worker(worker_url);
      // console.log('Worker created successfully');
      
      // console.log('Creating logger...');
      const logger = new window.duckdb.ConsoleLogger();
      // console.log('Logger created successfully');
      
      // console.log('Creating AsyncDuckDB instance...');
      const db = new window.duckdb.AsyncDuckDB(logger, worker);
      // console.log('AsyncDuckDB instance created');
      
      // console.log('Instantiating database...');
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      
      URL.revokeObjectURL(worker_url);
      
      // console.log('Database instantiated successfully');
      
      window.duckdbInstance = db;
      // console.log('✅ DuckDB-WASM initialized successfully');
    } else {
      // console.log('✅ DuckDB-WASM instance already exists');
    }
    
    return window.duckdbInstance;
  } catch (error) {
    console.error('❌ Failed to initialize DuckDB-WASM:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

/**
 * Fast processing of grid data without DuckDB overhead
 */
async function processGridDataFast(data1, data2, csvText1, csvText2) {
  return new Promise((resolve) => {
    console.log("� Processing CSV data with Papa Parse...");
    
    // Use Papa Parse for fast CSV processing
    const csvData1 = Papa.parse(csvText1, { 
      header: true, 
      skipEmptyLines: true,
      fastMode: true // Enable fast mode for better performance
    }).data;
    
    const csvData2 = Papa.parse(csvText2, { 
      header: true, 
      skipEmptyLines: true,
      fastMode: true
    }).data;
    
    // Create lookup with Map for O(1) access
    const csvLookup = new Map();
    
    // Process CSV data efficiently
    csvData1.forEach(row => {
      if (row.OriginId_tracc) {
        csvLookup.set(row.OriginId_tracc, row);
      }
    });
    
    csvData2.forEach(row => {
      if (row.OriginId_tracc) {
        csvLookup.set(row.OriginId_tracc, row);
      }
    });
    
    console.log(`� Created lookup table with ${csvLookup.size} entries`);
    
    // Process features in larger batches for better performance
    const BATCH_SIZE = 10000; // Larger batches since we're not using JSON.parse for geometry
    const allFeatures = [...data1.features, ...data2.features];
    const processedFeatures = [];
    
    let processed = 0;
    const totalFeatures = allFeatures.length;
    
    console.log(`🔄 Processing ${totalFeatures} features in batches of ${BATCH_SIZE}...`);
    
    // Process synchronously in batches with progress updates
    for (let i = 0; i < totalFeatures; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, totalFeatures);
      const batchStart = performance.now();
      
      for (let j = i; j < batchEnd; j++) {
        const feature = allFeatures[j];
        const originId = feature.properties.OriginId_tracc;
        
        if (originId && csvLookup.has(originId)) {
          const csvData = csvLookup.get(originId);
          
          // Merge properties efficiently
          Object.assign(feature.properties, csvData);
          
          // Pre-calculate centroid for faster access later
          if (!feature.properties._centroid) {
            const centroid = turf.centroid(feature);
            feature.properties._centroid = centroid.geometry.coordinates;
          }
          
          processedFeatures.push(feature);
        }
      }
      
      processed = batchEnd;
      const batchTime = performance.now() - batchStart;
      const progress = ((processed / totalFeatures) * 100).toFixed(1);
      console.log(`⚡ Batch ${i}-${batchEnd} processed in ${batchTime.toFixed(2)}ms (${progress}% complete)`);
    }
    
    const combinedData = {
      type: 'FeatureCollection',
      features: processedFeatures
    };
    
    console.log(`✅ Processed ${processedFeatures.length} valid features`);
    resolve(combinedData);
  });
}

/**
 * Initialize DuckDB in background for advanced analytics (non-blocking)
 */
async function initializeDuckDBForAnalytics(gridData) {
  try {
    console.log('🔧 Starting background DuckDB initialization for analytics...');
    
    // Don't block the main thread - initialize DuckDB for later use
    setTimeout(async () => {
      try {
        await waitForDuckDBModule();
        await initializeDuckDB();
        
        // Load data into DuckDB for analytics
        const db = window.duckdbInstance;
        const conn = await db.connect();
        
        // Create analytics table with prepared data
        await conn.query(`
          CREATE TABLE grid_analytics AS 
          SELECT * FROM (VALUES 
            ${gridData.features.map(f => 
              `(${f.properties.OriginId_tracc}, ${f.properties.pop || 'NULL'}, ${f.properties.pop_growth || 'NULL'}, ${f.properties.imd_score_mhclg || 'NULL'}, ${f.properties.imd_decile_mhclg || 'NULL'}, ${f.properties.hh_caravail_ts045 || 'NULL'}, '${f.properties.lad24cd || ''}', '${f.properties.wd24cd || ''}')`
            ).join(', ')}
          ) AS t(OriginId_tracc, pop, pop_growth, imd_score_mhclg, imd_decile_mhclg, hh_caravail_ts045, lad24cd, wd24cd)
        `);
        
        await conn.close();
        
        // Set flag to indicate DuckDB is ready for analytics
        window.duckdbAnalyticsReady = true;
        console.log('🎉 DuckDB analytics engine ready for advanced queries!');
        
      } catch (error) {
        console.warn('⚠️ DuckDB analytics initialization failed (optional feature):', error);
      }
    }, 100); // Small delay to let UI update complete first
    
  } catch (error) {
    console.warn('⚠️ Background DuckDB initialization failed (optional):', error);
  }
}

/**
 * Execute advanced analytics queries using DuckDB (when available)
 */
async function executeAdvancedAnalytics(query, description = 'Advanced Query') {
  if (!window.duckdbAnalyticsReady || !window.duckdbInstance) {
    console.warn('⚠️ DuckDB analytics not available, falling back to JavaScript processing');
    return null;
  }
  
  try {
    console.log(`🔍 Executing ${description} with DuckDB...`);
    const startTime = performance.now();
    
    const db = window.duckdbInstance;
    const conn = await db.connect();
    
    const result = await conn.query(query);
    const queryTime = performance.now() - startTime;
    
    console.log(`⚡ ${description} completed in ${queryTime.toFixed(2)}ms`);
    
    // Convert result to JavaScript array
    const rows = [];
    for (let i = 0; i < result.numRows; i++) {
      rows.push(result.get(i).toJSON());
    }
    
    await conn.close();
    return rows;
    
  } catch (error) {
    console.error(`❌ DuckDB analytics query failed:`, error);
    return null;
  }
}

/**
 * Example advanced analytics functions using DuckDB
 */
const analyticsQueries = {
  // Get population statistics by area
  getPopulationStats: () => executeAdvancedAnalytics(`
    SELECT 
      lad24cd,
      COUNT(*) as grid_count,
      AVG(pop) as avg_population,
      SUM(pop) as total_population,
      MIN(pop) as min_population,
      MAX(pop) as max_population
    FROM grid_analytics 
    WHERE pop IS NOT NULL 
    GROUP BY lad24cd 
    ORDER BY total_population DESC
  `, 'Population Statistics by Area'),
  
  // Get IMD correlation analysis
  getIMDCorrelation: () => executeAdvancedAnalytics(`
    SELECT 
      CORR(pop, imd_score_mhclg) as pop_imd_correlation,
      CORR(pop_growth, imd_score_mhclg) as growth_imd_correlation,
      CORR(hh_caravail_ts045, imd_score_mhclg) as car_imd_correlation
    FROM grid_analytics 
    WHERE pop IS NOT NULL AND imd_score_mhclg IS NOT NULL
  `, 'IMD Correlation Analysis'),
  
  // Get high-density areas
  getHighDensityAreas: (threshold = 1000) => executeAdvancedAnalytics(`
    SELECT OriginId_tracc, pop, pop_growth, imd_score_mhclg, lad24cd
    FROM grid_analytics 
    WHERE pop > ${threshold}
    ORDER BY pop DESC
    LIMIT 100
  `, `High Density Areas (>${threshold})`),
  
  // Get percentile analysis
  getPercentileAnalysis: () => executeAdvancedAnalytics(`
    SELECT 
      'Population' as metric,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY pop) as p25,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pop) as p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY pop) as p75,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY pop) as p90
    FROM grid_analytics WHERE pop IS NOT NULL
    UNION ALL
    SELECT 
      'IMD Score' as metric,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY imd_score_mhclg) as p25,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY imd_score_mhclg) as p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY imd_score_mhclg) as p75,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY imd_score_mhclg) as p90
    FROM grid_analytics WHERE imd_score_mhclg IS NOT NULL
  `, 'Percentile Analysis')
};

// Example usage function
async function runAdvancedAnalytics() {
  if (!window.duckdbAnalyticsReady) {
    console.log('🔧 DuckDB analytics not ready yet. Please wait a moment and try again.');
    return;
  }
  
  console.log('🚀 Running advanced analytics suite...');
  
  try {
    const [popStats, imdCorr, highDensity, percentiles] = await Promise.all([
      analyticsQueries.getPopulationStats(),
      analyticsQueries.getIMDCorrelation(),
      analyticsQueries.getHighDensityAreas(1000),
      analyticsQueries.getPercentileAnalysis()
    ]);
    
    console.log('📊 Advanced Analytics Results:');
    console.log('Population Stats:', popStats);
    console.log('IMD Correlations:', imdCorr);
    console.log('High Density Areas:', highDensity);
    console.log('Percentile Analysis:', percentiles);
    
    return {
      populationStats: popStats,
      imdCorrelation: imdCorr,
      highDensityAreas: highDensity,
      percentileAnalysis: percentiles
    };
    
  } catch (error) {
    console.error('❌ Advanced analytics failed:', error);
    return null;
  }
}

// Console helper for testing analytics
window.testAnalytics = runAdvancedAnalytics;
window.customAnalytics = executeAdvancedAnalytics;

// Example custom query: window.customAnalytics("SELECT COUNT(*) as total_grids FROM grid_analytics")
console.log('📊 Analytics helpers available: window.testAnalytics() and window.customAnalytics("YOUR_SQL_QUERY")');
