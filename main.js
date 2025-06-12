const map = L.map('map').setView([51.480, -2.591], 11);

const baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors & CartoDB, © Crown copyright and database rights 2025 OS 0100059651, Contains OS data © Crown copyright [and database right] 2025.'
}).addTo(map);

const ladCodesString = ladCodes.map(code => `'${code}'`).join(',');

let gridStatistics = {
  pop: { min: Infinity, max: -Infinity },
  IMDScore: { min: Infinity, max: -Infinity },
  car_availability_ts045: { min: Infinity, max: -Infinity },
  pop_growth: { min: Infinity, max: -Infinity },
  IMD_Decile: { min: Infinity, max: -Infinity }
};
let gridCentroidsFC = null;
let opacityAmenitiesOrder = 'low-to-high';
let outlineAmenitiesOrder = 'low-to-high';
let isInverseAmenitiesOpacity = false;
let isInverseAmenitiesOutline = false;
let uaBoundariesLayer;
let wardBoundariesLayer;
let AmenitiesCatchmentLayer = null;
let gridTimeMap = {};
let csvDataCache = {};
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
  console.log('Converting MultiPolygon to Polygon...');
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
  console.log('DOM fully loaded, starting application initialization...');
  
  initializeUI();
  setupMapPanes();
  
  initializeAndConfigureSlider(AmenitiesOpacityRange, isInverseAmenitiesOpacity);
  initializeAndConfigureSlider(AmenitiesOutlineRange, isInverseAmenitiesOutline);
  
  initializeFileUpload();
  setupDrawingTools();
  
  initializeCollapsiblePanels();
  
  loadBaseLayers().then(() => {
    console.log('Base layers loaded successfully');
    
    map.fire('baselayersloaded');
    initialLoadComplete = true;
    
    loadBackgroundData();
  }).catch(error => {
    console.error('Error loading base layers:', error);
    hideLoadingOverlay();
    showErrorNotification('Error loading map layers. Please try refreshing the page.');
  });
});

/**
 * Initializes the basic UI components
 * This is the first function called during application initialization
 */
function initializeUI() {
  console.log('Initializing user interface components...');

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
  console.log('Creating static legend controls...');
  
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
  console.log('Initializing legend controls...');
  
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
  console.log('Setting up map panes...');
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
  console.log('Loading base map layers...');
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
  console.log('Loading boundary data...');
  const ladCodesString = ladCodes.map(code => `'${code}'`).join(',');
  
  return Promise.all([
    fetch(`https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_December_2024_Boundaries_UK_BGC/FeatureServer/0/query?outFields=*&where=LAD24CD%20IN%20(${ladCodesString})&f=geojson`)
      .then(response => response.json())
      .then(data => {
        return convertMultiPolygonToPolygons(data).then(convertedData => {
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
            console.log("Ward boundaries layer added to map.");
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
  console.log('Loading transport infrastructure...');
  
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
  console.log('Starting background data loading...');
  
  showBackgroundLoadingIndicator('Loading facilities data...');
  loadTrainingCentres()
    .then(() => {
      console.log('Training centers loaded successfully');
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
 * Loads grid data in the background
 */
function loadGridData() {
  showBackgroundLoadingIndicator('Loading grid data...');
  
  Promise.all([
    fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid_1.geojson').then(response => response.json()),
    fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid_2.geojson').then(response => response.json()),
    fetch('https://AmFa6.github.io/TrainingCentres/grid-socioeco-lep_traccid.csv').then(response => response.text())
  ])
    .then(([data1, data2, csvText]) => {    
      console.log("Processing grid data in background...");
      
      processGridData(data1, data2, csvText).then(processedGrid => {
        grid = processedGrid;
        
        calculateGridStatistics(grid);
        
        updateFilterDropdown();
        updateFilterValues();
        
        if (initialLoadComplete) {
          updateSummaryStatistics(grid.features);
        }
        
        hideBackgroundLoadingIndicator();
        console.log("Grid data loading and processing complete");
      });
    })
    .catch(error => {
      console.error("Error loading grid data:", error);
      hideBackgroundLoadingIndicator();
      showErrorNotification("Error loading grid data. Some features may be limited.");
    });
}

/**
 * Processes grid data in batches to avoid UI blocking
 * @param {Object} data1 First part of grid GeoJSON
 * @param {Object} data2 Second part of grid GeoJSON
 * @param {String} csvText CSV data for grid properties
 * @returns {Promise} Promise that resolves with the processed grid data
 */
function processGridData(data1, data2, csvText) {
  return new Promise((resolve) => {
    console.log("Starting to process grid GeoJSON and CSV data...");
    
    const csvData = Papa.parse(csvText, { header: true }).data;
    
    const csvLookup = {};
    csvData.forEach(row => {
      if (row.OriginId_tracc) {
        csvLookup[row.OriginId_tracc] = row;
      }
    });
    
    const batchSize = 5000;
    let processedData1 = [], processedData2 = [];
    
    processFeaturesBatch(data1.features, csvLookup, 0, batchSize, processedData1, () => {
      processFeaturesBatch(data2.features, csvLookup, 0, batchSize, processedData2, () => {
        const combinedData = {
          type: 'FeatureCollection',
          features: [...processedData1, ...processedData2]
        };
        
        combinedData.features.forEach(feature => {
          const centroid = turf.centroid(feature);
          feature.properties._centroid = centroid.geometry.coordinates;
        });
        
        const gridCentroidsFC = turf.featureCollection(
          combinedData.features.map(f => turf.point(f.properties._centroid, { OriginId_tracc: f.properties.OriginId_tracc }))
        );
        
        resolve(combinedData);
      });
    });
  });
}

/**
 * Process features in batches to prevent UI blocking
 * @param {Array} features Array of GeoJSON features to process
 * @param {Object} csvLookup Lookup table of CSV data
 * @param {Number} startIndex Starting index for the batch
 * @param {Number} batchSize Number of features to process in each batch
 * @param {Array} results Array to store processed features
 * @param {Function} onComplete Callback when all batches are complete
 */
function processFeaturesBatch(features, csvLookup, startIndex, batchSize, results, onComplete) {
  const endIndex = Math.min(startIndex + batchSize, features.length);
  
  for (let i = startIndex; i < endIndex; i++) {
    const feature = features[i];
    const originId = feature.properties.OriginId_tracc;
    
    if (originId && csvLookup[originId]) {
      Object.keys(csvLookup[originId]).forEach(key => {
        if (key !== 'OriginId_tracc') {
          feature.properties[key] = csvLookup[originId][key];
        }
      });
      
      results.push(feature);
    }
  }
  
  const progressPercent = Math.round((endIndex / features.length) * 100);
  
  if (endIndex < features.length) {
    setTimeout(() => {
      processFeaturesBatch(features, csvLookup, endIndex, batchSize, results, onComplete);
    }, 0);
  } else {
    onComplete();
  }
}

/**
 * Calculates and stores min/max values for important grid attributes
 * @param {Object} gridData The grid GeoJSON data
 */
function calculateGridStatistics(gridData) {
  if (!gridData || !gridData.features || gridData.features.length === 0) return;
  
  console.log("Calculating grid statistics for optimization...");
  
  gridStatistics = {
    pop: { min: Infinity, max: -Infinity },
    IMDScore: { min: Infinity, max: -Infinity },
    car_availability_ts045: { min: Infinity, max: -Infinity },
    pop_growth: { min: Infinity, max: -Infinity },
    IMD_Decile: { min: Infinity, max: -Infinity }
  };
  
  const BATCH_SIZE = 5000;
  const features = gridData.features;
  const totalBatches = Math.ceil(features.length / BATCH_SIZE);
  
  function processBatch(batchIndex) {
    const startIdx = batchIndex * BATCH_SIZE;
    const endIdx = Math.min((batchIndex + 1) * BATCH_SIZE, features.length);
    
    for (let i = startIdx; i < endIdx; i++) {
      const props = features[i].properties;
      if (!props) continue;
      
      for (const field in gridStatistics) {
        if (props[field] !== undefined && props[field] !== null) {
          const value = parseFloat(props[field]);
          if (!isNaN(value)) {
            gridStatistics[field].min = Math.min(gridStatistics[field].min, value);
            gridStatistics[field].max = Math.max(gridStatistics[field].max, value);
          }
        }
      }
    }
    
    if (batchIndex + 1 < totalBatches) {
      setTimeout(() => processBatch(batchIndex + 1), 0);
    } else {
      console.log("Grid statistics calculation complete:", gridStatistics);
      
      updateSliderRanges('Amenities', 'Opacity');
      updateSliderRanges('Amenities', 'Outline');
    }
  }
  
  processBatch(0);
}

/**
 * Shows a subtle loading indicator for background processes
 * @param {String} message The message to display in the indicator
 */
function showBackgroundLoadingIndicator(message = 'Loading data...') {
  let indicator = document.getElementById('background-loading-indicator');
  
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'background-loading-indicator';
    indicator.style.cssText = 'position:absolute;bottom:10px;left:10px;background:rgba(255,255,255,0.8);padding:5px 10px;border-radius:3px;font-size:12px;z-index:1000;display:flex;align-items:center;';
    
    const spinner = document.createElement('div');
    spinner.className = 'mini-spinner';
    spinner.style.cssText = 'width:12px;height:12px;border:2px solid #ccc;border-top-color:#3388ff;border-radius:50%;margin-right:8px;animation:spin 1s linear infinite;';
    
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
    
    const text = document.createElement('span');
    text.id = 'background-loading-text';
    
    indicator.appendChild(spinner);
    indicator.appendChild(text);
    document.body.appendChild(indicator);
  }
  
  const textElement = document.getElementById('background-loading-text');
  if (textElement) textElement.textContent = message;
  
  indicator.style.display = 'flex';
}

/**
 * Hides the background loading indicator
 */
function hideBackgroundLoadingIndicator() {
  const indicator = document.getElementById('background-loading-indicator');
  if (indicator) {
    indicator.style.transition = 'opacity 0.5s';
    indicator.style.opacity = '0';
    setTimeout(() => {
      indicator.style.display = 'none';
      indicator.style.opacity = '1';
    }, 500);
  }
}

/**
 * Shows an error notification to the user
 * @param {String} message The error message to display
 */
function showErrorNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.style.cssText = 'position:fixed;top:20px;right:20px;background:#f44336;color:white;padding:10px 20px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.2);z-index:9999;max-width:80%;';
  notification.textContent = message;
  
  const closeBtn = document.createElement('span');
  closeBtn.style.cssText = 'margin-left:10px;cursor:pointer;font-weight:bold;';
  closeBtn.textContent = '×';
  closeBtn.onclick = function() {
    document.body.removeChild(notification);
  };
  
  notification.appendChild(closeBtn);
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.style.transition = 'opacity 0.5s';
      notification.style.opacity = '0';
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 500);
    }
  }, 5000);
}

/**
 * Shows a loading overlay during important operations
 */
function showLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('active');
  }
}

/**
 * Hides the loading overlay when operations complete
 */
function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
}

map.on('zoomend', () => {
  const currentZoom = map.getZoom();
  const isAboveZoomThreshold = currentZoom >= 14;
  
  if (isAboveZoomThreshold !== wasAboveZoomThreshold) {
    wasAboveZoomThreshold = isAboveZoomThreshold;
    
    if (AmenitiesCatchmentLayer) {
      drawSelectedAmenities(selectedAmenitiesAmenities);
    }
  }
});

map.on('click', function (e) {
  if (isDrawingActive) {
    return;
  }

  const clickedLatLng = e.latlng;
  const clickedPoint = turf.point([clickedLatLng.lng, clickedLatLng.lat]);

    let userLayerFeatureFound = false;
  
  if (userLayers && userLayers.length > 0) {
    for (const userLayer of userLayers) {
      if (!userLayer.layer || !map.hasLayer(userLayer.layer)) continue;
      
      const nearbyFeatures = findNearbyInfrastructure(clickedLatLng, 10, userLayer.layer);
      
      if (nearbyFeatures && nearbyFeatures.features && nearbyFeatures.features.length > 0) {
        const nearestFeature = nearbyFeatures.features[0];
        
        let properties = nearestFeature.feature.feature.properties || {};
        
        let popupContent = `<div class="custom-feature-popup">`;
        popupContent += `<h4>${userLayer.name || 'Custom Feature'}</h4>`;
        
        if (Object.keys(properties).length > 0) {
          popupContent += `<table class="popup-table">`;
          popupContent += `<tr><th>Property</th><th>Value</th></tr>`;
          for (const [key, value] of Object.entries(properties)) {
            if (key !== 'id' && key !== 'layerId') {
              popupContent += `<tr><td>${key}</td><td>${value}</td></tr>`;
            }
          }
          popupContent += `</table>`;
        }
        
        popupContent += `</div>`;
        
        L.popup()
          .setLatLng(clickedLatLng)
          .setContent(popupContent)
          .openOn(map);
        
        userLayerFeatureFound = true;
        break;
      }
    }
    
    if (userLayerFeatureFound) return;
  }

  const busStopsVisible = document.getElementById('busStopsCheckbox')?.checked;
  const busLinesVisible = document.getElementById('busLinesCheckbox')?.checked;
  
  if (busStopsVisible || busLinesVisible) {
    const nearbyFeatures = findNearbyInfrastructure(clickedLatLng);
    
    if (!busStopsVisible) nearbyFeatures.busStops = [];
    if (!busLinesVisible) nearbyFeatures.busLines = [];
    
    const hasNearbyFeatures = 
      nearbyFeatures.busStops.length > 0 || 
      nearbyFeatures.busLines.length > 0;
    
    if (hasNearbyFeatures) {
      showInfrastructurePopup(clickedLatLng, nearbyFeatures);
      return;
    }
  }
  
  const popupContent = {
    Geographies: [],
    GridCell: []
  };

  let isWithinLEP = false;
  if (uaBoundariesLayer) {
    uaBoundariesLayer.eachLayer(layer => {
      const polygon = turf.polygon(layer.feature.geometry.coordinates);
      if (turf.booleanPointInPolygon(clickedPoint, polygon)) {
        isWithinLEP = true;
        popupContent.Geographies.push(`<strong>Local Authority:</strong> ${layer.feature.properties.LAD24NM}`);
      }
    });
  }

  if (!isWithinLEP) {
    return;
  }

  if (wardBoundariesLayer) {
    wardBoundariesLayer.eachLayer(layer => {
      const polygon = turf.polygon(layer.feature.geometry.coordinates);
      if (turf.booleanPointInPolygon(clickedPoint, polygon)) {
        popupContent.Geographies.push(`<strong>Ward:</strong> ${layer.feature.properties.WD24NM}`);
      }
    });
  }

  if (AmenitiesCatchmentLayer) {
    const gridLayer = AmenitiesCatchmentLayer;
    gridLayer.eachLayer(layer => {
      const polygon = turf.polygon(layer.feature.geometry.coordinates);
      if (turf.booleanPointInPolygon(clickedPoint, polygon)) {
        const properties = layer.feature.properties;
        if (AmenitiesCatchmentLayer) {
          const time = formatValue(gridTimeMap[properties.OriginId_tracc], 1);
          const population = formatValue(properties.pop, 10);
          const imdScore = formatValue(properties.IMDScore, 0.1);
          const imdDecile = formatValue(properties.IMD_Decile, 1);
          const carAvailability = formatValue(properties.car_availability_ts045, 0.01);
          const PopGrowth = formatValue(properties.pop_growth, 10);

          popupContent.GridCell.push(`
            <strong>ID:</strong> ${properties.OriginId_tracc}<br>
            <strong>Journey Time:</strong> ${time} minutes<br>
            <strong>Population:</strong> ${population}<br>
            <strong>IMD Score:</strong> ${imdScore}<br>
            <strong>IMD Decile:</strong> ${imdDecile}<br>
            <strong>Car Availability:</strong> ${carAvailability}<br>
            <strong>Population Growth:</strong> ${PopGrowth}
          `);
        }
      }
    });
  } else if (grid) {
    grid.features.forEach(feature => {
      const polygon = turf.polygon(feature.geometry.coordinates);
      if (turf.booleanPointInPolygon(clickedPoint, polygon)) {
        const properties = feature.properties;
        const population = formatValue(properties.pop, 10);
        const imdScore = formatValue(properties.IMDScore, 0.1);
        const imdDecile = formatValue(properties.IMD_Decile, 1);
        const carAvailability = formatValue(properties.car_availability_ts045, 0.01);
        const PopGrowth = formatValue(properties.pop_growth, 10);

        popupContent.GridCell.push(`
          <strong>ID:</strong> ${properties.OriginId_tracc}<br>
          <strong>Population:</strong> ${population}<br>
          <strong>IMD Score:</strong> ${imdScore}<br>
          <strong>IMD Decile:</strong> ${imdDecile}<br>
          <strong>Car Availability:</strong> ${carAvailability}<br>
          <strong>Population Growth:</strong> ${PopGrowth}
        `);
      }
    });
  }

  const content = `
    <div>
      <h4 style="text-decoration: underline;">Geographies</h4>
      ${popupContent.Geographies.length > 0 ? popupContent.Geographies.join('<br>') : '-'}
      <h4 style="text-decoration: underline;">GridCell</h4>
      ${popupContent.GridCell.length > 0 ? popupContent.GridCell.join('<br>') : '-'}
    </div>
  `;

  L.popup()
    .setLatLng(clickedLatLng)
    .setContent(content)
    .openOn(map);
});

function initializeFileUpload() {
  console.log('Initializing file upload...');
  const fileInput = document.getElementById('fileUpload');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const uploadButton = document.getElementById('uploadButton');
  
  if (!fileInput || !uploadButton) return;
  
  fileInput.addEventListener('change', function() {
    if (this.files.length > 0) {
      fileNameDisplay.textContent = this.files[0].name;
      uploadButton.disabled = false;
    } else {
      fileNameDisplay.textContent = '';
      uploadButton.disabled = true;
    }
  });
  
  uploadButton.addEventListener('click', function() {
    const file = fileInput.files[0];
    if (!file) return;
    
    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    if (fileExtension === 'geojson' || fileExtension === 'json') {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const layerData = JSON.parse(e.target.result);
          addUserLayer(layerData, file.name);
        } catch (error) {
          alert('Error processing file: ' + error.message);
        }
      };
      reader.readAsText(file);
    } else if (fileExtension === 'kml') {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const kml = new DOMParser().parseFromString(e.target.result, 'text/xml');
          const layerData = toGeoJSON.kml(kml);
          addUserLayer(layerData, file.name);
        } catch (error) {
          alert('Error processing file: ' + error.message);
        }
      };
      reader.readAsText(file);
    }
    
    fileInput.value = '';
    fileNameDisplay.textContent = '';
    uploadButton.disabled = true;
  });
}

function loadTrainingCentres() {
  console.log('Loading training centres...');
  return fetch(AmenitiesFiles[0].path)
    .then(response => response.json())
    .then(data => {
      amenityLayers['TrainingCentres'] = data;
      return data;
    });
}

function setupSubjectAndAimLevelCheckboxes() {
  console.log('Setting up subject and aim level checkboxes...');
  const subjectAllCheckbox = document.querySelector('#subjectCheckboxesContainer input[value="All"]');
  const subjectCheckboxes = document.querySelectorAll('#subjectCheckboxesContainer input[type="checkbox"]:not([value="All"])');
  
  subjectAllCheckbox.addEventListener('change', function() {
    const isChecked = this.checked;
    subjectCheckboxes.forEach(checkbox => {
      checkbox.checked = isChecked;
    });
    updateSubjectDropdownLabel();
    drawSelectedAmenities();
  });
  
  subjectCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      if (!this.checked) {
        subjectAllCheckbox.checked = false;
      } else {
        const allIndividualChecked = Array.from(subjectCheckboxes).every(cb => cb.checked);
        if (allIndividualChecked) {
          subjectAllCheckbox.checked = true;
        }
      }
      updateSubjectDropdownLabel();
      drawSelectedAmenities();
    });
  });
  
  const aimLevelAllCheckbox = document.querySelector('#aimlevelCheckboxesContainer input[value="All"]');
  const aimLevelCheckboxes = document.querySelectorAll('#aimlevelCheckboxesContainer input[type="checkbox"]:not([value="All"])');
  
  aimLevelAllCheckbox.addEventListener('change', function() {
    const isChecked = this.checked;
    aimLevelCheckboxes.forEach(checkbox => {
      checkbox.checked = isChecked;
    });
    updateAimLevelDropdownLabel();
    drawSelectedAmenities();
  });
  
  aimLevelCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      if (!this.checked) {
        aimLevelAllCheckbox.checked = false;
      } else {
        const allIndividualChecked = Array.from(aimLevelCheckboxes).every(cb => cb.checked);
        if (allIndividualChecked) {
          aimLevelAllCheckbox.checked = true;
        }
      }
      updateAimLevelDropdownLabel();
      drawSelectedAmenities();
    });
  });
}

function filterTrainingCentres() {
  console.log('Filtering training centres...');
  if (!amenityLayers['TrainingCentres']) return [];
  
  const selectedYear = AmenitiesYear.value;
  const yearPrefix = selectedYear === 'Any' ? null : selectedYear.substring(0, 4);
  
  const subjectAllCheckbox = document.querySelector('#subjectCheckboxesContainer input[value="All"]');
  const isAllSubjectsSelected = subjectAllCheckbox && subjectAllCheckbox.checked;
  
  const subjectCheckboxes = document.querySelectorAll('#subjectCheckboxesContainer input[type="checkbox"]:checked:not([value="All"])');
  const selectedSubjects = Array.from(subjectCheckboxes).map(checkbox => checkbox.value.toLowerCase());
  
  const aimLevelAllCheckbox = document.querySelector('#aimlevelCheckboxesContainer input[value="All"]');
  const isAllAimLevelsSelected = aimLevelAllCheckbox && aimLevelAllCheckbox.checked;
  
  const aimLevelCheckboxes = document.querySelectorAll('#aimlevelCheckboxesContainer input[type="checkbox"]:checked:not([value="All"])');
  const selectedAimLevels = isAllAimLevelsSelected ? [] : 
    Array.from(aimLevelCheckboxes).map(checkbox => checkbox.value);
  
  const filteredFeatures = amenityLayers['TrainingCentres'].features.filter(feature => {
    const props = feature.properties;
    
    const hasSelectedAimLevel = isAllAimLevelsSelected || selectedAimLevels.length === 0 || 
      selectedAimLevels.some(level => props[`AimLevel_${level}`] === "1");
    
    if (!hasSelectedAimLevel) return false;
    
    if (!yearPrefix) {
      if (isAllSubjectsSelected || selectedSubjects.length === 0) return true;
      
      const years = ["2122", "2223", "2324", "2425"];
      return years.some(year => {
        return selectedSubjects.some(subject => {
          const columnName = `${year}_${subject}`;
          return props[columnName] && props[columnName] !== "" && props[columnName] !== "0";
        });
      });
    }
    
    if (isAllSubjectsSelected) {
      const subjectsList = ["construction", "digital", "engineering"];
      return subjectsList.some(subject => {
        const columnName = `${yearPrefix}_${subject}`;
        return props[columnName] && props[columnName] !== "" && props[columnName] !== "0";
      });
    }
    
    return selectedSubjects.some(subject => {
      const columnName = `${yearPrefix}_${subject}`;
      return props[columnName] && props[columnName] !== "" && props[columnName] !== "0";
    });
  });
  
  return {
    type: "FeatureCollection",
    features: filteredFeatures
  };
}

function getTrainingCenterPopupContent(properties) {
  console.log('Generating popup content for training center...');
  let content = `
    <div>
      <h4>${properties.Provider || 'Unknown Provider'}</h4>
      <p><strong>Location:</strong> ${properties['Delivery Postcode'] || 'Unknown'}</p>
      <p><strong>Aim Levels:</strong> `;
  
  const aimLevels = [];
  if (properties.AimLevel_E === "1") aimLevels.push("E");
  if (properties.AimLevel_X === "1") aimLevels.push("X");
  if (properties.AimLevel_1 === "1") aimLevels.push("1");
  if (properties.AimLevel_2 === "1") aimLevels.push("2");
  if (properties.AimLevel_3 === "1") aimLevels.push("3");
  
  content += aimLevels.join(", ") || "None";
  content += "</p>";
  
  content += "<p><strong>Available Courses by Year:</strong></p>";
  content += "<table class='popup-table'><tr><th>Year</th><th>Digital</th><th>Engineering</th><th>Construction</th></tr>";
  
  const years = ["2122", "2223", "2324", "2425"];
  const yearLabels = ["2021/22", "2022/23", "2023/24", "2024/25"];
  
  years.forEach((year, index) => {
    const digital = properties[`${year}_digital`] || "";
    const engineering = properties[`${year}_engineering`] || "";
    const construction = properties[`${year}_construction`] || "";
    
    content += `<tr><td>${yearLabels[index]}</td><td>${digital}</td><td>${engineering}</td><td>${construction}</td></tr>`;
  });
  
  content += "</table>";
  
  return content;
}

function setupTrainingCenterFilters() {
    console.log('Setting up training center filters...');
    
    const debouncedHandler = debounce(() => {
        drawSelectedAmenities();
        updateAmenitiesCatchmentLayer();
    }, 2000);
    
    const subjectCheckboxes = document.querySelectorAll('#subjectCheckboxesContainer input[type="checkbox"]');
    subjectCheckboxes.forEach(checkbox => {
        checkbox.removeEventListener('change', debouncedHandler);
        checkbox.addEventListener('change', debouncedHandler);
    });
    
    const aimLevelCheckboxes = document.querySelectorAll('#aimlevelCheckboxesContainer input[type="checkbox"]');
    aimLevelCheckboxes.forEach(checkbox => {
        checkbox.removeEventListener('change', debouncedHandler);
        checkbox.addEventListener('change', debouncedHandler);
    });
    
    updateSubjectDropdownLabel();
    updateAimLevelDropdownLabel();
}

function updateSubjectDropdownLabel() {
  console.log('Updating subject dropdown label...');
  const subjectDropdown = document.getElementById('subjectDropdown');
  const subjectCheckboxes = document.querySelectorAll('#subjectCheckboxesContainer input[type="checkbox"]:not([value="All"])');
  const allCheckbox = document.querySelector('#subjectCheckboxesContainer input[value="All"]');
  const selectedCheckboxes = Array.from(subjectCheckboxes).filter(checkbox => checkbox.checked);
  
  if (selectedCheckboxes.length === 0) {
    subjectDropdown.textContent = '\u00A0';
  } else if (selectedCheckboxes.length === 1) {
    subjectDropdown.textContent = selectedCheckboxes[0].value;
  } else if (selectedCheckboxes.length === subjectCheckboxes.length || (allCheckbox && allCheckbox.checked)) {
    subjectDropdown.textContent = 'All Subjects';
  } else {
    subjectDropdown.textContent = 'Multiple Subjects';
  }
}

function updateAimLevelDropdownLabel() {
  console.log('Updating aim level dropdown label...');
  const aimLevelDropdown = document.getElementById('aimlevelDropdown');
  const aimLevelCheckboxes = document.querySelectorAll('#aimlevelCheckboxesContainer input[type="checkbox"]:not([value="All"])');
  const allCheckbox = document.querySelector('#aimlevelCheckboxesContainer input[value="All"]');
  const selectedCheckboxes = Array.from(aimLevelCheckboxes).filter(checkbox => checkbox.checked);
  
  if (selectedCheckboxes.length === 0) {
    aimLevelDropdown.textContent = '\u00A0';
  } else if (selectedCheckboxes.length === 1) {
    aimLevelDropdown.textContent = selectedCheckboxes[0].value;
  } else if (selectedCheckboxes.length === aimLevelCheckboxes.length || (allCheckbox && allCheckbox.checked)) {
    aimLevelDropdown.textContent = 'All Levels';
  } else {
    aimLevelDropdown.textContent = 'Multiple Levels';
  }
}

function initializeTrainingCentres() {
    console.log('Initializing training centres...');
    
    if (amenityLayers['TrainingCentres']) {
        setupTrainingCentersUI();
    } else {
        loadTrainingCentres().then(() => {
            setupTrainingCentersUI();
        });
    }
    
    function setupTrainingCentersUI() {
        const subjectAllCheckbox = document.querySelector('#subjectCheckboxesContainer input[value="All"]');
        const aimLevelAllCheckbox = document.querySelector('#aimlevelCheckboxesContainer input[value="All"]');
        
        if (subjectAllCheckbox) subjectAllCheckbox.checked = true;
        if (aimLevelAllCheckbox) aimLevelAllCheckbox.checked = true;
        
        const subjectCheckboxes = document.querySelectorAll('#subjectCheckboxesContainer input[type="checkbox"]:not([value="All"])');
        const aimLevelCheckboxes = document.querySelectorAll('#aimlevelCheckboxesContainer input[type="checkbox"]:not([value="All"])');
        
        subjectCheckboxes.forEach(checkbox => checkbox.checked = true);
        aimLevelCheckboxes.forEach(checkbox => checkbox.checked = true);
        
        setupSubjectAndAimLevelCheckboxes();
        setupTrainingCenterFilters();
        drawSelectedAmenities();
        
        const subjectDropdown = document.getElementById('subjectDropdown');
        const subjectCheckboxesContainer = document.getElementById('subjectCheckboxesContainer');
        
        subjectDropdown.addEventListener('click', () => {
            subjectCheckboxesContainer.classList.toggle('show');
        });
        
        const aimLevelDropdown = document.getElementById('aimlevelDropdown');
        const aimLevelCheckboxesContainer = document.getElementById('aimlevelCheckboxesContainer');
        
        aimLevelDropdown.addEventListener('click', () => {
            aimLevelCheckboxesContainer.classList.toggle('show');
        });
        
        window.addEventListener('click', (event) => {
            if (!event.target.matches('#subjectDropdown') && !event.target.closest('#subjectCheckboxesContainer')) {
                subjectCheckboxesContainer.classList.remove('show');
            }
            
            if (!event.target.matches('#aimlevelDropdown') && !event.target.closest('#aimlevelCheckboxesContainer')) {
                aimLevelCheckboxesContainer.classList.remove('show');
            }
        });
    }
}

function addUserLayer(data, fileName) {
  console.log('Adding user layer from file:', fileName);
  
  try {
    const layerId = `userLayer_${userLayerCount++}`;
    const layerName = fileName.split('.')[0];
    
    let reprojectedData = detectAndFixProjection(data);
    
    const fieldNames = [];
    const numericFields = [];
    
    if (reprojectedData.features && reprojectedData.features.length > 0) {
      const properties = reprojectedData.features[0].properties;
      for (const key in properties) {
        fieldNames.push(key);
        if (!isNaN(parseFloat(properties[key])) && isFinite(properties[key])) {
          numericFields.push(key);
        }
      }
    }
    
    const defaultColor = '#000000';

    const layer = L.geoJSON(reprojectedData, {
      pane: 'userLayers',
      style: function() {
        return {
          color: defaultColor,
          weight: 3,
          opacity: 0.75,
          fillOpacity: 0
        };
      },
      onEachFeature: function(feature, layer) {
        if (feature.properties) {
          layer.on('click', function(e) {
            if (isDrawingActive && activeShapeMode) {
              L.DomEvent.stopPropagation(e);
              openAttributeEditor(feature, layerId);
            } else {
              let popupContent = '<table class="popup-table">';
              popupContent += '<tr><th>Property</th><th>Value</th></tr>';
              
              for (const [key, value] of Object.entries(feature.properties)) {
                if (value !== null && value !== undefined) {
                  popupContent += `<tr><td>${key}</td><td>${value}</td></tr>`;
                }
              }
              
              popupContent += '</table>';
              layer.bindPopup(popupContent).openPopup();
            }
          });
        }
      },
      pointToLayer: function(feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 3,
          fillColor: defaultColor,
          color: defaultColor,
          weight: 1,
          opacity: 0.75,
          fillOpacity: 0.75
        });
      }
    }).addTo(map);
    
    const userLayer = {
      id: layerId,
      name: layerName,
      fileName: fileName,
      layer: layer,
      defaultColor: defaultColor,
      fieldNames: fieldNames,
      numericFields: numericFields,
      originalData: reprojectedData
    };
    userLayers.push(userLayer);
    
    const userLayersContainer = document.getElementById('userLayersContainer');
    if (userLayersContainer) {
      const template = document.getElementById('user-layer-template');
      const layerControl = document.importNode(template.content, true).querySelector('.user-layer-item');
      
      const checkbox = layerControl.querySelector('input[type="checkbox"]');
      checkbox.id = `${layerId}_check`;
      
      const layerNameSpan = layerControl.querySelector('span');
      layerNameSpan.textContent = layerName.length > 15 ? layerName.substring(0, 15) + '...' : layerName;
      layerNameSpan.title = layerName;
      
      layerControl.querySelectorAll('button').forEach(button => {
        button.setAttribute('data-id', layerId);
      });
      
      userLayersContainer.appendChild(layerControl);
      
      checkbox.addEventListener('change', function() {
        if (this.checked) {
          map.addLayer(userLayer.layer);
        } else {
          map.removeLayer(userLayer.layer);
        }
      });
      
      layerControl.querySelector('.layer-style-btn').addEventListener('click', function() {
        const layerId = this.getAttribute('data-id');
        openStyleDialog(layerId);
      });
      
      layerControl.querySelector('.layer-zoom-btn').addEventListener('click', function() {
        try {
          const layerId = this.getAttribute('data-id');
          const userLayer = userLayers.find(l => l.id === layerId);
          if (userLayer && userLayer.layer) {
            map.fitBounds(userLayer.layer.getBounds());
          }
        } catch (e) {
          console.error("Error zooming to layer bounds:", e);
        }
      });
      
      layerControl.querySelector('.layer-remove-btn').addEventListener('click', function() {
        const layerId = this.getAttribute('data-id');
        removeUserLayer(layerId);
        updateFilterDropdown();
        updateFilterValues();
      });
      
      try {
        map.fitBounds(layer.getBounds());
      } catch (e) {
        console.error("Error zooming to layer bounds:", e);
      }
      
      updateFilterDropdown();
    }
    
    return layer;
  } catch (error) {
    alert('Error adding layer: ' + error.message);
    console.error("Error details:", error);
    return null;
  }
}

function applySimpleStyle(layerId, color) {
  console.log('Applying simple style to layer:', layerId, 'with color:', color);
  const userLayer = userLayers.find(l => l.id === layerId);
  if (!userLayer) return;
  
  userLayer.defaultColor = color;
  
  const hasOnlyPoints = userLayer.layer.getLayers().every(layer => 
    layer.feature && 
    layer.feature.geometry && 
    layer.feature.geometry.type === 'Point'
  );
  
  const hasOnlyLines = userLayer.layer.getLayers().every(layer => 
    layer.feature && 
    layer.feature.geometry && 
    (layer.feature.geometry.type === 'LineString' || layer.feature.geometry.type === 'MultiLineString')
  );
  
  userLayer.layer.eachLayer(layer => {
    if (layer.setStyle) {
      if (hasOnlyPoints && layer.setRadius) {
        layer.setStyle({
          radius: 3,
          fillColor: color,
          color: color,
          weight: 1,
          opacity: 0.75,
          fillOpacity: 0.75
        });
      } else if (hasOnlyLines) {
        layer.setStyle({
          color: color,
          weight: 3,
          opacity: 0.75,
          fillOpacity: 0
        });
      } else {
        layer.setStyle({
          color: color,
          fillColor: color,
          weight: 3,
          opacity: 0.75,
          fillOpacity: 0
        });
      }
    }
  });
}

function openStyleDialog(layerId) {
  console.log('Opening style dialog for layer:', layerId);
  const userLayer = userLayers.find(l => l.id === layerId);
  if (!userLayer) return;

  const existingPickers = document.querySelectorAll('input[type="color"].style-color-picker');
  existingPickers.forEach(picker => picker.parentNode.removeChild(picker));

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = userLayer.defaultColor || '#000000';
  colorPicker.className = 'style-color-picker';
  colorPicker.style.position = 'fixed';
  colorPicker.style.zIndex = '1000';

  const styleButton = document.querySelector(`.layer-style-btn[data-id="${layerId}"]`);
  if (styleButton) {
    const rect = styleButton.getBoundingClientRect();
    colorPicker.style.left = `${rect.right-60}px`;
    colorPicker.style.top = `${rect.top}px`;
    document.body.appendChild(colorPicker);
  } else {
    document.body.appendChild(colorPicker);
  }

  colorPicker.addEventListener('change', function() {
    applySimpleStyle(layerId, this.value);
    document.body.removeChild(this);
  });

  document.addEventListener('click', function closeColorPicker(e) {
    if (e.target !== colorPicker && e.target !== styleButton) {
      if (colorPicker.parentNode) colorPicker.parentNode.removeChild(colorPicker);
      document.removeEventListener('click', closeColorPicker);
    }
  });

  setTimeout(() => colorPicker.click(), 100);
}

function setupDrawingTools() {
  console.log('Setting up drawing tools...');
  
  const drawPointBtn = document.getElementById('drawPointBtn');
  const drawLineBtn = document.getElementById('drawLineBtn');
  const drawPolygonBtn = document.getElementById('drawPolygonBtn');
  const editLayerBtn = document.getElementById('editLayerBtn');
  const deleteLayerBtn = document.getElementById('deleteLayerBtn');
  const saveDrawingBtn = document.getElementById('saveDrawingBtn');
  const drawingNameInput = document.getElementById('drawingNameInput');
  const saveDrawingContainer = document.getElementById('save-drawing-container');
  
  
  let originalLayerState = null;
  let hasUnsavedChanges = false;
  
  if (saveDrawingContainer) {
    saveDrawingContainer.style.display = 'none';
  }
  
  if (!drawFeatureGroup) {
    drawFeatureGroup = L.featureGroup().addTo(map);
  }
  
  const drawControl = new L.Control.Draw({
    draw: {
      polyline: {
        shapeOptions: {
          color: '#3388ff',
          weight: 4
        }
      },
      polygon: {
        shapeOptions: {
          color: '#3388ff',
          fillColor: '#3388ff',
          fillOpacity: 0.2
        },
        allowIntersection: false
      },
      circle: false,
      rectangle: false,
      marker: {}
    },
    edit: {
      featureGroup: drawFeatureGroup
    }
  });
  
  function resetAllModes() {
    if (drawPointBtn) drawPointBtn.classList.remove('active');
    if (drawLineBtn) drawLineBtn.classList.remove('active');
    if (drawPolygonBtn) drawPolygonBtn.classList.remove('active');
    if (editLayerBtn) editLayerBtn.classList.remove('active');
    if (deleteLayerBtn) deleteLayerBtn.classList.remove('active');
    
    isDrawingActive = false;
    currentDrawType = null;
    activeShapeMode = null;
    activeActionMode = null;
    
    if (map.drawHandler) {
      map.off('click', map.drawHandler);
      map.drawHandler = null;
    }
    
    if (map.activeDrawingTool) {
      map.activeDrawingTool.disable();
      map.activeDrawingTool = null;
    }
    
    const instructions = document.getElementById('drawing-instructions');
    if (instructions) {
      instructions.style.display = 'none';
    }
  
    userLayers.forEach(userLayer => {
      if (userLayer.editEnabled && userLayer.layer) {
        userLayer.layer.eachLayer(layer => {
          if (layer.editing && layer.editing.enabled()) {
            layer.editing.disable();
          }
        });
        userLayer.editEnabled = false;
      }
    });
      
    drawFeatureGroup.eachLayer(layer => {
      if (layer.editing && layer.editing.enabled()) {
        layer.editing.disable();
      }
    });
    
    map.getContainer().style.cursor = '';
    
    if (saveDrawingContainer) {
      saveDrawingContainer.style.display = 'none';
    }
    
    if (drawingNameInput) {
      drawingNameInput.disabled = false;
      drawingNameInput.style.opacity = '1';
      drawingNameInput.style.backgroundColor = '#ffffff';
      drawingNameInput.value = '';
    }
    
    const saveDrawingBtn = document.getElementById('saveDrawingBtn');
    if (saveDrawingBtn) {
      saveDrawingBtn.disabled = false;
    }
    
    originalLayerState = null;
    hasUnsavedChanges = false;
    currentEditingUserLayer = null;
  }
  
  function resetShapeModes() {
    if (drawPointBtn) drawPointBtn.classList.remove('active');
    if (drawLineBtn) drawLineBtn.classList.remove('active');
    if (drawPolygonBtn) drawPolygonBtn.classList.remove('active');
    
    if (map.drawHandler && activeShapeMode === 'marker') {
      map.off('click', map.drawHandler);
      map.drawHandler = null;
    }
    
    if (map.activeDrawingTool && (activeShapeMode === 'polyline' || activeShapeMode === 'polygon')) {
      map.activeDrawingTool.disable();
      map.activeDrawingTool = null;
    }
    
    activeShapeMode = null;
    
    updateDrawingNameInputState();
  }
  
  function resetActionModes() {
    if (editLayerBtn) editLayerBtn.classList.remove('active');
    if (deleteLayerBtn) deleteLayerBtn.classList.remove('active');
    
    userLayers.forEach(userLayer => {
      if (userLayer.editEnabled && userLayer.layer) {
        userLayer.layer.eachLayer(layer => {
          if (layer.editing && layer.editing.enabled()) {
            layer.editing.disable();
          }
        });
        userLayer.editEnabled = false;
      }
    });
    
    drawFeatureGroup.eachLayer(layer => {
      if (layer.editing && layer.editing.enabled()) {
        layer.editing.disable();
      }
      
      if (activeActionMode === 'delete') {
        if (layer._deleteHandlerFunc) {
          layer.off('click', layer._deleteHandlerFunc);
          delete layer._deleteHandlerFunc;
        }
        layer.off('click');
      } else if (activeActionMode === 'edit') {
        layer.off('click');
      }
    });
    
    if (activeActionMode === 'delete') {
      userLayers.forEach(userLayer => {
        if (userLayer.layer) {
          userLayer.layer.eachLayer(layer => {
            if (layer._deleteHandlerFunc) {
              layer.off('click', layer._deleteHandlerFunc);
              delete layer._deleteHandlerFunc;
            }
            layer.off('click');
          });
        }
      });
    } else if (activeActionMode === 'edit') {
      userLayers.forEach(userLayer => {
        if (userLayer.layer) {
          userLayer.layer.eachLayer(layer => {
            layer.off('click');
          });
        }
        userLayer.editEnabled = false;
      });
    }
    
    const previousActionMode = activeActionMode;
    activeActionMode = null;
    currentEditingUserLayer = null;
    
    updateDrawingNameInputState();
    
    if (activeShapeMode) {
      updateDrawingInstructions();
    }
  }
  
  function updateDrawingInstructions() {
    const instructions = document.getElementById('drawing-instructions');
    if (!instructions) return;
    
    let instructionText = '';
    
    if (activeShapeMode === 'marker') {
      instructionText = 'Click on map to place points.';
    } else if (activeShapeMode === 'polyline') {
      instructionText = 'Click to draw line. Double-click to finish line.';
    } else if (activeShapeMode === 'polygon') {
      instructionText = 'Click to start drawing polygon. Close shape to finish.';
    }
    
    if (activeActionMode === 'edit') {
      if (instructionText) instructionText += ' ';
      instructionText += 'Click a feature to edit. Drag handles to modify.';
    } else if (activeActionMode === 'delete') {
      if (instructionText) instructionText += ' ';
      instructionText += 'Click features to delete them.';
    }
    
    instructionText += ' Click Save when finished or ESC to cancel ' + 
      (activeShapeMode && activeActionMode ? 'current action' : 'drawing');
    
    instructions.textContent = instructionText;
    instructions.style.display = 'block';
  }
  
  function saveOriginalState() {
    if (currentEditingUserLayer) {
      originalLayerState = {
        id: currentEditingUserLayer.id,
        name: currentEditingUserLayer.name,
        data: JSON.parse(JSON.stringify(currentEditingUserLayer.originalData))
      };
    } else {
      const drawnItemsGeoJSON = drawFeatureGroup.toGeoJSON();
      originalLayerState = {
        drawn: true,
        data: JSON.parse(JSON.stringify(drawnItemsGeoJSON))
      };
    }
    
    userLayers.forEach(userLayer => {
      if (userLayer.layer && map.hasLayer(userLayer.layer)) {
        userLayer._originalState = JSON.parse(JSON.stringify(userLayer.layer.toGeoJSON()));
      }
    });
    
    hasUnsavedChanges = false;
  }
  
  function restoreOriginalState() {
    if (!originalLayerState && !hasUnsavedChanges) return;
  
    if (activeActionMode === 'delete' || activeActionMode === 'edit') {
      userLayers.forEach(userLayer => {
        if (userLayer._originalState && userLayer.layer) {
          map.removeLayer(userLayer.layer);
          
          userLayer.layer = L.geoJSON(userLayer._originalState, {
            style: function() {
              return userLayer.originalStyle || {
                color: userLayer.defaultColor,
                weight: 2,
                opacity: 0.7,
                fillOpacity: 0.3
              };
            },
            onEachFeature: function(feature, layer) {
              if (feature.properties) {
                let popupContent = '<table class="popup-table">';
                popupContent += '<tr><th>Property</th><th>Value</th></tr>';
                
                for (const [key, value] of Object.entries(feature.properties)) {
                  if (value !== null && value !== undefined) {
                    popupContent += `<tr><td>${key}</td><td>${value}</td></tr>`;
                  }
                }
                
                popupContent += '</table>';
                layer.bindPopup(popupContent);
              }
            },
            pointToLayer: function(feature, latlng) {
              return L.circleMarker(latlng, {
                radius: userLayer.pointSize || 8,
                fillColor: userLayer.fillColor || userLayer.defaultColor,
                color: userLayer.outlineColor || '#000',
                weight: userLayer.outlineWidth || 1,
                opacity: userLayer.outlineOpacity || 1,
                fillOpacity: userLayer.fillOpacity || 0.8
              });
            }
          }).addTo(map);
          
          delete userLayer._originalState;
        }
      });
    }
    
    if (originalLayerState) {
      if (originalLayerState.id && originalLayerState.data) {
        const userLayer = userLayers.find(l => l.id === originalLayerState.id);
        
        if (userLayer) {
          userLayer.originalData = JSON.parse(JSON.stringify(originalLayerState.data));
          userLayer.name = originalLayerState.name;
          
          if (map.hasLayer(userLayer.layer)) {
            map.removeLayer(userLayer.layer);
          }
          
          userLayer.layer = L.geoJSON(userLayer.originalData, {
            style: function() {
              return userLayer.originalStyle || {
                color: userLayer.defaultColor,
                weight: 2,
                opacity: 0.7,
                fillOpacity: 0.3
              };
            },
            onEachFeature: function(feature, layer) {
              if (feature.properties) {
                let popupContent = '<table class="popup-table">';
                popupContent += '<tr><th>Property</th><th>Value</th></tr>';
                
                for (const [key, value] of Object.entries(feature.properties)) {
                  if (value !== null && value !== undefined) {
                    popupContent += `<tr><td>${key}</td><td>${value}</td></tr>`;
                  }
                }
                
                popupContent += '</table>';
                layer.bindPopup(popupContent);
              }
            },
            pointToLayer: function(feature, latlng) {
              return L.circleMarker(latlng, {
                radius: userLayer.pointSize || 8,
                fillColor: userLayer.fillColor || userLayer.defaultColor,
                color: userLayer.outlineColor || '#000',
                weight: userLayer.outlineWidth || 1,
                opacity: userLayer.outlineOpacity || 1,
                fillOpacity: userLayer.fillOpacity || 0.8
              });
            }
          }).addTo(map);
        }
      } else if (originalLayerState.drawn) {
        drawFeatureGroup.clearLayers();
        
        L.geoJSON(originalLayerState.data, {
          onEachFeature: (feature, layer) => {
            drawFeatureGroup.addLayer(layer);
          }
        });
      }
    }
    
    originalLayerState = null;
    currentEditingUserLayer = null;
    currentDrawingLayer = null;
    hasUnsavedChanges = false;
  }
  
  function updateDrawingNameInputState() {
    const drawingNameInput = document.getElementById('drawingNameInput');
    const saveDrawingBtn = document.getElementById('saveDrawingBtn');
    
    if (!drawingNameInput || !saveDrawingBtn) return;
    
    if (currentEditingUserLayer) {
      drawingNameInput.disabled = true;
      drawingNameInput.style.opacity = '0.6';
      drawingNameInput.style.backgroundColor = '#f0f0f0';
      drawingNameInput.value = currentEditingUserLayer.name || '';
      saveDrawingBtn.disabled = activeActionMode === 'delete';
    } 
    else if (activeShapeMode || hasUnsavedChanges) {
      drawingNameInput.disabled = false;
      drawingNameInput.style.opacity = '1';
      drawingNameInput.style.backgroundColor = '#ffffff';
      if (!drawingNameInput.value) {
        drawingNameInput.value = `User Layer ${userLayerCount + 1}`;
      }
      saveDrawingBtn.disabled = activeActionMode === 'delete';
    } 
    else if (activeActionMode && !activeShapeMode) {
      drawingNameInput.disabled = true;
      drawingNameInput.style.opacity = '0.6';
      drawingNameInput.style.backgroundColor = '#f0f0f0';
      saveDrawingBtn.disabled = activeActionMode === 'delete' ? true : !hasUnsavedChanges;
    }
    else {
      drawingNameInput.disabled = false;
      drawingNameInput.style.opacity = '1';
      drawingNameInput.style.backgroundColor = '#ffffff';
      drawingNameInput.value = '';
      saveDrawingBtn.disabled = false;
    }
    
    const saveDrawingContainer = document.getElementById('save-drawing-container');
    if (saveDrawingContainer) {
      saveDrawingContainer.style.display = (activeShapeMode || activeActionMode || hasUnsavedChanges) ? 'flex' : 'none';
    }
  }
  
  function isDrawingOrActionActive() {
    return activeShapeMode !== null || activeActionMode !== null;
  }
  
  function enableEditMode() {
    saveOriginalState();
    
    if (map.drawHandler) {
      map.off('click', map.drawHandler);
      map.drawHandler = null;
    }
    
    if (map.activeDrawingTool) {
      map.activeDrawingTool.disable();
      map.activeDrawingTool = null;
    }
    
    drawFeatureGroup.eachLayer(layer => {
      if (layer.editing) {
        layer.editing.enable();
        
        layer.on('click', function(e) {
          L.DomEvent.stopPropagation(e);
          currentDrawingLayer = this;
          
          if (drawingNameInput) {
            drawingNameInput.value = 'Drawn Feature';
          }
        });
      }
    });
    
    userLayers.forEach(userLayer => {
      if (userLayer.layer && map.hasLayer(userLayer.layer)) {
        userLayer.layer.eachLayer(layer => {
          if (layer.editing) {
            layer.editing.enable();
            userLayer.editEnabled = true;
            
            layer.on('click', function(e) {
              L.DomEvent.stopPropagation(e);
              currentDrawingLayer = this;
              currentEditingUserLayer = userLayer;
              hasUnsavedChanges = true;
              
              updateDrawingNameInputState();
            });
          }
        });
      }
    });
    
    map.getContainer().style.cursor = 'pointer';
    
    updateDrawingNameInputState();
  }
  
  function setupDeleteHandlers() {
    saveOriginalState();
    
    if (map.drawHandler) {
      map.off('click', map.drawHandler);
      map.drawHandler = null;
    }
    
    if (map.activeDrawingTool) {
      map.activeDrawingTool.disable();
      map.activeDrawingTool = null;
    }
    
    drawFeatureGroup.eachLayer(layer => {
      layer.off('click');
      
      const clickHandler = function(e) {
        L.DomEvent.stopPropagation(e);
        
        drawFeatureGroup.removeLayer(this);
        hasUnsavedChanges = true;
        
        if (currentDrawingLayer === this) {
          currentDrawingLayer = null;
        }
        
        updateDrawingNameInputState();
      };
      
      layer._deleteHandlerFunc = clickHandler;
      layer.on('click', clickHandler);
    });
    
    userLayers.forEach(userLayer => {
      if (userLayer.layer && map.hasLayer(userLayer.layer)) {
        const originalFeatureCollection = userLayer.layer.toGeoJSON();
        userLayer._originalState = JSON.parse(JSON.stringify(originalFeatureCollection));
        
        userLayer.layer.eachLayer(layer => {
          layer.off('click');
          
          const clickHandler = function(e) {
            L.DomEvent.stopPropagation(e);
            
            if (!currentEditingUserLayer) {
              currentEditingUserLayer = userLayer;
              updateDrawingNameInputState();
            }
            
            userLayer.layer.removeLayer(this);
            hasUnsavedChanges = true;
            
            if (currentDrawingLayer === this) {
              currentDrawingLayer = null;
            }
          };
          
          layer._deleteHandlerFunc = clickHandler;
          layer.on('click', clickHandler);
        });
      }
    });
    
    map.getContainer().style.cursor = 'pointer';
    
    const saveDrawingBtn = document.getElementById('saveDrawingBtn');
    if (saveDrawingBtn) {
      saveDrawingBtn.disabled = true;
    }
  }
  
  function hasFeaturesToEditOrDelete() {
    const hasDrawnFeatures = drawFeatureGroup.getLayers().length > 0;
    const hasUserLayers = userLayers.some(layer => 
      layer.layer && map.hasLayer(layer.layer) && layer.layer.getLayers().length > 0
    );
    
    return hasDrawnFeatures || hasUserLayers;
  }

  if (drawPointBtn) {
    drawPointBtn.addEventListener('click', function() {
      if (activeShapeMode === 'marker') {
        resetShapeModes();
        if (!activeActionMode) {
          isDrawingActive = false;
          currentDrawType = null;
          if (saveDrawingContainer) saveDrawingContainer.style.display = 'none';
          
          const instructions = document.getElementById('drawing-instructions');
          if (instructions) instructions.style.display = 'none';
        } else {
          updateDrawingInstructions();
        }
        return;
      }
      
      resetShapeModes();
      
      this.classList.add('active');
      isDrawingActive = true;
      currentDrawType = 'marker';
      activeShapeMode = 'marker';
      
      if (saveDrawingContainer) {
        saveDrawingContainer.style.display = 'flex';
      }
      
      map.drawHandler = function(e) {
        const marker = L.marker(e.latlng).addTo(drawFeatureGroup);
        
        if (activeActionMode === 'delete') {
          marker.on('click', function(evt) {
            L.DomEvent.stopPropagation(evt);
            drawFeatureGroup.removeLayer(marker);
            hasUnsavedChanges = true;
          });
        }
        
        if (activeActionMode === 'edit' && marker.editing) {
          marker.editing.enable();
          marker.on('click', function() {
            currentDrawingLayer = this;
            if (drawingNameInput) {
              drawingNameInput.value = 'Drawn Feature';
            }
          });
        }
        
        hasUnsavedChanges = true;
      };
      
      map.on('click', map.drawHandler);
      
      updateDrawingInstructions();
      updateDrawingNameInputState();
    });
  }
  
  if (drawLineBtn) {
    drawLineBtn.addEventListener('click', function() {
      if (activeShapeMode === 'polyline') {
        resetShapeModes();
        if (!activeActionMode) {
          isDrawingActive = false;
          currentDrawType = null;
          if (saveDrawingContainer) saveDrawingContainer.style.display = 'none';
          
          const instructions = document.getElementById('drawing-instructions');
          if (instructions) instructions.style.display = 'none';
        } else {
          updateDrawingInstructions();
        }
        return;
      }
      
      resetShapeModes();
      
      this.classList.add('active');
      isDrawingActive = true;
      currentDrawType = 'polyline';
      activeShapeMode = 'polyline';
      
      if (saveDrawingContainer) {
        saveDrawingContainer.style.display = 'flex';
      }
      
      map.activeDrawingTool = new L.Draw.Polyline(map, drawControl.options.draw.polyline);
      map.activeDrawingTool.enable();
      
      updateDrawingInstructions();
      updateDrawingNameInputState();
    });
  }
  
  if (drawPolygonBtn) {
    drawPolygonBtn.addEventListener('click', function() {
      if (activeShapeMode === 'polygon') {
        resetShapeModes();
        if (!activeActionMode) {
          isDrawingActive = false;
          currentDrawType = null;
          if (saveDrawingContainer) saveDrawingContainer.style.display = 'none';
          
          const instructions = document.getElementById('drawing-instructions');
          if (instructions) instructions.style.display = 'none';
        } else {
          updateDrawingInstructions();
        }
        return;
      }
      
      resetShapeModes();
      
      this.classList.add('active');
      isDrawingActive = true;
      currentDrawType = 'polygon';
      activeShapeMode = 'polygon';
      
      if (saveDrawingContainer) {
        saveDrawingContainer.style.display = 'flex';
      }
      
      map.activeDrawingTool = new L.Draw.Polygon(map, drawControl.options.draw.polygon);
      map.activeDrawingTool.enable();
      
      updateDrawingInstructions();
      updateDrawingNameInputState();
    });
  }

  if (editLayerBtn) {
    editLayerBtn.addEventListener('click', function() {
      if (activeActionMode === 'edit') {
        resetActionModes();
        if (!activeShapeMode) {
          isDrawingActive = false;
          currentDrawType = null;
          if (saveDrawingContainer) saveDrawingContainer.style.display = 'none';
          
          const instructions = document.getElementById('drawing-instructions');
          if (instructions) instructions.style.display = 'none';
          
          originalLayerState = null;
          currentEditingUserLayer = null;
        } else {
          updateDrawingInstructions();
        }
        return;
      }
      
      if (!hasFeaturesToEditOrDelete()) {
        alert('No features to edit. Draw or upload something first.');
        return;
      }
      
      resetActionModes();
      
      this.classList.add('active');
      isDrawingActive = true;
      activeActionMode = 'edit';
      
      if (saveDrawingContainer) {
        saveDrawingContainer.style.display = 'flex';
      }
      
      enableEditMode();
      
      updateDrawingInstructions();
      updateDrawingNameInputState();
    });
  }
  
  if (deleteLayerBtn) {
    deleteLayerBtn.addEventListener('click', function() {
      if (activeActionMode === 'delete') {
        resetActionModes();
        if (!activeShapeMode) {
          isDrawingActive = false;
          currentDrawType = null;
          if (saveDrawingContainer) saveDrawingContainer.style.display = 'none';
          
          const instructions = document.getElementById('drawing-instructions');
          if (instructions) instructions.style.display = 'none';
          
          originalLayerState = null;
          currentEditingUserLayer = null;
        } else {
          updateDrawingInstructions();
        }
        return;
      }
      
      if (!hasFeaturesToEditOrDelete()) {
        alert('No features to delete. Draw or upload something first.');
        return;
      }
      
      resetActionModes();
      
      this.classList.add('active');
      isDrawingActive = true;
      activeActionMode = 'delete';
      
      if (saveDrawingContainer) {
        saveDrawingContainer.style.display = 'flex';
      }
      
      setupDeleteHandlers();
      
      updateDrawingInstructions();
      updateDrawingNameInputState();
    });
  }
  
  if (saveDrawingBtn) {
    saveDrawingBtn.addEventListener('click', function() {
      const name = drawingNameInput.value.trim() || `Drawing ${userLayerCount + 1}`;
      
      if (currentEditingUserLayer && activeActionMode === 'edit') {
        if (!drawingNameInput.disabled && currentEditingUserLayer.name !== name) {
          currentEditingUserLayer.name = name;
          
          const layerElement = document.querySelector(`.user-layer-item button[data-id="${currentEditingUserLayer.id}"]`).closest('.user-layer-item');
          if (layerElement) {
            const nameSpan = layerElement.querySelector('span');
            if (nameSpan) {
              nameSpan.textContent = name.length > 15 ? name.substring(0, 15) + '...' : name;
              nameSpan.title = name;
            }
          }
        }
        
        const updatedGeoJSON = currentEditingUserLayer.layer.toGeoJSON();
        currentEditingUserLayer.originalData = updatedGeoJSON;
        
        currentEditingUserLayer.editEnabled = false;
        currentEditingUserLayer = null;
        currentDrawingLayer = null;
        originalLayerState = null;
        hasUnsavedChanges = false;
        
        resetAllModes();
        if (drawingNameInput) {
          drawingNameInput.value = '';
          drawingNameInput.disabled = false;
          drawingNameInput.style.opacity = '1';
          drawingNameInput.style.backgroundColor = '#ffffff';
        }
        
        return;
      }
      
      if (drawFeatureGroup.getLayers().length > 0) {
        const drawnItemsGeoJSON = drawFeatureGroup.toGeoJSON();
        
        addUserLayer(drawnItemsGeoJSON, name);
        
        drawFeatureGroup.clearLayers();
        currentDrawingLayer = null;
        originalLayerState = null;
        hasUnsavedChanges = false;
        
        resetAllModes();
        if (drawingNameInput) {
          drawingNameInput.value = '';
          drawingNameInput.disabled = false;
          drawingNameInput.style.opacity = '1';
          drawingNameInput.style.backgroundColor = '#ffffff';
        }
      } else if (activeActionMode === 'edit' && hasUnsavedChanges) {
        resetAllModes();
        if (drawingNameInput) {
          drawingNameInput.value = '';
          drawingNameInput.disabled = false;
          drawingNameInput.style.opacity = '1';
          drawingNameInput.style.backgroundColor = '#ffffff';
        }
        hasUnsavedChanges = false;
        originalLayerState = null;
      } else {
        alert('No features drawn or edited. Please draw or edit something first.');
      }
    });
  }
  
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isDrawingOrActionActive()) {
      e.preventDefault();
      
      if (activeActionMode === 'delete' || activeActionMode === 'edit') {
        restoreOriginalState();
        
        if (activeShapeMode) {
          resetActionModes();
        } else {
          resetAllModes();
        }
      } else if (activeShapeMode) {
        if (hasUnsavedChanges) {
          drawFeatureGroup.clearLayers();
        }
        resetAllModes();
      }
      
      if (!activeShapeMode) {
        currentDrawingLayer = null;
        currentEditingUserLayer = null;
        
        if (drawingNameInput) {
          drawingNameInput.value = '';
          drawingNameInput.disabled = false;
          drawingNameInput.style.opacity = '1';
          drawingNameInput.style.backgroundColor = '#ffffff';
        }
      }
    }
  });
  
  map.on('draw:created', function(e) {
    const layer = e.layer;
    
    let initialAttributes = {...defaultAttributes};
    
    if (currentEditingUserLayer) {
      const existingFeatures = currentEditingUserLayer.layer.getLayers();
      if (existingFeatures.length > 0) {
        const lastFeature = existingFeatures[existingFeatures.length - 1];
        if (lastFeature.feature && lastFeature.feature.properties) {
          initialAttributes = {...lastFeature.feature.properties};
        }
      }
    } else if (drawFeatureGroup.getLayers().length > 0) {
      const lastFeature = drawFeatureGroup.getLayers()[drawFeatureGroup.getLayers().length - 1];
      if (lastFeature.feature && lastFeature.feature.properties) {
        initialAttributes = {...lastFeature.feature.properties};
      }
    }
    
    const feature = layer.toGeoJSON();
    feature.properties = initialAttributes;
    layer.feature = feature;
    
    currentDrawingLayer = layer;
    
    drawFeatureGroup.addLayer(layer);
    
    openAttributeEditor(feature);
    
    hasUnsavedChanges = true;
    
    if (activeActionMode === 'delete') {
      layer.on('click', function(evt) {
        L.DomEvent.stopPropagation(evt);
        drawFeatureGroup.removeLayer(layer);
        hasUnsavedChanges = true;
      });
    }
    
    if (activeActionMode === 'edit' && layer.editing) {
      layer.editing.enable();
      layer.on('click', function() {
        currentDrawingLayer = this;
        if (drawingNameInput && !currentEditingUserLayer) {
          drawingNameInput.value = 'Drawn Feature';
          drawingNameInput.disabled = false;
          drawingNameInput.style.opacity = '1';
          drawingNameInput.style.backgroundColor = '#ffffff';
        }
      });
    }
    
    if (saveDrawingContainer) {
      saveDrawingContainer.style.display = 'flex';
    }
  });
  
  map.on('draw:edited', function(e) {
    if (saveDrawingContainer) {
      saveDrawingContainer.style.display = 'flex';
    }
    hasUnsavedChanges = true;
  });
  
  map.on('draw:deleted', function(e) {
    if (drawFeatureGroup.getLayers().length === 0) {
      if (saveDrawingContainer) {
        saveDrawingContainer.style.display = 'none';
      }
      currentDrawingLayer = null;
    }
    hasUnsavedChanges = true;
  });
}

function openAttributeEditor(feature, layerId) {
  pendingFeature = feature;
  currentUserLayerId = layerId;
  
  currentFeatureAttributes = feature.properties ? {...feature.properties} : {...defaultAttributes};
  
  const container = document.getElementById('attribute-fields-container');
  container.innerHTML = '';
  
  const nameField = document.createElement('div');
  nameField.className = 'attribute-field';
  nameField.innerHTML = `
    <div class="field-row">
      <input type="text" class="attribute-name" value="Name" readonly>
      <input type="text" class="attribute-value" placeholder="Enter name..." value="${currentFeatureAttributes.Name || ''}">
    </div>
  `;
  container.appendChild(nameField);
  
  Object.entries(currentFeatureAttributes).forEach(([key, value]) => {
    if (key !== 'Name') {
      addAttributeField(key, value);
    }
  });
  
  document.getElementById('attribute-editor-modal').style.display = 'block';
}

function addAttributeField(name = '', value = '') {
  const container = document.getElementById('attribute-fields-container');
  const field = document.createElement('div');
  field.className = 'attribute-field';
  field.innerHTML = `
    <div class="field-row">
      <input type="text" class="attribute-name" value="${name}" placeholder="Attribute name">
      <input type="text" class="attribute-value" value="${value}" placeholder="Value">
      <button type="button" class="remove-attribute">&times;</button>
    </div>
  `;
  
  const removeBtn = field.querySelector('.remove-attribute');
  removeBtn.addEventListener('click', function() {
    container.removeChild(field);
  });
  
  container.appendChild(field);
}

function saveAttributes() {
  const attributeFields = document.querySelectorAll('.attribute-field');
  const attributes = {};
  
  attributeFields.forEach(field => {
    const nameInput = field.querySelector('.attribute-name');
    const valueInput = field.querySelector('.attribute-value');
    
    if (nameInput && valueInput && nameInput.value.trim()) {
      attributes[nameInput.value.trim()] = valueInput.value;
    }
  });
  
  if (pendingFeature) {
    pendingFeature.properties = attributes;
    
    if (currentUserLayerId) {
      const userLayer = userLayers.find(l => l.id === currentUserLayerId);
      if (userLayer && userLayer.currentDrawingLayer) {
        userLayer.currentDrawingLayer.feature = pendingFeature;
      }
    }
  }
  
  document.getElementById('attribute-editor-modal').style.display = 'none';
  
  pendingFeature = null;
  currentUserLayerId = null;
  currentFeatureAttributes = {};
  
  if (activeShapeMode) {
    continueDrawing();
  }
}

function cancelAttributeEditing() {
  if (pendingFeature && !pendingFeature.properties && currentUserLayerId) {
    const userLayer = userLayers.find(l => l.id === currentUserLayerId);
    if (userLayer && userLayer.layer && userLayer.currentDrawingLayer) {
      userLayer.layer.removeLayer(userLayer.currentDrawingLayer);
    }
  }
  
  document.getElementById('attribute-editor-modal').style.display = 'none';
  
  pendingFeature = null;
  currentUserLayerId = null;
  currentFeatureAttributes = {};
  
  if (activeShapeMode) {
    continueDrawing();
  }
}

function continueDrawing() {
  if (activeShapeMode === 'marker') {
  } 
  else if (activeShapeMode === 'polyline') {
    const polylineOptions = drawControl && drawControl.options ? 
      drawControl.options.draw.polyline : 
      {
        shapeOptions: {
          color: '#3388ff',
          weight: 4
        }
      };
      
    map.activeDrawingTool = new L.Draw.Polyline(map, polylineOptions);
    map.activeDrawingTool.enable();
  } 
  else if (activeShapeMode === 'polygon') {
    const polygonOptions = drawControl && drawControl.options ? 
      drawControl.options.draw.polygon : 
      {
        shapeOptions: {
          color: '#3388ff',
          fillColor: '#3388ff',
          fillOpacity: 0.2
        },
        allowIntersection: false
      };
      
    map.activeDrawingTool = new L.Draw.Polygon(map, polygonOptions);
    map.activeDrawingTool.enable();
  }
}

function populateUserLayerFilterValues(userLayer, fieldName) {
  console.log('populateUserLayerFilterValues');
  const filterValueContainer = document.getElementById('filterValueContainer');
  const filterCheckboxesSection = document.createElement('div');
  filterCheckboxesSection.className = 'filter-checkboxes-section';
  filterCheckboxesSection.style.marginTop = '10px';
  
  const existingCheckboxes = filterValueContainer.querySelector('.filter-checkboxes-section');
  if (existingCheckboxes) {
    filterValueContainer.removeChild(existingCheckboxes);
  }
  
  if (!fieldName) {
    const filterValueButton = document.getElementById('filterValueButton');
    if (filterValueButton) {
      filterValueButton.textContent = 'All features';
    }
    
    const hiddenDiv = document.createElement('div');
    hiddenDiv.style.display = 'none';
    
    const allFeaturesCheckbox = document.createElement('input');
    allFeaturesCheckbox.type = 'checkbox';
    allFeaturesCheckbox.id = 'all-features-filter';
    allFeaturesCheckbox.checked = true;
    allFeaturesCheckbox.className = 'filter-value-checkbox';
    allFeaturesCheckbox.value = 'All features';
    
    hiddenDiv.appendChild(allFeaturesCheckbox);
    filterCheckboxesSection.appendChild(hiddenDiv);
    filterValueContainer.appendChild(filterCheckboxesSection);

    updateSummaryStatistics(getCurrentFeatures());
    
    if (document.getElementById('highlightAreaCheckbox').checked) {
      highlightSelectedArea();
    }
    
    return;
  }

  const uniqueValues = new Set();
  userLayer.layer.eachLayer(layer => {
    if (layer.feature && layer.feature.properties && 
        layer.feature.properties[fieldName] !== undefined) {
      uniqueValues.add(String(layer.feature.properties[fieldName]));
    }
  });
  
  const values = Array.from(uniqueValues).sort();
  
  const selectAllLabel = document.createElement('label');
  selectAllLabel.className = 'checkbox-label';
  
  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.id = 'select-all-filter';
  selectAllCheckbox.checked = true;
  
  const selectAllSpan = document.createElement('span');
  selectAllSpan.innerHTML = '<i>Select/Deselect All</i>';
  
  selectAllLabel.appendChild(selectAllCheckbox);
  selectAllLabel.appendChild(selectAllSpan);
  filterCheckboxesSection.appendChild(selectAllLabel);
  
  const checkboxes = [];
  values.forEach((value, index) => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `filter-${value.toString().replace(/\s+/g, '-').replace(/[^\w-]/g, '')}`;
    checkbox.value = value;
    checkbox.checked = true;
    checkbox.className = 'filter-value-checkbox';
    checkboxes.push(checkbox);
    
    const span = document.createElement('span');
    span.textContent = value;
    
    label.appendChild(checkbox);
    label.appendChild(span);
    filterCheckboxesSection.appendChild(label);
    
    checkbox.addEventListener('change', function() {
      updateFilterButtonText();
      updateSummaryStatistics(getCurrentFeatures());
      
      if (document.getElementById('highlightAreaCheckbox').checked) {
        highlightSelectedArea();
      }
    });
  });
  
  selectAllCheckbox.addEventListener('change', function() {
    const isChecked = this.checked;
    checkboxes.forEach(cb => cb.checked = isChecked);
    updateFilterButtonText();
    updateSummaryStatistics(getCurrentFeatures());
    
    if (document.getElementById('highlightAreaCheckbox').checked) {
      highlightSelectedArea();
    }
  });
  
  function updateFilterButtonText() {
    const selectedValues = checkboxes
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    
    const filterValueButton = document.getElementById('filterValueButton');
    if (filterValueButton) {
      if (selectedValues.length === 0) {
        filterValueButton.textContent = '\u00A0';
      } else if (selectedValues.length === 1) {
        filterValueButton.textContent = selectedValues[0];
      } else if (selectedValues.length === values.length) {
        filterValueButton.textContent = 'All Values';
      } else {
        filterValueButton.textContent = `${selectedValues.length} values selected`;
      }
    }
  }
  
  filterValueContainer.appendChild(filterCheckboxesSection);
  updateFilterButtonText();
  
  updateSummaryStatistics(getCurrentFeatures());
  
  if (document.getElementById('highlightAreaCheckbox').checked) {
    highlightSelectedArea();
  }
}

function detectAndFixProjection(data) {
  if (!data || !data.features || !data.features.length) return data;
  
  const result = JSON.parse(JSON.stringify(data));
  
  const checkSampleCoordinates = () => {
    for (let i = 0; i < Math.min(5, data.features.length); i++) {
      const feature = data.features[i];
      if (!feature.geometry || !feature.geometry.coordinates) continue;
      
      let coord;
      if (feature.geometry.type === 'Point') {
        coord = feature.geometry.coordinates;
      } else if (['LineString', 'MultiPoint'].includes(feature.geometry.type)) {
        coord = feature.geometry.coordinates[0];
      } else if (['Polygon', 'MultiLineString'].includes(feature.geometry.type)) {
        coord = feature.geometry.coordinates[0][0];
      } else if (feature.geometry.type === 'MultiPolygon') {
        coord = feature.geometry.coordinates[0][0][0];
      }
      
      if (coord) {
        if (coord[0] > 100000 && coord[0] < 700000 && 
            coord[1] > 0 && coord[1] < 1300000) {
          return 'EPSG:27700';
        }
        else if (Math.abs(coord[0]) > 180 || Math.abs(coord[1]) > 90) {
          return 'EPSG:3857';
        }
      }
    }
    return false;
  };
  
  const projectionType = checkSampleCoordinates();
  
  if (projectionType) {    
    const sourceCrs = projectionType === 'EPSG:27700' 
      ? new L.Proj.CRS('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs')
      : L.CRS.EPSG3857;
    
    const targetCrs = L.CRS.EPSG4326;
    
    for (let i = 0; i < result.features.length; i++) {
      const feature = result.features[i];
      if (!feature.geometry || !feature.geometry.coordinates) continue;
      
      if (feature.geometry.type === 'Point') {
        const point = L.point(feature.geometry.coordinates[0], feature.geometry.coordinates[1]);
        const latLng = sourceCrs.unproject(point);
        feature.geometry.coordinates = [latLng.lng, latLng.lat];
      } 
      else if (['LineString', 'MultiPoint'].includes(feature.geometry.type)) {
        feature.geometry.coordinates = feature.geometry.coordinates.map(coord => {
          const point = L.point(coord[0], coord[1]);
          const latLng = sourceCrs.unproject(point);
          return [latLng.lng, latLng.lat];
        });
      }
      else if (['Polygon', 'MultiLineString'].includes(feature.geometry.type)) {
        feature.geometry.coordinates = feature.geometry.coordinates.map(ring => 
          ring.map(coord => {
            const point = L.point(coord[0], coord[1]);
            const latLng = sourceCrs.unproject(point);
            return [latLng.lng, latLng.lat];
          })
        );
      }
      else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates = feature.geometry.coordinates.map(polygon => 
          polygon.map(ring => ring.map(coord => {
            const point = L.point(coord[0], coord[1]);
            const latLng = sourceCrs.unproject(point);
            return [latLng.lng, latLng.lat];
          }))
        );
      }
    }
  }
  
  return result;
}

function removeUserLayer(layerId) {
  const layerIndex = userLayers.findIndex(l => l.id === layerId);
  if (layerIndex > -1) {
    const layer = userLayers[layerIndex];
    map.removeLayer(layer.layer);
    userLayers.splice(layerIndex, 1);
    
    const layerElement = document.querySelector(`.user-layer-item button[data-id="${layerId}"]`).closest('.user-layer-item');
    if (layerElement) {
      layerElement.remove();
    }
    
    updateFilterDropdown();
    
    if (filterTypeDropdown.value === `UserLayer_${layerId}`) {
      filterTypeDropdown.value = AmenitiesCatchmentLayer ? 'Range' : 'LA';
      updateFilterValues();
    }
  }
}

function isPanelOpen(panelName) {
  const panelHeaders = document.querySelectorAll(".panel-header:not(.summary-header)");
  for (const header of panelHeaders) {
    if (header.textContent.includes(panelName) && !header.classList.contains("collapsed")) {
      return true;
    }
  }
  return false;
}

function initializeAndConfigureSlider(sliderElement, isInverse = false) {
  if (sliderElement.noUiSlider) {
    sliderElement.noUiSlider.destroy();
  }

  const isInitialSetup = true;

  noUiSlider.create(sliderElement, {
    start: ['', ''],
    connect: [true, true, true],
    range: {
      'min': 0,
      'max': 0
    },
    step: 1,
    tooltips: false,
    format: {
      to: value => parseFloat(value),
      from: value => parseFloat(value)
    }
  });

  const handles = sliderElement.querySelectorAll('.noUi-handle');
  if (handles.length > 0) {
    if (isInverse === false) {
      handles[0].classList.add('noUi-handle-transparent');
    }
    
    if (handles.length > 1) {
      if (isInverse === true) {
        handles[1].classList.add('noUi-handle-transparent');
      }
      handles[0].classList.add('noUi-handle-lower');
      handles[1].classList.add('noUi-handle-upper');
    }
  }

  const connectElements = sliderElement.querySelectorAll('.noUi-connect');
  if (connectElements.length > 2) {
    if (isInverse) {
      connectElements[0].classList.add('noUi-connect-dark-grey');
      connectElements[1].classList.add('noUi-connect-gradient-left');
    } else {
      connectElements[1].classList.add('noUi-connect-gradient-right');
      connectElements[2].classList.add('noUi-connect-dark-grey');
    }
  }

  sliderElement._isInitialized = false;

  sliderElement.noUiSlider.on('update', function (values, handle) {
    const handleElement = handles[handle];
    const step = sliderElement.noUiSlider.options.step;
    const formattedValue = formatValue(values[handle], step);
    handleElement.setAttribute('data-value', formattedValue);
    
    if (sliderElement._isInitialized) {
      requestAnimationFrame(() => {
        debouncedUpdateOpacityOutlineFields();
      });
    }
  });

  setTimeout(() => {
    sliderElement._isInitialized = true;
  }, 100);
}

function updateSliderRanges(type, scaleType) {
  console.log('Updating slider ranges...');

  if (isUpdatingSliders) return;
  isUpdatingSliders = true;

  let field, rangeElement, minElement, maxElement, isInverse;

  if (scaleType === 'Opacity') {
    field = AmenitiesOpacity.value;
    rangeElement = AmenitiesOpacityRange;
    minElement = document.getElementById('opacityRangeAmenitiesMin');
    maxElement = document.getElementById('opacityRangeAmenitiesMax');
    isInverse = isInverseAmenitiesOpacity;
  } else if (scaleType === 'Outline') {
    field = AmenitiesOutline.value;
    rangeElement = AmenitiesOutlineRange;
    minElement = document.getElementById('outlineRangeAmenitiesMin');
    maxElement = document.getElementById('outlineRangeAmenitiesMax');
    isInverse = isInverseAmenitiesOutline;
  }

  const wasInitialized = rangeElement._isInitialized;

  if (rangeElement.noUiSlider) {
    rangeElement.noUiSlider.destroy();
  }
  
  rangeElement._isInitialized = false;
  
  initializeAndConfigureSlider(rangeElement, isInverse);
  
  if (field !== "None" && gridStatistics && gridStatistics[field]) {
    const minValue = gridStatistics[field].min;
    const maxValue = gridStatistics[field].max;
    
    const roundedMaxValue = Math.pow(10, Math.ceil(Math.log10(maxValue)));
    let step = roundedMaxValue / 100;

    if (isNaN(step) || step <= 0) {
      step = 1;
    }

    const adjustedMaxValue = Math.ceil(maxValue / step) * step;
    const adjustedMinValue = Math.floor(minValue / step) * step;
    
    if (field === "None") {
      rangeElement.setAttribute('disabled', true);
      rangeElement.noUiSlider.updateOptions({
        range: {
          'min': 0,
          'max': 0
        },
        step: 1
      }, false);
      rangeElement.noUiSlider.set(['', ''], false);
      minElement.innerText = '';
      maxElement.innerText = '';
    } else {
      rangeElement.removeAttribute('disabled');
      rangeElement.noUiSlider.updateOptions({
        range: {
          'min': adjustedMinValue,
          'max': adjustedMaxValue
        },
        step: step
      }, false);
      rangeElement.noUiSlider.set([adjustedMinValue, adjustedMaxValue], false);
      minElement.innerText = formatValue(adjustedMinValue, step);
      maxElement.innerText = formatValue(adjustedMaxValue, step);
    }
  }
  
  if (wasInitialized && field !== "None") {
    setTimeout(() => {
      rangeElement._isInitialized = true;
      debouncedUpdateOpacityOutlineFields();
    }, 200);
  } else {
    setTimeout(() => {
      rangeElement._isInitialized = true;
    }, 200);
  }
  
  isUpdatingSliders = false;
}

function toggleInverseScale(type, scaleType) {
  console.log('Toggling inverse scale...');
  
  let isInverse, rangeElement;

  if (scaleType === 'Opacity') {
    isInverseAmenitiesOpacity = !isInverseAmenitiesOpacity;
    isInverse = isInverseAmenitiesOpacity;
    rangeElement = AmenitiesOpacityRange;
    opacityAmenitiesOrder = isInverse ? 'high-to-low' : 'low-to-high';
  } else if (scaleType === 'Outline') {
    isInverseAmenitiesOutline = !isInverseAmenitiesOutline;
    isInverse = isInverseAmenitiesOutline;
    rangeElement = AmenitiesOutlineRange;
    outlineAmenitiesOrder = isInverse ? 'high-to-low' : 'low-to-high';
  }

  const currentValues = rangeElement.noUiSlider ? rangeElement.noUiSlider.get() : ['', ''];
  
  updateSliderRanges(type, scaleType);
  
  if (rangeElement.noUiSlider) {
    rangeElement.noUiSlider.set(currentValues, false);
  }
}

function scaleExp(value, minVal, maxVal, minScale, maxScale, order) {
  if (value <= minVal) return order === 'low-to-high' ? minScale : maxScale;
  if (value >= maxVal) return order === 'low-to-high' ? maxScale : minScale;
  const normalizedValue = (value - minVal) / (maxVal - minVal);
  const scaledValue = order === 'low-to-high' ? normalizedValue : 1 - normalizedValue;
  return minScale + scaledValue * (maxScale - minScale);
}

function formatValue(value, step) {
  if (value === null || value === undefined || isNaN(value) || value === Infinity || value === -Infinity) {
    return '-';
  }

  if (step >= 100) {
    return (Math.round(value / 100) * 100)
      .toLocaleString(undefined, { maximumFractionDigits: 0 });
  } else if (step >= 10) {
    return (Math.round(value / 10) * 10)
      .toLocaleString(undefined, { maximumFractionDigits: 0 });
  } else if (step >= 1) {
    return Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
  } else if (step >= 0.1) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  } else if (step >= 0.01) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    return value.toString();
  }
}

function isClassVisible(value, selectedYear) {
  const legendCheckboxes = document.querySelectorAll('.legend-checkbox');
  for (const checkbox of legendCheckboxes) {
    const range = checkbox.getAttribute('data-range');
    const isChecked = checkbox.checked;

    if (selectedYear.includes('-')) {
      if (range.includes('<=') && !range.includes('>') && value <= parseFloat(range.split('<=')[1]) / 100 && !isChecked) {
        return false;
      } else if (range.includes('>=') && !range.includes('<') && value >= parseFloat(range.split('>=')[1]) / 100 && !isChecked) {
        return false;
      } else if (range.includes('>') && range.includes('<=') && value > parseFloat(range.split('>')[1]) / 100 && value <= parseFloat(range.split('<=')[1]) / 100 && !isChecked) {
        return false;
      } else if (range.includes('>=') && range.includes('<') && value >= parseFloat(range.split('>=')[1]) / 100 && value < parseFloat(range.split('<')[1]) / 100 && !isChecked) {
        return false;
      } else if (range.includes('>') && range.includes('<') && value > parseFloat(range.split('>')[1]) / 100 && value < parseFloat(range.split('<')[1]) / 100 && !isChecked) {
        return false;
      } else if (range === '= 0' && value === 0 && !isChecked) {
        return false;
      }
    } else {
      if (range.includes('>') && range.includes('<=') && value > parseFloat(range.split('>')[1].split('<=')[0]) && value <= parseFloat(range.split('<=')[1]) && !isChecked) {
        return false;
      } else if (range.includes('>') && !range.includes('<=') && value > parseFloat(range.split('>')[1]) && !isChecked) {
        return false;
      } else if (range.includes('-')) {
        const [min, max] = range.split('-').map(parseFloat);
        if (value >= min && value <= max && !isChecked) {
          return false;
        }
      }
    }
  }
  return true;
}

function updateLegend() {
    console.log('Updating legend...');
    const legendContent = document.getElementById("legend-content");
    
    const dataLayerCategory = document.getElementById('data-layer-category');
    if (!dataLayerCategory) return;
    
    dataLayerCategory.style.display = '';
    
    const legendCategoryHeader = dataLayerCategory.querySelector('.legend-category-header span');
    if (legendCategoryHeader) {
        legendCategoryHeader.textContent = "Journey Time Catchment (minutes)";
    }
    
    const wasCollapsed = dataLayerCategory.classList.contains('legend-category-collapsed');
    
    const checkboxStates = {};
    const legendCheckboxes = document.querySelectorAll('.legend-checkbox');
    legendCheckboxes.forEach(checkbox => {
        checkboxStates[checkbox.getAttribute('data-range')] = checkbox.checked;
    });

    legendContent.innerHTML = '';

    const classes = [
        { range: "0-10", color: "#fde725", label: "0-10 min" },
        { range: "10-20", color: "#8fd744", label: "10-20 min" },
        { range: "20-30", color: "#35b779", label: "20-30 min" },
        { range: "30-40", color: "#21908d", label: "30-40 min" },
        { range: "40-50", color: "#31688e", label: "40-50 min" },
        { range: "50-60", color: "#443a82", label: "50-60 min" },
        { range: ">60", color: "#440154", label: ">60 min" }
    ];

    const masterCheckboxDiv = document.createElement("div");
    masterCheckboxDiv.innerHTML = `<input type="checkbox" id="masterCheckbox" checked> <i>Select/Deselect All</i>`;
    legendContent.appendChild(masterCheckboxDiv);

    classes.forEach(c => {
        const div = document.createElement("div");
        const isChecked = checkboxStates[c.range] !== undefined ? checkboxStates[c.range] : true;
        div.innerHTML = `<input type="checkbox" class="legend-checkbox" data-range="${c.range}" ${isChecked ? 'checked' : ''}> 
                         <span style="display: inline-block; width: 20px; height: 20px; background-color: ${c.color};"></span> ${c.label}`;
        legendContent.appendChild(div);
    });

    function updateMasterCheckbox() {
        const newLegendCheckboxes = document.querySelectorAll('.legend-checkbox');
        const allChecked = Array.from(newLegendCheckboxes).every(checkbox => checkbox.checked);
        const noneChecked = Array.from(newLegendCheckboxes).every(checkbox => !checkbox.checked);
        const masterCheckbox = document.getElementById('masterCheckbox');
        masterCheckbox.checked = allChecked;
        masterCheckbox.indeterminate = !allChecked && !noneChecked;
    }

    const newLegendCheckboxes = document.querySelectorAll('.legend-checkbox');
    newLegendCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateMasterCheckbox();
            if (AmenitiesCatchmentLayer) {
                applyAmenitiesCatchmentLayerStyling();
            }
        });
    });

    const masterCheckbox = document.getElementById('masterCheckbox');
    masterCheckbox.addEventListener('change', () => {
        const isChecked = masterCheckbox.checked;
        newLegendCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
        });
        if (AmenitiesCatchmentLayer) {
            applyAmenitiesCatchmentLayerStyling();
        }
    });
    
    updateMasterCheckbox();
    
    if (!wasCollapsed && AmenitiesCatchmentLayer) {
        dataLayerCategory.classList.remove('legend-category-collapsed');
    }
    
    if (AmenitiesCatchmentLayer) {
      applyAmenitiesCatchmentLayerStyling();
    }
}

function findNearbyInfrastructure(latlng, maxPixelDistance = 10, targetLayer = null) {
  console.log('Finding nearby infrastructure...');
  const results = {
    busStops: [],
    busLines: [],
    features: []
  };

  if (targetLayer) {
    targetLayer.eachLayer(layer => {
      if (layer.getLatLng) {
        const markerPoint = map.latLngToContainerPoint(layer.getLatLng());
        const clickPoint = map.latLngToContainerPoint(latlng);
        const pixelDistance = clickPoint.distanceTo(markerPoint);
        
        if (pixelDistance <= maxPixelDistance) {
          results.features.push({
            layer: layer,
            feature: layer,
            distance: pixelDistance
          });
        }
      }
      else {
        const geojson = layer.toGeoJSON();
        let minPixelDistance = Infinity;
        
        if (geojson.geometry.type === 'LineString') {
          for (let i = 0; i < geojson.geometry.coordinates.length - 1; i++) {
            const p1 = L.latLng(
              geojson.geometry.coordinates[i][1], 
              geojson.geometry.coordinates[i][0]
            );
            const p2 = L.latLng(
              geojson.geometry.coordinates[i+1][1], 
              geojson.geometry.coordinates[i+1][0]
            );
            
            const p1Screen = map.latLngToContainerPoint(p1);
            const p2Screen = map.latLngToContainerPoint(p2);
            
            const distance = distanceToLineSegment(
              map.latLngToContainerPoint(latlng), 
              p1Screen, 
              p2Screen
            );
            
            if (distance < minPixelDistance) {
              minPixelDistance = distance;
            }
          }
        }
        else if (geojson.geometry.type === 'MultiLineString') {
          for (const lineCoords of geojson.geometry.coordinates) {
            for (let i = 0; i < lineCoords.length - 1; i++) {
              const p1 = L.latLng(lineCoords[i][1], lineCoords[i][0]);
              const p2 = L.latLng(lineCoords[i+1][1], lineCoords[i+1][0]);
              
              const p1Screen = map.latLngToContainerPoint(p1);
              const p2Screen = map.latLngToContainerPoint(p2);
              
              const distance = distanceToLineSegment(
                map.latLngToContainerPoint(latlng),
                p1Screen,
                p2Screen
              );
              
              if (distance < minPixelDistance) {
                minPixelDistance = distance;
              }
            }
          }
        }
        else if (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon') {
          const coords = geojson.geometry.coordinates;
          const flattenCoords = coords.flat(geojson.geometry.type === 'MultiPolygon' ? 2 : 1);
          
          for (let ring of flattenCoords) {
            for (let i = 0; i < ring.length - 1; i++) {
              const p1 = L.latLng(ring[i][1], ring[i][0]);
              const p2 = L.latLng(ring[i+1][1], ring[i+1][0]);
              
              const p1Screen = map.latLngToContainerPoint(p1);
              const p2Screen = map.latLngToContainerPoint(p2);
              
              const distance = distanceToLineSegment(
                map.latLngToContainerPoint(latlng),
                p1Screen,
                p2Screen
              );
              
              if (distance < minPixelDistance) {
                minPixelDistance = distance;
              }
            }
          }
        }
        
        if (minPixelDistance <= maxPixelDistance) {
          results.features.push({
            layer: layer,
            feature: layer,
            distance: minPixelDistance
          });
        }
      }
    });
    
    results.features.sort((a, b) => a.distance - b.distance);
    return results;
  }

  if (busStopsLayer) {
    busStopsLayer.eachLayer(layer => {
      const markerPoint = map.latLngToContainerPoint(layer.getLatLng());
      const clickPoint = map.latLngToContainerPoint(latlng);
      const pixelDistance = clickPoint.distanceTo(markerPoint);
      
      if (pixelDistance <= maxPixelDistance) {
        results.busStops.push({
          layer: layer,
          feature: layer.feature,
          distance: pixelDistance
        });
      }
    });
  }
  
  if (busLinesLayer) {
    busLinesLayer.eachLayer(layer => {
      const geojson = layer.toGeoJSON();
      let minPixelDistance = Infinity;
      
      if (geojson.geometry.type === 'LineString') {
        for (let i = 0; i < geojson.geometry.coordinates.length - 1; i++) {
          const p1 = L.latLng(
            geojson.geometry.coordinates[i][1], 
            geojson.geometry.coordinates[i][0]
          );
          const p2 = L.latLng(
            geojson.geometry.coordinates[i+1][1], 
            geojson.geometry.coordinates[i+1][0]
          );
          
          const p1Screen = map.latLngToContainerPoint(p1);
          const p2Screen = map.latLngToContainerPoint(p2);
          
          const distance = distanceToLineSegment(
            map.latLngToContainerPoint(latlng), 
            p1Screen, 
            p2Screen
          );
          
          if (distance < minPixelDistance) {
            minPixelDistance = distance;
          }
        }
      }
      else if (geojson.geometry.type === 'MultiLineString') {
        for (const lineCoords of geojson.geometry.coordinates) {
          for (let i = 0; i < lineCoords.length - 1; i++) {
            const p1 = L.latLng(lineCoords[i][1], lineCoords[i][0]);
            const p2 = L.latLng(lineCoords[i+1][1], lineCoords[i+1][0]);
            
            const p1Screen = map.latLngToContainerPoint(p1);
            const p2Screen = map.latLngToContainerPoint(p2);
            
            const distance = distanceToLineSegment(
              map.latLngToContainerPoint(latlng),
              p1Screen,
              p2Screen
            );
            
            if (distance < minPixelDistance) {
              minPixelDistance = distance;
            }
          }
        }
      }
      
      if (minPixelDistance <= maxPixelDistance) {
        results.busLines.push({
          layer: layer,
          feature: layer.feature,
          distance: minPixelDistance
        });
      }
    });
  }
  
  function distanceToLineSegment(p, v, w) {
    const l2 = distanceSquared(v, w);
    
    if (l2 === 0) return Math.sqrt(distanceSquared(p, v));
    
    const t = Math.max(0, Math.min(1, 
      dotProduct(subtractPoints(p, v), subtractPoints(w, v)) / l2
    ));
    
    const projection = {
      x: v.x + t * (w.x - v.x),
      y: v.y + t * (w.y - v.y)
    };
    
    return Math.sqrt(distanceSquared(p, projection));
  }
  
  function distanceSquared(p1, p2) {
    return Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
  }
  
  function dotProduct(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y;
  }
  
  function subtractPoints(p1, p2) {
    return { x: p1.x - p2.x, y: p1.y - p2.y };
  }
  
  results.busStops.sort((a, b) => {
    const nameA = a.feature.properties.stop_name || '';
    const nameB = b.feature.properties.stop_name || '';
    return nameA.localeCompare(nameB);
  });
  
  results.busLines.sort((a, b) => {
    const serviceA = a.feature.properties.service_name || '';
    const serviceB = b.feature.properties.service_name || '';
    return serviceA.localeCompare(serviceB);
  });
  
  return results;
}

function formatFeatureProperties(feature, featureType) {
  console.log('Formatting feature properties...');
  if (!feature || !feature.properties) return '<p>No data available</p>';
  
  let html = '<table class="popup-table">';
  html += '<tr><th>Property</th><th>Value</th></tr>';
  
  if (featureType === 'Bus Stop') {
    const props = feature.properties;
    const attributes = [
      { key: 'atco_code', display: 'ATCO Code' },
      { key: 'stop_name', display: 'Stop Name' },
      { key: 'am_peak_combined_frequency', display: 'AM Peak Frequency' },
      { key: 'mode', display: 'Mode' }
    ];
    
    attributes.forEach(attr => {
      const value = props[attr.key];
      if (value !== null && value !== undefined && value !== '') {
        html += `<tr><td>${attr.display}</td><td>${value}</td></tr>`;
      }
    });
  } 
  else if (featureType === 'Bus Line') {
    const props = feature.properties;
    const attributes = [
      { key: 'lines_diva4', display: 'Line ID' },
      { key: 'service_name', display: 'Service Name' },
      { key: 'direction', display: 'Direction' },
      { key: 'am_peak_service_frequency', display: 'AM Peak Frequency' },
      { key: 'operator', display: 'Operator' }
    ];
    
    attributes.forEach(attr => {
      const value = props[attr.key];
      if (value !== null && value !== undefined && value !== '') {
        html += `<tr><td>${attr.display}</td><td>${value}</td></tr>`;
      }
    });
  }
  
  html += '</table>';
  return html;
}

function showInfrastructurePopup(latlng, nearbyFeatures) {
  const busLineFeatures = nearbyFeatures.busLines;
  const busStopFeatures = nearbyFeatures.busStops;
  
  let combinedBusFrequency = 0;
  if (busLineFeatures.length > 0) {
    combinedBusFrequency = busLineFeatures.reduce((total, current) => {
      const frequency = current.feature.properties.am_peak_service_frequency;
      return total + (parseFloat(frequency) || 0);
    }, 0);
  }
  
  const allFeatures = [
    ...busStopFeatures, 
    ...busLineFeatures
  ];
  
  if (allFeatures.length === 0) return;
  
  let currentIndex = 0;
  const totalFeatures = allFeatures.length;
  let popup = null;
  let highlightedLayer = null;
  
  function highlightCurrentFeature() {
    if (highlightedLayer) {
      map.removeLayer(highlightedLayer);
      highlightedLayer = null;
    }
    
    const currentFeature = allFeatures[currentIndex];
    const isStopFeature = busStopFeatures.includes(currentFeature);
    
    if (isStopFeature) {
      highlightedLayer = L.circleMarker(
        currentFeature.layer.getLatLng(), 
        {
          radius: 8,
          color: '#FFFF00',
          weight: 4,
          opacity: 0.8,
          fill: false
        }
      ).addTo(map);
    } else {
      const lineStyle = {
        color: '#FFFF00',
        weight: 6,
        opacity: 0.8
      };
      
      const featureGeoJSON = currentFeature.layer.toGeoJSON();
      highlightedLayer = L.geoJSON(featureGeoJSON, {
        style: lineStyle
      }).addTo(map);
    }
  }
  
  function updatePopupContent() {
    const currentFeature = allFeatures[currentIndex];
    const featureType = busStopFeatures.includes(currentFeature) ? 'Bus Stop' : 'Bus Line';
    
    const template = document.getElementById('infrastructure-popup-template');
    const content = document.importNode(template.content, true);
    
    content.querySelector('[data-field="feature-type"]').textContent = featureType;
    content.querySelector('[data-field="current-index"]').textContent = currentIndex + 1;
    content.querySelector('[data-field="total-features"]').textContent = totalFeatures;
    
    const frequencyContainer = content.querySelector('[data-field="frequency-container"]');
    if (busLineFeatures.length > 0 && featureType === 'Bus Line') {
      frequencyContainer.style.display = 'block';
      content.querySelector('[data-field="combined-frequency"]').textContent = Math.round(combinedBusFrequency);
    }
    
    content.querySelector('[data-field="content"]').innerHTML = formatFeatureProperties(currentFeature.feature, featureType);
    
    const footer = content.querySelector('[data-field="footer"]');
    if (totalFeatures > 1) {
      footer.style.display = 'flex';
      const prevBtn = content.querySelector('[data-field="prev-btn"]');
      const nextBtn = content.querySelector('[data-field="next-btn"]');
      
      prevBtn.disabled = currentIndex === 0;
      nextBtn.disabled = currentIndex === totalFeatures - 1;
    }
    
    const div = document.createElement('div');
    div.appendChild(content);
    popup.setContent(div.innerHTML);
    
    highlightCurrentFeature();
    
    setTimeout(() => {
      const prevBtn = document.getElementById('prev-feature');
      const nextBtn = document.getElementById('next-feature');
      
      if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (currentIndex > 0) {
            currentIndex--;
            updatePopupContent();
          }
        });
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (currentIndex < totalFeatures - 1) {
            currentIndex++;
            updatePopupContent();
          }
        });
      }
    }, 10);
  }
  
  popup = L.popup({
    autoPan: true,
    closeButton: true,
    closeOnClick: false
  })
    .setLatLng(latlng)
    .setContent('Loading...')
    .openOn(map);
  
  popup.on('remove', function() {
    if (highlightedLayer) {
      map.removeLayer(highlightedLayer);
      highlightedLayer = null;
    }
  });
  
  updatePopupContent();
}

function showAmenityCatchment(amenityType, amenityId) {
  console.log('showAmenityCatchment called');
  const panelHeaders = document.querySelectorAll(".panel-header:not(.summary-header)");
    
  panelHeaders.forEach(header => {
    header.classList.add("collapsed");
    header.nextElementSibling.style.display = "none";
    
    if (header.textContent.includes("Journey Time Catchments - Training Centres") && AmenitiesCatchmentLayer) {
      map.removeLayer(AmenitiesCatchmentLayer);
      AmenitiesCatchmentLayer = null;
    }
  });
  
  selectingFromMap = true;
  selectedAmenitiesFromMap = [amenityId];
  selectedAmenitiesAmenities = [amenityType];
  
  const amenitiesHeader = Array.from(panelHeaders).find(header => 
    header.textContent.includes("Journey Time Catchments - Training Centres"));
  
  if (amenitiesHeader) {
    amenitiesHeader.classList.remove("collapsed");
    amenitiesHeader.nextElementSibling.style.display = "block";
    
    if (!AmenitiesYear.value) {
      AmenitiesYear.value = AmenitiesYear.options[0].value;
    }
    
    AmenitiesPurpose.forEach(checkbox => {
      checkbox.checked = false;
    });
    
    const checkbox = Array.from(AmenitiesPurpose).find(checkbox => checkbox.value === amenityType);
    if (checkbox) {
      checkbox.checked = true;
    }
    
    updateAmenitiesCatchmentLayer();
  }
}

function drawSelectedAmenities() {
  console.log('drawSelectedAmenities called');
  const amenitiesCheckbox = document.getElementById('amenitiesCheckbox');
  amenitiesLayerGroup.clearLayers();

  if (!amenitiesCheckbox || !amenitiesCheckbox.checked) {
    return;
  }

  const filteredTrainingCentres = filterTrainingCentres();
  
  const currentZoom = map.getZoom();
  const isAboveZoomThreshold = currentZoom >= 14;

  const layer = L.geoJSON(filteredTrainingCentres, {
    pointToLayer: (feature, latlng) => {
      const icon = isAboveZoomThreshold ? 
        L.divIcon({ className: 'fa-icon', html: '<div class="pin"><i class="fas fa-graduation-cap" style="color: grey;"></i></div>', iconSize: [60, 60], iconAnchor: [15, 15] }): 
        L.divIcon({ className: 'fa-icon', html: '<div class="dot" style="background-color:grey;"></div>', iconSize: [7, 7], iconAnchor: [3.5, 3.5] });
      
      const marker = L.marker(latlng, { icon: icon });
      
      marker.on('add', function() {
        const element = this.getElement();
        if (element) {
          element.style.opacity = 1;
        }
      });
      
      marker.on('mouseover', function(e) {
        const element = e.target.getElement();
        if (element) {
          element.style.transform = element.style.transform.replace(/scale\([^)]*\)/, '') + ' scale(1.3)';
          element.style.zIndex = 1000;
          element.style.transition = 'transform 0.2s ease';
          element.style.cursor = 'pointer';
        }
      });
      
      marker.on('mouseout', function(e) {
        const element = e.target.getElement();
        if (element) {
          element.style.transform = element.style.transform.replace(/scale\([^)]*\)/, '');
          element.style.zIndex = '';
        }
      });
      
      marker.on('click', function() {
        const properties = feature.properties;
        const popupContent = getTrainingCenterPopupContent(properties);
        
        L.popup()
          .setLatLng(latlng)
          .setContent(popupContent)
          .openOn(map);
      });
      
      return marker;
    },
  });
  
  amenitiesLayerGroup.addLayer(layer);
  amenitiesLayerGroup.addTo(map);
}

function updateAmenitiesCatchmentLayer() {
    console.log("updateAmenitiesCatchmentLayer called");
    
    if (isUpdatingCatchmentLayer) {
        console.log("Already updating catchment layer, skipping duplicate call");
        return;
    }
    
    isUpdatingCatchmentLayer = true;
    
    if (!initialLoadComplete || !grid) {
        updateAmenitiesCatchmentLayer.isRunning = false;
        return;
    }
    
    const amenitiesPanelOpen = document.querySelector(".panel-header:not(.summary-header)")
        .classList.contains("collapsed") === false;
    
    if (!amenitiesPanelOpen) {
        updateAmenitiesCatchmentLayer.isRunning = false;
        return;
    }

    showLoadingOverlay();

    const selectedYear = AmenitiesYear.value;
    
    const subjectAllCheckbox = document.querySelector('#subjectCheckboxesContainer input[value="All"]');
    const isAllSubjectsSelected = subjectAllCheckbox && subjectAllCheckbox.checked;
    const subjectCheckboxes = document.querySelectorAll('#subjectCheckboxesContainer input[type="checkbox"]:checked:not([value="All"])');
    const selectedSubjects = Array.from(subjectCheckboxes).map(checkbox => checkbox.value.toLowerCase());
    
    const aimLevelAllCheckbox = document.querySelector('#aimlevelCheckboxesContainer input[value="All"]');
    const isAllAimLevelsSelected = aimLevelAllCheckbox && aimLevelAllCheckbox.checked;
    const aimLevelCheckboxes = document.querySelectorAll('#aimlevelCheckboxesContainer input[type="checkbox"]:checked:not([value="All"])');
    const selectedAimLevels = Array.from(aimLevelCheckboxes).map(checkbox => checkbox.value);
    
    const filteredTrainingCentres = filterTrainingCentres();
    
    const filteredTrainingCenterIds = filteredTrainingCentres.features
        .map(feature => feature.properties.DestinationId_tracc)
        .filter(id => id !== undefined);
        
    if (!selectedYear || filteredTrainingCenterIds.length === 0) {
        if (AmenitiesCatchmentLayer) {
            map.removeLayer(AmenitiesCatchmentLayer);
            AmenitiesCatchmentLayer = null;
        }
        drawSelectedAmenities([]);
        updateLegend();
        updateFilterDropdown();
        updateFilterValues();
        updateSummaryStatistics([]);
        updateAmenitiesCatchmentLayer.isRunning = false;
        return;
    }

    gridTimeMap = {};
    
    const csvPath = 'https://AmFa6.github.io/TrainingCentres/trainingcentres_od.csv';

    fetch(csvPath)
        .then(response => response.text())
        .then(csvText => {
            const csvData = Papa.parse(csvText, { header: true }).data;
            
            if (csvData.length === 0) {
                updateAmenitiesCatchmentLayer.isRunning = false;
                return;
            }
            
            const csvDestinationIds = new Set(csvData.map(row => row.destination).filter(Boolean));
            
            const matchingIds = filteredTrainingCenterIds.filter(id => csvDestinationIds.has(id));
            
            if (matchingIds.length === 0) {
                updateAmenitiesCatchmentLayer.isRunning = false;
                return;
            }
            
            const yearPrefix = selectedYear === 'Any' ? null : selectedYear.substring(0, 4);
            const eligibleDestinations = new Set();
            
            if (amenityLayers['TrainingCentres']) {
                amenityLayers['TrainingCentres'].features.forEach(feature => {
                    const props = feature.properties;
                    const destinationId = props.DestinationId_tracc;
                    
                    if (!destinationId || !matchingIds.includes(destinationId)) {
                        return;
                    }
                    
                    const hasSelectedAimLevel = isAllAimLevelsSelected || selectedAimLevels.length === 0 ||
                        selectedAimLevels.some(level => props[`AimLevel_${level}`] === "1");
                    
                    if (!hasSelectedAimLevel) {
                        return;
                    }
                    
                    let hasSelectedSubject = isAllSubjectsSelected || selectedSubjects.length === 0;
                    
                    if (!hasSelectedSubject && yearPrefix) {
                        hasSelectedSubject = selectedSubjects.some(subject => {
                            const columnName = `${yearPrefix}_${subject}`;
                            return props[columnName] && props[columnName] !== "" && props[columnName] !== "0";
                        });
                    } else if (!hasSelectedSubject) {
                        const years = ["2122", "2223", "2324", "2425"];
                        hasSelectedSubject = years.some(year => {
                            return selectedSubjects.some(subject => {
                                const columnName = `${year}_${subject}`;
                                return props[columnName] && props[columnName] !== "" && props[columnName] !== "0";
                            });
                        });
                    }
                    
                    if (hasSelectedSubject) {
                        eligibleDestinations.add(destinationId);
                    }
                });
            }
            
            csvData.forEach(row => {
                const originId = row.origin;
                const destinationId = row.destination;
                const totalTime = parseFloat(row.totaltime);
                
                if (!originId || !destinationId || isNaN(totalTime)) {
                    return;
                }
                
                if (eligibleDestinations.has(destinationId)) {
                    if (!gridTimeMap[originId] || totalTime < gridTimeMap[originId]) {
                        gridTimeMap[originId] = totalTime;
                    }
                }
            });
            
            grid.features.forEach(feature => {
                const originId = feature.properties.OriginId_tracc;
                if (gridTimeMap[originId] === undefined) {
                    gridTimeMap[originId] = 120;
                }
            });
            
            let needToCreateNewLayer = false;
            if (!AmenitiesCatchmentLayer) {
                needToCreateNewLayer = true;
            }
            
            if (needToCreateNewLayer) {
                if (AmenitiesCatchmentLayer) {
                    map.removeLayer(AmenitiesCatchmentLayer);
                }
                
                AmenitiesCatchmentLayer = L.geoJSON(grid, {
                    pane: 'polygonLayers',
                    style: function() {
                        return {
                            weight: 0,
                            fillOpacity: 0,
                            opacity: 0
                        };
                    }
                }).addTo(map);
                
                AmenitiesCatchmentLayer.eachLayer(layer => {
                    layer.feature.properties._opacity = undefined;
                    layer.feature.properties._weight = undefined;
                });
                
                const updatesComplete = () => {
                  drawSelectedAmenities();
                  updateLegend();
                  updateFilterDropdown();
                  updateFilterValues('amenities');
                };
                
                updateSliderRanges('Amenities', 'Opacity');
                updateSliderRanges('Amenities', 'Outline');
                
                setTimeout(updatesComplete, 50);
              } else {
                  applyAmenitiesCatchmentLayerStyling();
                  updateSummaryStatistics(getCurrentFeatures());
              }
              isUpdatingCatchmentLayer = false;
              hideLoadingOverlay();
        })
        .catch(error => {
            console.error("Error loading journey time data:", error);
            isUpdatingCatchmentLayer = false;
            hideLoadingOverlay();
        });
}

function applyAmenitiesCatchmentLayerStyling() {
    console.log("applyAmenitiesCatchmentLayerStyling called");
    
    if (!AmenitiesCatchmentLayer) {
        console.log("No AmenitiesCatchmentLayer, returning early");
        return;
    }
    
    console.log("Processing layer styling");
    
    const featureCount = AmenitiesCatchmentLayer.getLayers().length;
    console.log(`Styling ${featureCount} features`);
    
    try {
        AmenitiesCatchmentLayer.eachLayer(layer => {
            const OriginId_tracc = layer.feature.properties.OriginId_tracc;
            const time = gridTimeMap[OriginId_tracc];
            
            if (layer.feature.properties._opacity === undefined) {
                layer.feature.properties._opacity = 0.5;
            }
            
            if (layer.feature.properties._weight === undefined) {
                layer.feature.properties._weight = 0;
            }
            
            let fillColor = 'transparent';
            if (time !== undefined) {
                if (time <= 10) fillColor = '#fde725';
                else if (time <= 20) fillColor = '#8fd744';
                else if (time <= 30) fillColor = '#35b779';
                else if (time <= 40) fillColor = '#21908d';
                else if (time <= 50) fillColor = '#31688e';
                else if (time <= 60) fillColor = '#443a82';
                else fillColor = '#440154';
            }
            
            layer.feature.properties._fillColor = fillColor;
            layer.feature.properties._range = time <= 10 ? "0-10" :
                                time <= 20 ? "10-20" :
                                time <= 30 ? "20-30" :
                                time <= 40 ? "30-40" :
                                time <= 50 ? "40-50" :
                                time <= 60 ? "50-60" : ">60";
        });
        
        const legendCheckboxes = document.querySelectorAll('.legend-checkbox');
        const visibleRanges = Array.from(legendCheckboxes)
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.getAttribute('data-range'));
        
        const hasLegendCheckboxes = legendCheckboxes.length > 0;
        const hasAnyVisibleRanges = visibleRanges.length > 0;
        
        console.log(`Found ${legendCheckboxes.length} legend checkboxes, ${visibleRanges.length} are visible`);
        
        AmenitiesCatchmentLayer.setStyle(function(feature) {
            const range = feature.properties._range;
            
            const isVisible = !hasLegendCheckboxes || 
                            (hasAnyVisibleRanges && visibleRanges.includes(range)) || 
                            (!hasAnyVisibleRanges);
            
            return {
                fillColor: feature.properties._fillColor,
                color: 'black',
                weight: isVisible ? feature.properties._weight : 0,
                fillOpacity: isVisible ? feature.properties._opacity : 0,
                opacity: isVisible ? 1 : 0
            };
        });
        
        console.log("Layer styling completed successfully");
    } catch (error) {
        console.error("Error in applyAmenitiesCatchmentLayerStyling:", error);
        console.error("Error stack:", error.stack);
    }
}

function updateOpacityAndOutlineFields() {
    if (isUpdatingOpacityOutlineFields) {
        return;
    }
    
    isUpdatingOpacityOutlineFields = true;
    console.log("updateOpacityAndOutlineFields called");
    
    if (!AmenitiesCatchmentLayer) {
        isUpdatingOpacityOutlineFields = false;
        return;
    }
    
    const currentUpdateTime = Date.now();
    updateOpacityAndOutlineFields.lastUpdateTime = currentUpdateTime;
    
    if (isUpdatingStyles) {
        setTimeout(() => {
            if (updateOpacityAndOutlineFields.lastUpdateTime === currentUpdateTime) {
                updateOpacityAndOutlineFields();
            }
        }, 250);
        isUpdatingOpacityOutlineFields = false;
        return;
    }
    
    isUpdatingStyles = true;
    
    const opacityField = AmenitiesOpacity.value;
    const outlineField = AmenitiesOutline.value;
    const opacityRange = AmenitiesOpacityRange.noUiSlider.get().map(parseFloat);
    const outlineRange = AmenitiesOutlineRange.noUiSlider.get().map(parseFloat);
    
    const needOpacity = opacityField !== "None";
    const needOutline = outlineField !== "None";
    const opacityMin = opacityRange[0];
    const opacityMax = opacityRange[1];
    const outlineMin = outlineRange[0];
    const outlineMax = outlineRange[1];
    
    const opacityLookup = {};
    const outlineLookup = {};
    
    if (needOpacity) {
        const step = Math.max((opacityMax - opacityMin) / 100, 0.1);
        for (let value = opacityMin; value <= opacityMax; value += step) {
            const normalized = (value - opacityMin) / (opacityMax - opacityMin);
            opacityLookup[value.toFixed(1)] = isInverseAmenitiesOpacity ? 
                0.8 - (normalized * 0.7) : 0.1 + (normalized * 0.7);
        }
    }
    
    if (needOutline) {
        const step = Math.max((outlineMax - outlineMin) / 100, 0.1);
        for (let value = outlineMin; value <= outlineMax; value += step) {
            const normalized = (value - outlineMin) / (outlineMax - outlineMin);
            outlineLookup[value.toFixed(1)] = isInverseAmenitiesOutline ? 
                3 - (normalized * 2.5) : 0.5 + (normalized * 2.5);
        }
    }
    
    const features = AmenitiesCatchmentLayer.getLayers();
    const batchSize = 500;
    
    if (window.Worker && features.length > 1000) {
        processWithWorker();
    } else {
        processWithBatches();
    }
    
    function processWithBatches() {
        let currentIndex = 0;
        
        function processBatch() {
            const endIndex = Math.min(currentIndex + batchSize, features.length);
            
            for (let i = currentIndex; i < endIndex; i++) {
                const layer = features[i];
                layer.feature.properties._opacity = 0.5;
                layer.feature.properties._weight = 0;
                
                if (needOpacity) {
                    const value = parseFloat(layer.feature.properties[opacityField]);
                    if (!isNaN(value)) {
                        const key = value.toFixed(1);
                        if (opacityLookup[key] !== undefined) {
                            layer.feature.properties._opacity = opacityLookup[key];
                        } else if (value >= opacityMin && value <= opacityMax) {
                            const normalized = (value - opacityMin) / (opacityMax - opacityMin);
                            const scaledValue = isInverseAmenitiesOpacity ? 
                                (1 - normalized) : normalized;
                            layer.feature.properties._opacity = 0.1 + (scaledValue * 0.7);
                        }
                    }
                }
                
                if (needOutline) {
                    const value = parseFloat(layer.feature.properties[outlineField]);
                    if (!isNaN(value)) {
                        const key = value.toFixed(1);
                        if (outlineLookup[key] !== undefined) {
                            layer.feature.properties._weight = outlineLookup[key];
                        } else if (value >= outlineMin && value <= outlineMax) {
                            const normalized = (value - outlineMin) / (outlineMax - outlineMin);
                            const scaledValue = isInverseAmenitiesOutline ? 
                                (1 - normalized) : normalized;
                            layer.feature.properties._weight = 0.5 + (scaledValue * 2.5);
                        }
                    }
                }
            }
            
            currentIndex = endIndex;
            
            if (currentIndex < features.length) {
                requestAnimationFrame(processBatch);
            } else {
                applyAmenitiesCatchmentLayerStyling();
                isUpdatingStyles = false;
                isUpdatingOpacityOutlineFields = false;
            }
        }
        
        processBatch();
    }
    
    function processWithWorker() {
        const workerCode = `
            self.onmessage = function(e) {
                const { features, opacityField, outlineField, opacityMin, opacityMax, outlineMin, outlineMax, 
                          isInverseAmenitiesOpacity, isInverseAmenitiesOutline } = e.data;
                
                const needOpacity = opacityField !== "None";
                const needOutline = outlineField !== "None";
                const results = [];
                
                for (let i = 0; i < features.length; i++) {
                    const feature = features[i];
                    const result = {
                        index: i,
                        _opacity: 0.5,
                        _weight: 0
                    };
                    
                    if (needOpacity) {
                        const value = parseFloat(feature.properties[opacityField]);
                        if (!isNaN(value) && value >= opacityMin && value <= opacityMax) {
                            const normalized = (value - opacityMin) / (opacityMax - opacityMin);
                            const scaledValue = isInverseAmenitiesOpacity ? 
                                (1 - normalized) : normalized;
                            result._opacity = 0.1 + (scaledValue * 0.7);
                        }
                    }
                    
                    if (needOutline) {
                        const value = parseFloat(feature.properties[outlineField]);
                        if (!isNaN(value) && value >= outlineMin && value <= outlineMax) {
                            const normalized = (value - outlineMin) / (outlineMax - outlineMin);
                            const scaledValue = isInverseAmenitiesOutline ? 
                                (1 - normalized) : normalized;
                            result._weight = 0.5 + (scaledValue * 2.5);
                        }
                    }
                    
                    results.push(result);
                }
                
                self.postMessage(results);
            };
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        
        const featureData = features.map(layer => ({
            properties: layer.feature.properties
        }));
        
        worker.onmessage = function(e) {
            const results = e.data;
            
            results.forEach(result => {
                const layer = features[result.index];
                layer.feature.properties._opacity = result._opacity;
                layer.feature.properties._weight = result._weight;
            });
            
            applyAmenitiesCatchmentLayerStyling();
            isUpdatingStyles = false;
            isUpdatingOpacityOutlineFields = false;
            worker.terminate();
        };
        
        worker.postMessage({
            features: featureData,
            opacityField,
            outlineField,
            opacityMin,
            opacityMax,
            outlineMin,
            outlineMax,
            isInverseAmenitiesOpacity,
            isInverseAmenitiesOutline
        });
    }
}

function updateFilterDropdown() {
  if (isUpdatingFilters) return;
  isUpdatingFilters = true;
  const filterTypeDropdown = document.getElementById('filterTypeDropdown');
  if (!filterTypeDropdown) {
    isUpdatingFilters = false;
    return;
  }
  console.log('updateFilterDropdown');

  const currentValue = filterTypeDropdown.value;
  
  filterTypeDropdown.innerHTML = '';
  
  const standardOptions = [
    { value: 'LA', text: 'Local Authority' },
    { value: 'Ward', text: 'Ward' },
  ];
  
  if (AmenitiesCatchmentLayer) {
    standardOptions.push({ value: 'Range', text: 'Range (see Legend)' });
  }
  
  standardOptions.forEach(option => {
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.text;
    filterTypeDropdown.appendChild(optionElement);
  });
  
  if (userLayers && userLayers.length > 0) {
    userLayers.forEach(userLayer => {
      const option = document.createElement('option');
      option.value = `UserLayer_${userLayer.id}`;
      option.textContent = `User Layer - ${userLayer.name}`;
      filterTypeDropdown.appendChild(option);
    });
  }
  
  if ((currentValue === 'Range' && !AmenitiesCatchmentLayer) ||
      !Array.from(filterTypeDropdown.options).some(opt => opt.value === currentValue)) {
    filterTypeDropdown.value = 'LA';
  } else {
    filterTypeDropdown.value = currentValue;
  }
  
  isUpdatingFilters = false;
}

function updateFilterValues(source = 'filter') {
  if (isUpdatingFilterValues) return;
  console.log('updateFilterValues called from:', source);
  isUpdatingFilterValues = true;

  try {
    if (!filterTypeDropdown.value) {
      filterTypeDropdown.value = AmenitiesCatchmentLayer ? 'Range' : 'LA';
    }
    
    const currentFilterType = filterTypeDropdown.value;
    
    let filterValueButton = document.getElementById('filterValueButton');
    const filterValueContainer = document.getElementById('filterValueContainer');
    
    if (filterValueContainer) {
      filterValueContainer.innerHTML = '';
    }
    
    if (!filterValueButton) {
      if (filterValueDropdown && filterValueDropdown.parentNode) {
        const dropdownButton = document.createElement('button');
        dropdownButton.type = 'button';
        dropdownButton.className = 'dropdown-toggle';
        dropdownButton.id = 'filterValueButton';
        dropdownButton.textContent = '';
        dropdownButton.style.minHeight = '28px';
        
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'dropdown';
        dropdownContainer.style.width = '100%';
        
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'dropdown-menu';
        dropdownMenu.id = 'filterValueContainer';
        dropdownMenu.style.width = '100%';
        dropdownMenu.style.boxSizing = 'border-box';
        
        dropdownContainer.appendChild(dropdownButton);
        dropdownContainer.appendChild(dropdownMenu);
        
        if (filterValueDropdown.parentNode) {
          filterValueDropdown.parentNode.replaceChild(dropdownContainer, filterValueDropdown);
        }
        
        dropdownButton.addEventListener('click', () => {
          dropdownMenu.classList.toggle('show');
        });
        
        window.addEventListener('click', (event) => {
          if (!event.target.matches('#filterValueButton') && !event.target.closest('#filterValueContainer')) {
            dropdownMenu.classList.remove('show');
          }
        });
      }
    }

    filterValueButton = document.getElementById('filterValueButton');

    if (!filterValueContainer) {
      isUpdatingFilterValues = false;
      return;
    }
    
    filterValueContainer.innerHTML = '';

    let options = [];
    let filterFieldSelector = null;

    if (currentFilterType.startsWith('UserLayer_')) {
      const layerId = currentFilterType.split('UserLayer_')[1];
      const userLayer = userLayers.find(l => l.id === layerId);
      
      if (userLayer) {
        const fieldSelectorDiv = document.createElement('div');
        fieldSelectorDiv.className = 'filter-field-selector';
        fieldSelectorDiv.style.marginBottom = '10px';
        
        const fieldLabel = document.createElement('label');
        fieldLabel.textContent = 'Filter by field:';
        fieldLabel.style.display = 'block';
        fieldLabel.style.marginBottom = '5px';
        fieldSelectorDiv.appendChild(fieldLabel);
        
        filterFieldSelector = document.createElement('select');
        filterFieldSelector.id = 'user-layer-field-selector';
        filterFieldSelector.className = 'small-font';
        filterFieldSelector.style.width = '100%';
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'All features';
        filterFieldSelector.appendChild(defaultOption);
        
        userLayer.fieldNames.forEach(fieldName => {
          const option = document.createElement('option');
          option.value = fieldName;
          option.textContent = fieldName;
          filterFieldSelector.appendChild(option);
        });
        
        if (previousFilterSelections[`UserLayer_${layerId}_field`]) {
          filterFieldSelector.value = previousFilterSelections[`UserLayer_${layerId}_field`];
        }
        
        fieldSelectorDiv.appendChild(filterFieldSelector);
        filterValueContainer.appendChild(fieldSelectorDiv);
        
        filterFieldSelector.addEventListener('change', function() {
          previousFilterSelections[`UserLayer_${layerId}_field`] = this.value;
          populateUserLayerFilterValues(userLayer, this.value);
          if (document.getElementById('highlightAreaCheckbox').checked) {
            highlightSelectedArea();
          }
        });
        
        populateUserLayerFilterValues(userLayer, filterFieldSelector.value);
        isUpdatingFilterValues = false;
        return;
      }
    } else if (currentFilterType === 'Range') {
      const selectedYear = AmenitiesYear.value;
      if (AmenitiesCatchmentLayer) {
        options = [
          '0-10', '10-20', '20-30', '30-40', '40-50', '50-60', '>60'
        ];
      }
    } else if (currentFilterType === 'Ward') {
      const wardNames = new Set();
      if (wardBoundariesLayer) {
        wardBoundariesLayer.getLayers().forEach(layer => {
          const wardName = layer.feature.properties.WD24NM;
          wardNames.add(wardName);
        });
        options = Array.from(wardNames).sort();
      }
    } else if (currentFilterType === 'LA') {
      options = ['MCA', 'LEP'];
      if (uaBoundariesLayer) {
        const uaOptions = uaBoundariesLayer.getLayers()
          .map(layer => layer.feature.properties.LAD24NM)
          .sort();
        options = options.concat(uaOptions);
      }
    }

    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'checkbox-label';
    
    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.id = 'select-all-filter';
    selectAllCheckbox.checked = false;
    
    const selectAllSpan = document.createElement('span');
    selectAllSpan.innerHTML = '<i>Select/Deselect All</i>';
    
    selectAllLabel.appendChild(selectAllCheckbox);
    selectAllLabel.appendChild(selectAllSpan);
    filterValueContainer.appendChild(selectAllLabel);

    const previouslySelected = previousFilterSelections[currentFilterType] || [];

    const checkboxes = [];
    options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `filter-${option.replace(/\s+/g, '-').replace(/[^\w-]/g, '')}`;
      checkbox.value = option;
      
      checkbox.checked = previouslySelected.length > 0 ? 
        previouslySelected.includes(option) : 
        index === 0;
      
      checkbox.className = 'filter-value-checkbox';
      checkboxes.push(checkbox);
      
      const span = document.createElement('span');
      span.textContent = option;
      
      label.appendChild(checkbox);
      label.appendChild(span);
      filterValueContainer.appendChild(label);
      
      checkbox.addEventListener('change', function() {
        updateStoredSelections();
        updateFilterButtonText();
        updateSummaryStatistics(getCurrentFeatures());
        if (document.getElementById('highlightAreaCheckbox').checked) {
          highlightSelectedArea();
        }
      });
    });
    
    selectAllCheckbox.addEventListener('change', function() {
      const isChecked = this.checked;
      checkboxes.forEach(cb => cb.checked = isChecked);
      updateStoredSelections();
      updateFilterButtonText();
      updateSummaryStatistics(getCurrentFeatures());
      if (document.getElementById('highlightAreaCheckbox').checked) {
        highlightSelectedArea();
      }
    });
    
    function updateStoredSelections() {
      const currentSelections = checkboxes
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      
      previousFilterSelections[currentFilterType] = currentSelections;
    }
    
    function updateFilterButtonText() {
      const selectedValues = checkboxes
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      
      if (selectedValues.length === 0) {
        filterValueButton.textContent = '\u00A0';
        filterValueButton.style.minHeight = '28px';
      } else {
        filterValueButton.textContent = selectedValues.join(', ');
      }
    }
    
    const allChecked = checkboxes.every(cb => cb.checked);
    const anyChecked = checkboxes.some(cb => cb.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = anyChecked && !allChecked;
    
    updateFilterButtonText();
    updateSummaryStatistics(getCurrentFeatures());

  } finally {
    isUpdatingFilterValues = false;
  }
}

async function updateSummaryStatistics(features, source = 'filter') {
  if (isCalculatingStats) return;
  isCalculatingStats = true;
  
  console.log('updateSummaryStatistics called from:', source);  
    
  try {
    if (!grid && (!features || features.length === 0)) {
      displayEmptyStatistics();
      return;
    }
    
    const filterValueContainer = document.getElementById('filterValueContainer');
    if (filterValueContainer) {
      const selectedValues = Array.from(filterValueContainer.querySelectorAll('.filter-value-checkbox:checked'))
        .map(checkbox => checkbox.value);
      
      if (selectedValues.length === 0) {
        displayEmptyStatistics();
        return;
      }
    }
    
    const filteredFeatures = applyFilters(features);
    
    if (!filteredFeatures || filteredFeatures.length === 0) {
      displayEmptyStatistics();
      return;
    }

    const baseStats = await calculateBaseStatistics(filteredFeatures);
    
    if (AmenitiesCatchmentLayer && gridTimeMap && Object.keys(gridTimeMap).length > 0) {
      const timeStats = calculateTimeStatistics(filteredFeatures);
      const stats = {...baseStats, ...timeStats};
      updateStatisticsUI(stats);
    } else {
      updateStatisticsUI(baseStats);
    }
  } catch (error) {
    console.error("Error calculating statistics:", error);
    displayEmptyStatistics();
  } finally {
    isCalculatingStats = false;
    hideLoadingOverlay();
  }
}

function displayEmptyStatistics() {
  console.log('displayEmptyStatistics');
  const statisticIds = [
    'total-population', 'min-population', 'max-population',
    'avg-imd-score', 'min-imd-score', 'max-imd-score',
    'avg-imd-decile', 'min-imd-decile', 'max-imd-decile',
    'avg-car-availability', 'min-car-availability', 'max-car-availability',
    'total-growth-pop', 'min-growth-pop', 'max-growth-pop',
    'avg-journey-time', 'min-journey-time', 'max-journey-time'
  ];
  
  statisticIds.forEach(id => {
    document.getElementById(id).textContent = '-';
  });
}

function applyFilters(features) {
  console.log('applyFilters');
  const filterType = filterTypeDropdown.value;
  
  let filteredFeatures = features && features.length ? features : (grid ? grid.features : []);
  
  if ((AmenitiesCatchmentLayer) && (!features || features.length === 0)) {
    filteredFeatures = AmenitiesCatchmentLayer.toGeoJSON().features;
  }
  
  if (filterType.startsWith('UserLayer_')) {
    const layerId = filterType.split('UserLayer_')[1];
    const userLayer = userLayers.find(l => l.id === layerId);
    
    if (userLayer) {
      const fieldSelector = document.getElementById('user-layer-field-selector');
      if (fieldSelector && fieldSelector.value) {
        const selectedField = fieldSelector.value;
        const filterCheckboxes = document.querySelectorAll('.filter-value-checkbox:checked');
        const selectedValues = Array.from(filterCheckboxes).map(cb => cb.value);
        
        if (selectedValues.length === 0) return [];
        
        const combinedFeatures = [];
        
        filteredFeatures.forEach(feature => {
          const gridPolygon = turf.polygon(feature.geometry.coordinates);
          
          for (const userFeature of userLayer.originalData.features) {
            if (selectedValues.includes(String(userFeature.properties[selectedField]))) {
              if (userFeature.geometry.type === 'Polygon') {
                const poly = turf.polygon(userFeature.geometry.coordinates);
                const gridCenter = turf.center(gridPolygon);
                if (turf.booleanPointInPolygon(gridCenter, poly)) {
                  combinedFeatures.push(feature);
                  break;
                }
              } 
              else if (userFeature.geometry.type === 'MultiPolygon') {
                const gridCenter = turf.center(gridPolygon);
                const isInside = userFeature.geometry.coordinates.some(coords => {
                  const poly = turf.polygon(coords);
                  return turf.booleanPointInPolygon(gridCenter, poly);
                });
                
                if (isInside) {
                  combinedFeatures.push(feature);
                  break;
                }
              }
              else if (userFeature.geometry.type === 'Point') {
                const point = turf.point(userFeature.geometry.coordinates);
                if (turf.booleanPointInPolygon(point, gridPolygon)) {
                  combinedFeatures.push(feature);
                  break;
                }
              }
              else if (userFeature.geometry.type === 'LineString') {
                const line = turf.lineString(userFeature.geometry.coordinates);
                if (turf.booleanIntersects(line, gridPolygon)) {
                  combinedFeatures.push(feature);
                  break;
                }
              }
              else if (userFeature.geometry.type === 'MultiLineString') {
                const isIntersecting = userFeature.geometry.coordinates.some(coords => {
                  const line = turf.lineString(coords);
                  return turf.booleanIntersects(line, gridPolygon);
                });
                if (isIntersecting) {
                  combinedFeatures.push(feature);
                  break;
                }
              }
            }
          }
        });
        return combinedFeatures;
      } else {
        const userLayerFeatures = userLayer.originalData.features;
        const combinedFeatures = [];
        for (const feature of filteredFeatures) {
          const gridPolygon = turf.polygon(feature.geometry.coordinates);
          for (const userFeature of userLayerFeatures) {
            if (userFeature.geometry.type === 'Polygon') {
              const poly = turf.polygon(userFeature.geometry.coordinates);
              const gridCenter = turf.center(gridPolygon);
              if (turf.booleanPointInPolygon(gridCenter, poly)) {
                combinedFeatures.push(feature);
                break;
              }
            } 
            else if (userFeature.geometry.type === 'MultiPolygon') {
              const gridCenter = turf.center(gridPolygon);
              const isInside = userFeature.geometry.coordinates.some(coords => {
                const poly = turf.polygon(coords);
                return turf.booleanPointInPolygon(gridCenter, poly);
              });
              if (isInside) {
                combinedFeatures.push(feature);
                break;
              }
            }
            else if (userFeature.geometry.type === 'Point') {
              const point = turf.point(userFeature.geometry.coordinates);
              if (turf.booleanPointInPolygon(point, gridPolygon)) {
                combinedFeatures.push(feature);
                break;
              }
            }
            else if (userFeature.geometry.type === 'LineString') {
              const line = turf.lineString(userFeature.geometry.coordinates);
              if (turf.booleanIntersects(line, gridPolygon)) {
                combinedFeatures.push(feature);
                break;
              }
            }
            else if (userFeature.geometry.type === 'MultiLineString') {
              const isIntersecting = userFeature.geometry.coordinates.some(coords => {
                const line = turf.lineString(coords);
                return turf.booleanIntersects(line, gridPolygon);
              });
              
              if (isIntersecting) {
                combinedFeatures.push(feature);
                break;
              }
            }
          }
        }
        return combinedFeatures;
      }
    }
  }
  else if (filterType === 'Range') {
    const filterValueContainer = document.getElementById('filterValueContainer');
    if (!filterValueContainer) return filteredFeatures;
    
    const selectedValues = Array.from(filterValueContainer.querySelectorAll('.filter-value-checkbox:checked'))
      .map(checkbox => checkbox.value);
    
    if (selectedValues.length === 0) return [];
    
    const combinedFeatures = [];
    selectedValues.forEach(filterValue => {
      const rangeFiltered = applyRangeFilter(filteredFeatures, filterValue);
      rangeFiltered.forEach(feature => {
        if (!combinedFeatures.includes(feature)) {
          combinedFeatures.push(feature);
        }
      });
    });
    
    filteredFeatures = combinedFeatures; 
  } else if (filterType === 'LA' || filterType === 'Ward') {
    const filterValueContainer = document.getElementById('filterValueContainer');
    if (!filterValueContainer) return filteredFeatures;

    const selectedValues = Array.from(filterValueContainer.querySelectorAll('.filter-value-checkbox:checked'))
      .map(cb => cb.value);

    if (selectedValues.length === 0) return [];

    const selectedSet = new Set(selectedValues);

    if (filterType === 'LA') {
      if (selectedSet.has('LEP')) {
        return filteredFeatures;
      }
      if (selectedSet.has('MCA')) {
        return filteredFeatures.filter(f =>
          f.properties.LAD24NM && f.properties.LAD24NM !== 'North Somerset'
        );
      }
      return filteredFeatures.filter(f =>
        f.properties.LAD24NM && selectedSet.has(f.properties.LAD24NM)
      );
    } else if (filterType === 'Ward') {
      return filteredFeatures.filter(f =>
        f.properties.WD24NM && selectedSet.has(f.properties.WD24NM)
      );
    }
  }

  return filteredFeatures;
}

function applyGeographicFilter(features, filterType, filterValue) {
  console.log('applyGeographicFilter', filterType, filterValue);
  if (filterType === 'LA') {
    if (filterValue === 'MCA') {
      return features.filter(f =>
        f.properties.LAD24NM && f.properties.LAD24NM !== 'North Somerset'
      );
    } else if (filterValue === 'LEP') {
      return features;
    } else {
      return features.filter(f =>
        f.properties.LAD24NM === filterValue
      );
    }
  } else if (filterType === 'Ward') {
    return features.filter(f =>
      f.properties.WD24NM === filterValue
    );
  }
  return [];
}

function applyRangeFilter(features, filterValue) {
  console.log('applyRangeFilter');
  if (AmenitiesCatchmentLayer) {
    return filterByJourneyTime(features, filterValue);
  }
  return features;
}

async function calculateStatistics(features) {
  console.log(`Calculating statistics for ${features.length} features`);
  
  const baseStats = await calculateBaseStatistics(features);
  
  let layerStats = {};
  
  if (AmenitiesCatchmentLayer) {
    layerStats = calculateTimeStatistics(features);
  }
  
  return {...baseStats, ...layerStats};
}

function calculateBaseStatistics(gridData) {
  if (!gridData || !gridData.features || gridData.features.length === 0) return;
  
  console.log("Calculating grid statistics once for optimization...");
  
  gridStatistics = {
    pop: { min: Infinity, max: -Infinity },
    IMDScore: { min: Infinity, max: -Infinity },
    car_availability_ts045: { min: Infinity, max: -Infinity },
    pop_growth: { min: Infinity, max: -Infinity },
    IMD_Decile: { min: Infinity, max: -Infinity }
  };
  
  const BATCH_SIZE = 5000;
  const features = gridData.features;
  const totalBatches = Math.ceil(features.length / BATCH_SIZE);
  
  function processBatch(batchIndex) {
    const startIdx = batchIndex * BATCH_SIZE;
    const endIdx = Math.min((batchIndex + 1) * BATCH_SIZE, features.length);
    
    for (let i = startIdx; i < endIdx; i++) {
      const props = features[i].properties;
      if (!props) continue;
      
      for (const field in gridStatistics) {
        if (props[field] !== undefined && props[field] !== null) {
          const value = parseFloat(props[field]);
          if (!isNaN(value)) {
            gridStatistics[field].min = Math.min(gridStatistics[field].min, value);
            gridStatistics[field].max = Math.max(gridStatistics[field].max, value);
          }
        }
      }
    }
    
    if (batchIndex + 1 < totalBatches) {
      setTimeout(() => processBatch(batchIndex + 1), 0);
    } else {
      console.log("Grid statistics calculation complete:", gridStatistics);
    }
  }
  
  processBatch(0);
}

function calculateTimeStatistics(features) {
  console.log('calculateTimeStatistics: Starting calculation with', features.length, 'features');
  
  let totalWeightedTime = 0;
  let totalPopulation = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;
  
  let validFeatureCount = 0;
  let missingTimeCount = 0;
  let zeroPopCount = 0;
  
  for (let i = 0; i < features.length; i++) {
    const props = features[i].properties;
    if (!props) {
      continue;
    }
    
    const OriginId_tracc = props.OriginId_tracc;
    const time = gridTimeMap[OriginId_tracc];
    const pop = Number(props.pop) || 0;
    
    if (time === undefined) {
      missingTimeCount++;
      continue;
    }
    
    if (pop <= 0) {
      zeroPopCount++;
      continue;
    }
    
    validFeatureCount++;
    
    totalWeightedTime += time * pop;
    totalPopulation += pop;
    
    minTime = Math.min(minTime, time);
    maxTime = Math.max(maxTime, time);
  }
  
  if (minTime === Infinity) minTime = 0;
  if (maxTime === -Infinity) maxTime = 0;
  
  const avgTime = totalPopulation > 0 ? totalWeightedTime / totalPopulation : 0;
  
  return {
    avgTime: avgTime,
    minTime: minTime,
    maxTime: maxTime,
  }
}

function updateStatisticsUI(stats) {
  console.log('updateStatisticsUI');
  document.getElementById('total-population').textContent = formatValue(stats.totalPopulation, 10);
  document.getElementById('min-population').textContent = formatValue(stats.minPopulation, 10);
  document.getElementById('max-population').textContent = formatValue(stats.maxPopulation, 10);
  document.getElementById('avg-imd-score').textContent = formatValue(stats.avgImdScore, 0.1);
  document.getElementById('min-imd-score').textContent = formatValue(stats.minImdScore, 0.1);
  document.getElementById('max-imd-score').textContent = formatValue(stats.maxImdScore, 0.1);
  document.getElementById('avg-imd-decile').textContent = formatValue(stats.avgImdDecile, 1);
  document.getElementById('min-imd-decile').textContent = formatValue(stats.minImdDecile, 1);
  document.getElementById('max-imd-decile').textContent = formatValue(stats.maxImdDecile, 1);
  document.getElementById('avg-car-availability').textContent = formatValue(stats.avgCarAvailability, 0.01);
  document.getElementById('min-car-availability').textContent = formatValue(stats.minCarAvailability, 0.01);
  document.getElementById('max-car-availability').textContent = formatValue(stats.maxCarAvailability, 0.01);
  document.getElementById('total-growth-pop').textContent = formatValue(stats.totalPopGrowth, 10);
  document.getElementById('min-growth-pop').textContent = formatValue(stats.minPopGrowth, 10);
  document.getElementById('max-growth-pop').textContent = formatValue(stats.maxPopGrowth, 10);
  document.getElementById('avg-journey-time').textContent = formatValue(stats.avgTime, 1);
  document.getElementById('min-journey-time').textContent = formatValue(stats.minTime, 1);
  document.getElementById('max-journey-time').textContent = formatValue(stats.maxTime, 1);
}

function filterByJourneyTime(features, filterValue) {
  console.log('filterByJourneyTime');
  if (filterValue === '>60') {
    return features.filter(feature => {
      const OriginId_tracc = feature.properties.OriginId_tracc;
      const time = gridTimeMap[OriginId_tracc];
      return time > 30;
    });
  } else {
    const [minRange, maxRange] = filterValue.split('-').map(parseFloat);
    return features.filter(feature => {
      const OriginId_tracc = feature.properties.OriginId_tracc;
      const time = gridTimeMap[OriginId_tracc];
      return time >= minRange && (maxRange ? time <= maxRange : true);
    });
  }
}

function calculateWeightedAverage(values, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSum = values.reduce((sum, value, index) => sum + value * weights[index], 0);
  return weightedSum / totalWeight;
}

function getCurrentFeatures() {
  console.log('getCurrentFeatures');
  const filterType = filterTypeDropdown.value;
  
  let sourceFeatures = [];
  if (AmenitiesCatchmentLayer) {
    sourceFeatures = AmenitiesCatchmentLayer.toGeoJSON().features;
  } else if (grid) {
    sourceFeatures = grid.features;
  }
  
  if (filterType.startsWith('UserLayer_')) {
    const layerId = filterType.split('UserLayer_')[1];
    const userLayer = userLayers.find(l => l.id === layerId);
    
    if (userLayer) {
      return applyFilters(sourceFeatures);
    }
  } 
  
  return sourceFeatures;
}

function highlightSelectedArea() {
  const highlightAreaCheckbox = document.getElementById('highlightAreaCheckbox');
  if (!highlightAreaCheckbox.checked) {
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
    return;
  }
  const filterType = filterTypeDropdown.value;
  
  const filterValueContainer = document.getElementById('filterValueContainer');
  if (!filterValueContainer) return;
  
  const selectedValues = Array.from(filterValueContainer.querySelectorAll('.filter-value-checkbox:checked'))
    .map(checkbox => checkbox.value);
  
  if (selectedValues.length === 0) {
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
    return;
  }

  let selectedPolygons = [];

  if (filterType.startsWith('UserLayer_')) {
    const layerId = filterType.split('UserLayer_')[1];
    const userLayer = userLayers.find(l => l.id === layerId);
    
    if (userLayer) {
      const fieldSelector = document.getElementById('user-layer-field-selector');
      if (fieldSelector && fieldSelector.value) {
        const selectedField = fieldSelector.value;
        
        const matchingFeatures = userLayer.originalData.features.filter(feature => 
          selectedValues.includes(String(feature.properties[selectedField]))
        );
        
        selectedPolygons = matchingFeatures.map(feature => {
          return {
            type: 'Feature',
            geometry: feature.geometry,
            properties: feature.properties
          };
        });
      } else {
        selectedPolygons = userLayer.originalData.features.map(feature => {
          return {
            type: 'Feature',
            geometry: feature.geometry,
            properties: feature.properties
          };
        });
      }
    }
  } else if (filterType === 'Ward') {
    if (!wardBoundariesLayer) return;
    
    selectedValues.forEach(filterValue => {
      const wardLayers = wardBoundariesLayer.getLayers().filter(layer => layer.feature.properties.WD24NM === filterValue);
      selectedPolygons = [...selectedPolygons, ...wardLayers.map(layer => layer.toGeoJSON())];
    });
  } else if (filterType === 'LA') {
    if (!uaBoundariesLayer) return;
    
    selectedValues.forEach(filterValue => {
      if (filterValue === 'MCA') {
        const mcaLayers = uaBoundariesLayer.getLayers().filter(layer => layer.feature.properties.LAD24NM !== 'North Somerset');
        selectedPolygons = [...selectedPolygons, ...mcaLayers.map(layer => layer.toGeoJSON())];
      } else if (filterValue === 'LEP') {
        const lepLayers = uaBoundariesLayer.getLayers();
        selectedPolygons = [...selectedPolygons, ...lepLayers.map(layer => layer.toGeoJSON())];
      } else {
        const uaLayers = uaBoundariesLayer.getLayers().filter(layer => layer.feature.properties.LAD24NM === filterValue);
        selectedPolygons = [...selectedPolygons, ...uaLayers.map(layer => layer.toGeoJSON())];
      }
    });
  }

  if (selectedPolygons.length > 0) {
    const unionPolygon = selectedPolygons.reduce((acc, polygon) => {
      return acc ? turf.union(acc, polygon) : polygon;
    }, null);

    const mapBounds = [-6.38, 49.87, 1.77, 55.81];
    const mapPolygon = turf.bboxPolygon(mapBounds);

    const inversePolygon = turf.difference(mapPolygon, unionPolygon);

    if (highlightLayer) {
      map.removeLayer(highlightLayer);
    }

    highlightLayer = L.geoJSON(inversePolygon, {
      style: {
        color: 'rgba(118,118,118,1)',
        weight: 1,
        fillColor: 'grey',
        fillOpacity: 0.75
      }
    }).addTo(map);
  }
}
