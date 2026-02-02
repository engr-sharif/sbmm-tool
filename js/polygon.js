/**
 * SBMM Planning Tool - Polygon Area Analysis
 *
 * Draw a polygon on the map to select a region and view summary
 * statistics for all samples within the boundary.
 */
var PolygonModule = (function() {
    'use strict';

    var conv = AppConfig.coordConversion;
    var analytes = ['Mercury', 'Arsenic', 'Antimony', 'Thallium'];

    // Temporary drawing layers
    var tempPolyline = null;
    var tempVertexMarkers = [];
    var statsPanel = null;

    // ===== INITIALIZATION =====

    /**
     * Initialize polygon state and create the stats panel container.
     * Call once after the map is ready.
     */
    function init() {
        AppState.polygonMode = false;
        AppState.polygonLayer = L.layerGroup().addTo(AppState.map);
        AppState.polygonVertices = [];

        createStatsPanel();
        bindMapEvents();
    }

    // ===== DRAWING TOGGLE =====

    /**
     * Toggle polygon drawing mode on/off.
     */
    function toggle() {
        AppState.polygonMode = !AppState.polygonMode;
        var btn = document.getElementById('btn-polygon');
        var mapEl = document.getElementById('map');

        if (AppState.polygonMode) {
            // Enter drawing mode: clear any previous polygon first
            clearPolygon();
            if (btn) btn.classList.add('active');
            mapEl.classList.add('polygon-mode');
        } else {
            // Exit drawing mode without finishing
            if (btn) btn.classList.remove('active');
            mapEl.classList.remove('polygon-mode');
            clearDrawingState();
        }
    }

    // ===== MAP EVENT HANDLING =====

    /**
     * Wire up map click and double-click handlers for polygon drawing.
     */
    function bindMapEvents() {
        AppState.map.on('click', handleClick);
        AppState.map.on('dblclick', handleDoubleClick);
    }

    /**
     * Handle a single map click while in polygon drawing mode.
     * Adds a vertex to the in-progress polygon.
     */
    function handleClick(e) {
        if (!AppState.polygonMode) return;

        // Prevent this click from being processed by other tools
        L.DomEvent.stopPropagation(e);

        var latlng = e.latlng;
        AppState.polygonVertices.push(latlng);
        drawInProgress();
    }

    /**
     * Handle a double-click to finish the polygon.
     * Requires at least 3 vertices to form a valid polygon.
     */
    function handleDoubleClick(e) {
        if (!AppState.polygonMode) return;

        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);

        // The double-click fires two click events first, so the last vertex
        // was already added twice. Remove the duplicate.
        if (AppState.polygonVertices.length > 1) {
            AppState.polygonVertices.pop();
        }

        if (AppState.polygonVertices.length < 3) {
            return; // Not enough vertices
        }

        finishPolygon();
    }

    // ===== IN-PROGRESS DRAWING =====

    /**
     * Redraw the temporary polygon outline and vertex markers
     * as the user adds points.
     */
    function drawInProgress() {
        // Clear previous temporary drawing artifacts
        clearTempLayers();

        var verts = AppState.polygonVertices;
        if (verts.length === 0) return;

        // Draw vertex markers
        verts.forEach(function(ll, i) {
            var marker = L.circleMarker(ll, {
                radius: 5,
                fillColor: '#3388ff',
                color: '#ffffff',
                weight: 2,
                fillOpacity: 1
            }).addTo(AppState.polygonLayer);
            tempVertexMarkers.push(marker);
        });

        // Draw the polyline connecting vertices
        if (verts.length >= 2) {
            // Close the path visually for preview when 3+ verts
            var path = verts.slice();
            if (path.length >= 3) {
                path.push(path[0]);
            }
            tempPolyline = L.polyline(path, {
                color: '#3388ff',
                weight: 2,
                dashArray: '6, 4',
                opacity: 0.8
            }).addTo(AppState.polygonLayer);
        }
    }

    /**
     * Remove temporary drawing layers (polyline and vertex markers).
     */
    function clearTempLayers() {
        if (tempPolyline) {
            AppState.polygonLayer.removeLayer(tempPolyline);
            tempPolyline = null;
        }
        tempVertexMarkers.forEach(function(m) {
            AppState.polygonLayer.removeLayer(m);
        });
        tempVertexMarkers = [];
    }

    // ===== POLYGON COMPLETION =====

    /**
     * Finalize the polygon: draw the filled shape, run analysis,
     * and show the stats panel.
     */
    function finishPolygon() {
        // Exit drawing mode
        AppState.polygonMode = false;
        var btn = document.getElementById('btn-polygon');
        if (btn) btn.classList.remove('active');
        document.getElementById('map').classList.remove('polygon-mode');

        // Remove temp drawing artifacts
        clearTempLayers();

        var verts = AppState.polygonVertices;

        // Draw the final polygon
        var polygon = L.polygon(verts, {
            color: '#3388ff',
            weight: 2,
            dashArray: '8, 6',
            opacity: 0.9,
            fillColor: '#3388ff',
            fillOpacity: 0.15
        }).addTo(AppState.polygonLayer);

        // Draw final vertex dots on top
        verts.forEach(function(ll) {
            L.circleMarker(ll, {
                radius: 4,
                fillColor: '#3388ff',
                color: '#ffffff',
                weight: 2,
                fillOpacity: 1
            }).addTo(AppState.polygonLayer);
        });

        // Run analysis and display results
        var results = analyzePolygon(verts);
        showStats(results, verts);
    }

    // ===== POINT-IN-POLYGON (RAY CASTING) =====

    /**
     * Test whether a point is inside a polygon using the ray casting algorithm.
     * Casts a ray from the point in the +x direction and counts crossings.
     * @param {number} lat - Point latitude
     * @param {number} lon - Point longitude
     * @param {Array} polygon - Array of {lat, lng} vertex objects
     * @returns {boolean}
     */
    function pointInPolygon(lat, lon, polygon) {
        var inside = false;
        var n = polygon.length;

        for (var i = 0, j = n - 1; i < n; j = i++) {
            var yi = polygon[i].lat;
            var xi = polygon[i].lng;
            var yj = polygon[j].lat;
            var xj = polygon[j].lng;

            var intersect = ((yi > lat) !== (yj > lat)) &&
                (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);

            if (intersect) inside = !inside;
        }

        return inside;
    }

    // ===== AREA CALCULATION (SHOELACE FORMULA) =====

    /**
     * Calculate the area of a polygon using the Shoelace formula.
     * Converts lat/lon coordinates to approximate feet using AppConfig.coordConversion.
     * @param {Array} verts - Array of {lat, lng} vertex objects
     * @returns {number} Area in square feet
     */
    function calculateAreaSqFt(verts) {
        if (verts.length < 3) return 0;

        // Convert lat/lon to feet relative to the first vertex
        var origin = verts[0];
        var points = verts.map(function(v) {
            var dLat = v.lat - origin.lat;
            var dLon = v.lng - origin.lng;
            var yFt = (dLat * conv.metersPerDegLat) / conv.feetToMeters;
            var xFt = (dLon * conv.metersPerDegLon) / conv.feetToMeters;
            return { x: xFt, y: yFt };
        });

        // Shoelace formula
        var area = 0;
        var n = points.length;
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }

        return Math.abs(area / 2);
    }

    // ===== SAMPLE ANALYSIS =====

    /**
     * Find all samples inside the polygon and compute summary statistics.
     * @param {Array} verts - Polygon vertices (Leaflet LatLng objects)
     * @returns {Object} Analysis results
     */
    function analyzePolygon(verts) {
        var data = AppState.data;
        var samplesInside = [];

        // Check 2025 sampled surface samples
        data.samples2025.forEach(function(s) {
            if (!s.sampled || !s.metals) return;
            if (pointInPolygon(s.lat, s.lon, verts)) {
                samplesInside.push({ sample: s, isEA: false });
            }
        });

        // Check EA historical samples
        data.eaSamples.forEach(function(e) {
            if (pointInPolygon(e.lat, e.lon, verts)) {
                samplesInside.push({ sample: e, isEA: true });
            }
        });

        // Compute per-analyte statistics
        var stats = {};
        analytes.forEach(function(analyte) {
            var values = [];
            var exceedCount = 0;

            samplesInside.forEach(function(entry) {
                var val = Utils.getSampleValue(entry.sample, analyte, entry.isEA);
                if (val !== null && val !== undefined && !isNaN(val)) {
                    values.push(val);
                    if (AppConfig.exceedsROD(val, analyte)) {
                        exceedCount++;
                    }
                }
            });

            var min = null;
            var max = null;
            var mean = null;

            if (values.length > 0) {
                min = Math.min.apply(null, values);
                max = Math.max.apply(null, values);
                var sum = values.reduce(function(a, b) { return a + b; }, 0);
                mean = sum / values.length;
            }

            stats[analyte] = {
                count: values.length,
                min: min,
                max: max,
                mean: mean,
                exceedances: exceedCount
            };
        });

        var areaSqFt = calculateAreaSqFt(verts);

        return {
            totalSamples: samplesInside.length,
            stats: stats,
            areaSqFt: areaSqFt
        };
    }

    // ===== STATS PANEL =====

    /**
     * Create the stats panel DOM element (hidden by default).
     * Positioned in the bottom-left of the map area.
     */
    function createStatsPanel() {
        statsPanel = document.createElement('div');
        statsPanel.id = 'polygonStatsPanel';
        statsPanel.style.cssText = [
            'display: none',
            'position: absolute',
            'bottom: 30px',
            'left: 10px',
            'z-index: 1000',
            'background: rgba(20, 20, 20, 0.92)',
            'color: #ddd',
            'border: 1px solid #3388ff',
            'border-radius: 6px',
            'padding: 10px 14px',
            'font-family: Arial, sans-serif',
            'font-size: 11px',
            'min-width: 280px',
            'max-width: 340px',
            'pointer-events: auto',
            'box-shadow: 0 2px 12px rgba(0,0,0,0.5)'
        ].join(';');

        // Prevent map interactions when interacting with the panel
        L.DomEvent.disableClickPropagation(statsPanel);
        L.DomEvent.disableScrollPropagation(statsPanel);

        document.getElementById('map').appendChild(statsPanel);
    }

    /**
     * Populate and display the stats panel with analysis results.
     * @param {Object} results - Output from analyzePolygon()
     * @param {Array} verts - Polygon vertices
     */
    function showStats(results, verts) {
        var abbrevs = AppConfig.getAnalyteAbbreviations();
        var thresholds = AppConfig.thresholds;

        // Build header
        var html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
            '<span style="color:#3388ff; font-weight:bold; font-size:12px;">Polygon Analysis</span>' +
            '<button id="polygonClearBtn" style="background:none; border:1px solid #666; color:#aaa; ' +
            'font-size:9px; padding:2px 8px; cursor:pointer; border-radius:3px;">Clear</button>' +
            '</div>';

        // Summary row
        html += '<div style="display:flex; justify-content:space-between; margin-bottom:6px; ' +
            'padding-bottom:6px; border-bottom:1px solid #444;">' +
            '<span>Samples: <b style="color:#fff;">' + results.totalSamples + '</b></span>' +
            '<span>Area: <b style="color:#fff;">' + formatArea(results.areaSqFt) + '</b> ft\u00B2</span>' +
            '</div>';

        if (results.totalSamples === 0) {
            html += '<div style="color:#888; font-style:italic; text-align:center; padding:8px 0;">' +
                'No sampled points inside polygon</div>';
        } else {
            // Analyte stats table
            html += '<table style="width:100%; border-collapse:collapse; font-size:10px;">';
            html += '<tr style="color:#888; border-bottom:1px solid #444;">' +
                '<th style="text-align:left; padding:2px 4px; font-weight:normal;">Analyte</th>' +
                '<th style="text-align:right; padding:2px 4px; font-weight:normal;">Min</th>' +
                '<th style="text-align:right; padding:2px 4px; font-weight:normal;">Max</th>' +
                '<th style="text-align:right; padding:2px 4px; font-weight:normal;">Mean</th>' +
                '<th style="text-align:right; padding:2px 4px; font-weight:normal;">Exceed</th>' +
                '</tr>';

            analytes.forEach(function(analyte) {
                var s = results.stats[analyte];
                var thresh = thresholds[analyte];
                var hasExceed = s.exceedances > 0;
                var exceedStyle = hasExceed
                    ? 'color:#d63e2a; font-weight:bold;'
                    : 'color:#72af26;';

                html += '<tr style="border-bottom:1px solid #333;">' +
                    '<td style="padding:3px 4px; color:#0af;">' + abbrevs[analyte] +
                    ' <span style="color:#555; font-size:8px;">(' + thresh.unit + ')</span></td>' +
                    '<td style="text-align:right; padding:3px 4px;">' + Utils.formatVal(s.min) + '</td>' +
                    '<td style="text-align:right; padding:3px 4px;">' + Utils.formatVal(s.max) + '</td>' +
                    '<td style="text-align:right; padding:3px 4px; color:#fff;">' + Utils.formatVal(s.mean) + '</td>' +
                    '<td style="text-align:right; padding:3px 4px; ' + exceedStyle + '">' +
                    s.exceedances + '/' + s.count +
                    (hasExceed ? ' \u26A0' : '') + '</td>' +
                    '</tr>';
            });

            html += '</table>';

            // ROD threshold reference line
            html += '<div style="margin-top:6px; padding-top:4px; border-top:1px solid #444; ' +
                'color:#666; font-size:8px;">ROD Levels: Hg>' + thresholds.Mercury.high +
                '  As>' + thresholds.Arsenic.high +
                '  Sb>' + thresholds.Antimony.high +
                '  Tl>' + thresholds.Thallium.high + '</div>';
        }

        statsPanel.innerHTML = html;
        statsPanel.style.display = 'block';

        // Bind clear button
        document.getElementById('polygonClearBtn').addEventListener('click', clear);
    }

    /**
     * Format an area value for display with thousand separators.
     * @param {number} sqft
     * @returns {string}
     */
    function formatArea(sqft) {
        if (sqft >= 1000) {
            return Math.round(sqft).toLocaleString();
        }
        return sqft.toFixed(1);
    }

    // ===== CLEAR / RESET =====

    /**
     * Clear the finished polygon, stats panel, and all state.
     * Public method accessible from outside the module.
     */
    function clear() {
        clearPolygon();
    }

    /**
     * Internal clear: remove all polygon layers, hide stats, reset vertices.
     */
    function clearPolygon() {
        clearDrawingState();
        AppState.polygonLayer.clearLayers();

        if (statsPanel) {
            statsPanel.style.display = 'none';
            statsPanel.innerHTML = '';
        }
    }

    /**
     * Clear only the in-progress drawing state (temp layers and vertices).
     */
    function clearDrawingState() {
        clearTempLayers();
        AppState.polygonVertices = [];
    }

    // Public API
    return {
        init: init,
        toggle: toggle,
        clear: clear
    };
})();
