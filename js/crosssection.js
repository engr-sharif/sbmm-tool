/**
 * SBMM Planning Tool - Cross-Section / Transect Tool
 *
 * Allows the user to draw a transect line across the map by clicking two points,
 * then generates a depth cross-section showing all sample data within a
 * configurable corridor width. Samples are color-coded by contamination level
 * for the currently selected analyte.
 *
 * Integration:
 *   - Call CrossSectionModule.init() after MapModule.init() in app.js
 *   - Add a button with id="btn-crosssection" to trigger CrossSectionModule.toggle()
 *   - The module hooks into map clicks when active (sets AppState.currentMode to
 *     'view' so planning clicks are suppressed).
 *
 * Data sources searched:
 *   AppState.data.samples2025     (surface, 0-0.5 ft)
 *   AppState.data.eaSamples       (surface, 0-0.5 ft)
 *   AppState.data.testPits2025    (multi-depth intervals)
 *   AppState.data.soilBorings2025 (multi-depth intervals)
 */
var CrossSectionModule = (function() {
    'use strict';

    // ===== CONFIGURATION =====

    var DEFAULT_CORRIDOR_FT = 50;
    var CANVAS_WIDTH = 960;
    var CANVAS_HEIGHT = 520;
    var MARGIN = { top: 80, right: 50, bottom: 70, left: 75 };
    var COLUMN_WIDTH_PX = 24;
    var MIN_RECT_HEIGHT_PX = 8;
    var METERS_TO_FEET = 3.28084;
    var conv = AppConfig.coordConversion;

    // ===== MODULE STATE =====

    var initialized = false;
    var active = false;
    var corridorWidthFt = DEFAULT_CORRIDOR_FT;
    var transectPoints = [];       // Array of L.LatLng (max 2)
    var transectMarkers = [];      // Leaflet circle markers on map
    var transectLine = null;       // Leaflet polyline on map
    var corridorPolygon = null;    // Leaflet polygon showing corridor
    var savedMode = 'view';        // Mode before activation
    var panelEl = null;            // Panel DOM element
    var canvasEl = null;           // Canvas DOM element
    var statusEl = null;           // Status bar DOM element
    var lastSamples = null;        // Cached samples for re-render on analyte change

    // ===== INITIALIZATION =====

    function init() {
        if (initialized) return;
        initialized = true;

        buildPanel();
        buildStatusBar();
        bindKeyboard();
        bindAnalyteListener();
    }

    // ===== DOM CONSTRUCTION =====

    /**
     * Build the cross-section panel overlay.
     * Structure: header bar (title, corridor input, close button) + canvas.
     */
    function buildPanel() {
        panelEl = document.createElement('div');
        panelEl.id = 'crossSectionPanel';
        applyStyles(panelEl, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2000',
            background: '#1e1e2e',
            border: '2px solid #0af',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            display: 'none',
            overflow: 'hidden',
            fontFamily: 'Arial, sans-serif',
            maxWidth: '98vw'
        });

        // --- Header bar ---
        var header = document.createElement('div');
        applyStyles(header, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 16px',
            background: '#0d1b2a',
            borderBottom: '1px solid #0af',
            cursor: 'move',
            userSelect: 'none'
        });

        var titleEl = document.createElement('span');
        titleEl.id = 'csTitle';
        applyStyles(titleEl, {
            color: '#0af',
            fontSize: '13px',
            fontWeight: 'bold'
        });
        titleEl.textContent = 'Cross-Section';
        header.appendChild(titleEl);

        // Controls wrapper
        var controls = document.createElement('div');
        applyStyles(controls, {
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
        });

        // Corridor width input
        controls.appendChild(makeSpan('Corridor:', '#888', '10px'));

        var cwInput = document.createElement('input');
        cwInput.id = 'csCorridorInput';
        cwInput.type = 'number';
        cwInput.value = corridorWidthFt;
        cwInput.min = '10';
        cwInput.max = '500';
        cwInput.step = '10';
        applyStyles(cwInput, {
            width: '52px',
            background: '#2a2a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '3px',
            padding: '3px 4px',
            fontSize: '11px',
            textAlign: 'center'
        });
        cwInput.addEventListener('change', function() {
            corridorWidthFt = Math.max(10, Math.min(500, parseInt(this.value) || DEFAULT_CORRIDOR_FT));
            this.value = corridorWidthFt;
            recalculateIfReady();
        });
        controls.appendChild(cwInput);
        controls.appendChild(makeSpan('ft', '#888', '10px'));

        // Close button
        var closeBtn = document.createElement('button');
        applyStyles(closeBtn, {
            background: 'none',
            border: '1px solid #555',
            color: '#ff4444',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '1px 8px',
            borderRadius: '3px',
            marginLeft: '12px',
            lineHeight: '1'
        });
        closeBtn.innerHTML = '&#215;';
        closeBtn.title = 'Close (Esc)';
        closeBtn.addEventListener('click', function() {
            hidePanel();
            clearTransect();
            lastSamples = null;
            if (active) {
                showStatus('Click first point of transect line...');
            }
        });
        closeBtn.addEventListener('mouseenter', function() { this.style.background = '#442222'; });
        closeBtn.addEventListener('mouseleave', function() { this.style.background = 'none'; });
        controls.appendChild(closeBtn);

        header.appendChild(controls);
        panelEl.appendChild(header);

        // --- Canvas container ---
        var canvasWrap = document.createElement('div');
        applyStyles(canvasWrap, { padding: '0', overflow: 'auto' });

        canvasEl = document.createElement('canvas');
        canvasEl.id = 'csCanvas';
        applyStyles(canvasEl, { display: 'block' });
        canvasWrap.appendChild(canvasEl);
        panelEl.appendChild(canvasWrap);

        document.body.appendChild(panelEl);

        // Make the panel draggable via the header
        enableDrag(panelEl, header);
    }

    /**
     * Build the floating status bar that shows instructions while active.
     */
    function buildStatusBar() {
        statusEl = document.createElement('div');
        statusEl.id = 'csStatus';
        applyStyles(statusEl, {
            position: 'fixed',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2000',
            background: 'rgba(0,0,0,0.88)',
            color: '#ffff00',
            padding: '8px 24px',
            borderRadius: '4px',
            fontSize: '13px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            border: '1px solid #ffff00',
            display: 'none',
            pointerEvents: 'none',
            whiteSpace: 'nowrap'
        });
        document.body.appendChild(statusEl);
    }

    /**
     * Bind Escape key to deactivate the tool.
     */
    function bindKeyboard() {
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && active) {
                deactivate();
            }
        });
    }

    /**
     * Listen for analyte selector changes to auto-refresh the cross-section.
     */
    function bindAnalyteListener() {
        var sel = document.getElementById('colorBySelect');
        if (sel) {
            sel.addEventListener('change', function() {
                if (panelVisible() && transectPoints.length === 2) {
                    var samples = collectSamples();
                    if (samples.length > 0) {
                        lastSamples = samples;
                        renderPanel(samples);
                    }
                }
            });
        }
    }

    // ===== TOGGLE / ACTIVATE / DEACTIVATE =====

    function toggle() {
        if (!initialized) init();
        if (active) {
            deactivate();
        } else {
            activate();
        }
    }

    function activate() {
        if (active) return;
        active = true;
        AppState.crossSectionMode = true;
        savedMode = AppState.currentMode;
        AppState.currentMode = 'view';

        // Turn off measurement tool if active
        if (AppState.measureMode) {
            AnalysisModule.toggleMeasureMode();
        }

        clearTransect();
        lastSamples = null;
        hidePanel();
        showStatus('Click first point of transect line...');

        document.getElementById('map').style.cursor = 'crosshair';
        AppState.map.on('click', handleTransectClick);

        setButtonActive(true);
    }

    function deactivate() {
        if (!active) return;
        active = false;
        AppState.crossSectionMode = false;
        AppState.currentMode = savedMode;

        clearTransect();
        hidePanel();
        hideStatus();
        lastSamples = null;

        document.getElementById('map').style.cursor = '';
        AppState.map.off('click', handleTransectClick);

        setButtonActive(false);
    }

    function isActive() {
        return active;
    }

    // ===== STATUS BAR =====

    function showStatus(msg) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.display = 'block';
    }

    function hideStatus() {
        if (statusEl) statusEl.style.display = 'none';
    }

    // ===== MAP CLICK HANDLER =====

    function handleTransectClick(e) {
        if (!active) return;
        // Defer to measure mode if somehow active
        if (AppState.measureMode) return;

        // If a complete transect already exists, clear and start fresh
        if (transectPoints.length >= 2) {
            clearTransect();
            hidePanel();
            lastSamples = null;
        }

        var latlng = e.latlng;

        // Place marker
        var marker = L.circleMarker(latlng, {
            radius: 7,
            fillColor: '#ffff00',
            color: '#000',
            weight: 2,
            fillOpacity: 1
        }).addTo(AppState.map);

        transectMarkers.push(marker);
        transectPoints.push(latlng);

        if (transectPoints.length === 1) {
            showStatus('Click second point of transect line...');

        } else if (transectPoints.length === 2) {
            // Validate minimum length (at least ~3 meters)
            var lengthM = transectPoints[0].distanceTo(transectPoints[1]);
            if (lengthM < 3) {
                showStatus('Transect too short. Click two distinct points.');
                // Remove the second point
                AppState.map.removeLayer(transectMarkers.pop());
                transectPoints.pop();
                return;
            }

            hideStatus();
            drawTransectOnMap();

            var samples = collectSamples();
            if (samples.length > 0) {
                lastSamples = samples;
                renderPanel(samples);
            } else {
                showStatus('No samples within ' + corridorWidthFt + 'ft corridor. Click to start new transect.');
            }
        }
    }

    // ===== TRANSECT MAP DRAWING =====

    /**
     * Draw the transect line and corridor polygon on the map.
     */
    function drawTransectOnMap() {
        if (transectPoints.length < 2) return;
        var a = transectPoints[0];
        var b = transectPoints[1];

        // Dashed yellow transect line
        transectLine = L.polyline([a, b], {
            color: '#ffff00',
            weight: 3,
            dashArray: '12, 6',
            opacity: 0.9
        }).addTo(AppState.map);

        // Semi-transparent corridor polygon
        var halfWidthM = corridorWidthFt * conv.feetToMeters;
        var bearing = computeBearing(a, b);
        var perpL = (bearing + 90) % 360;
        var perpR = (bearing + 270) % 360;

        var c1 = offsetLatLng(a, perpL, halfWidthM);
        var c2 = offsetLatLng(a, perpR, halfWidthM);
        var c3 = offsetLatLng(b, perpR, halfWidthM);
        var c4 = offsetLatLng(b, perpL, halfWidthM);

        corridorPolygon = L.polygon([c1, c2, c3, c4], {
            color: '#ffff00',
            weight: 1,
            fillColor: '#ffff00',
            fillOpacity: 0.07,
            dashArray: '4, 4',
            opacity: 0.4
        }).addTo(AppState.map);
    }

    /**
     * Remove all transect-related map elements.
     */
    function clearTransect() {
        transectMarkers.forEach(function(m) { AppState.map.removeLayer(m); });
        transectMarkers = [];
        transectPoints = [];
        if (transectLine) {
            AppState.map.removeLayer(transectLine);
            transectLine = null;
        }
        if (corridorPolygon) {
            AppState.map.removeLayer(corridorPolygon);
            corridorPolygon = null;
        }
    }

    // ===== GEOMETRY HELPERS =====

    /**
     * Compute forward bearing (degrees) from one LatLng to another.
     */
    function computeBearing(from, to) {
        var dLon = (to.lng - from.lng) * Math.PI / 180;
        var lat1 = from.lat * Math.PI / 180;
        var lat2 = to.lat * Math.PI / 180;
        var y = Math.sin(dLon) * Math.cos(lat2);
        var x = Math.cos(lat1) * Math.sin(lat2) -
                Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    /**
     * Offset a LatLng by a given bearing and distance (meters).
     * Uses spherical Earth approximation.
     */
    function offsetLatLng(latlng, bearingDeg, distM) {
        var R = 6378137;
        var brng = bearingDeg * Math.PI / 180;
        var lat1 = latlng.lat * Math.PI / 180;
        var lon1 = latlng.lng * Math.PI / 180;
        var dR = distM / R;

        var lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(dR) +
            Math.cos(lat1) * Math.sin(dR) * Math.cos(brng)
        );
        var lon2 = lon1 + Math.atan2(
            Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
            Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
        );
        return L.latLng(lat2 * 180 / Math.PI, lon2 * 180 / Math.PI);
    }

    /**
     * Project a point onto a line segment and return the perpendicular distance
     * and the parameter t (0 at point A, 1 at point B).
     * Uses cosine-weighted longitude for approximate Cartesian projection.
     *
     * @param {L.LatLng} p - The point
     * @param {L.LatLng} a - Segment start
     * @param {L.LatLng} b - Segment end
     * @returns {{ distance: number, t: number }} distance in meters, t in [0,1]
     */
    function projectOntoSegment(p, a, b) {
        var cosLat = Math.cos(a.lat * Math.PI / 180);
        var apLat = p.lat - a.lat;
        var apLng = (p.lng - a.lng) * cosLat;
        var abLat = b.lat - a.lat;
        var abLng = (b.lng - a.lng) * cosLat;

        var ab2 = abLat * abLat + abLng * abLng;
        if (ab2 < 1e-20) {
            return { distance: a.distanceTo(p), t: 0 };
        }

        var t = (apLat * abLat + apLng * abLng) / ab2;
        t = Math.max(0, Math.min(1, t));

        var closestLat = a.lat + t * (b.lat - a.lat);
        var closestLng = a.lng + t * (b.lng - a.lng);
        var closest = L.latLng(closestLat, closestLng);

        return {
            distance: closest.distanceTo(p),
            t: t
        };
    }

    // ===== SAMPLE COLLECTION =====

    /**
     * Collect all sample intervals within the corridor of the current transect.
     * Returns an array of interval objects sorted by distance along the transect.
     */
    function collectSamples() {
        var data = AppState.data;
        var a = transectPoints[0];
        var b = transectPoints[1];
        var corridorM = corridorWidthFt * conv.feetToMeters;
        var transectFt = a.distanceTo(b) * METERS_TO_FEET;
        var analyte = AppState.currentAnalyte;
        var results = [];

        /**
         * Test a point against the corridor and push an interval if inside.
         */
        function tryAdd(lat, lon, id, type, depthStart, depthEnd, value, depthLabel) {
            var p = L.latLng(lat, lon);
            var proj = projectOntoSegment(p, a, b);
            if (proj.distance <= corridorM) {
                results.push({
                    id: id,
                    type: type,
                    distAlong: proj.t * transectFt,
                    depthStart: depthStart,
                    depthEnd: depthEnd,
                    value: value,
                    depthLabel: depthLabel,
                    lat: lat,
                    lon: lon,
                    offset: proj.distance * METERS_TO_FEET
                });
            }
        }

        // 2025 surface samples (depth 0 - 0.5 ft)
        data.samples2025.forEach(function(s) {
            if (!s.sampled) return;
            var val = Utils.getSampleValue(s, analyte, false);
            tryAdd(s.lat, s.lon, s.label, 'SS', 0, 0.5, val, '0-6 in');
        });

        // EA historical surface samples (depth 0 - 0.5 ft)
        data.eaSamples.forEach(function(e) {
            var val = Utils.getSampleValue(e, analyte, true);
            tryAdd(e.lat, e.lon, e.id, 'EA', 0, 0.5, val, '0-6 in');
        });

        // Test pits (multi-depth)
        data.testPits2025.forEach(function(tp) {
            if (!tp.depths || !tp.depths.length) return;
            tp.depths.forEach(function(d) {
                var val = d.metals ? d.metals[analyte] : null;
                tryAdd(tp.lat, tp.lon, tp.id, 'TP', d.start, d.end, val, d.label);
            });
        });

        // Soil borings (multi-depth)
        data.soilBorings2025.forEach(function(sb) {
            if (!sb.depths || !sb.depths.length) return;
            sb.depths.forEach(function(d) {
                var val = d.metals ? d.metals[analyte] : null;
                tryAdd(sb.lat, sb.lon, sb.id, 'SB', d.start, d.end, val, d.label);
            });
        });

        results.sort(function(ra, rb) { return ra.distAlong - rb.distAlong; });
        return results;
    }

    // ===== PANEL DISPLAY =====

    function renderPanel(samples) {
        var analyte = AppState.currentAnalyte;
        var thresh = AppConfig.thresholds[analyte];
        var unitStr = thresh ? ' (' + thresh.unit + ')' : '';

        // Update title
        var titleEl = document.getElementById('csTitle');
        if (titleEl) {
            titleEl.textContent = 'Cross-Section: ' + analyte + unitStr;
        }

        // Set up canvas with device pixel ratio for crisp rendering
        var dpr = window.devicePixelRatio || 1;
        canvasEl.width = CANVAS_WIDTH * dpr;
        canvasEl.height = CANVAS_HEIGHT * dpr;
        canvasEl.style.width = CANVAS_WIDTH + 'px';
        canvasEl.style.height = CANVAS_HEIGHT + 'px';

        var ctx = canvasEl.getContext('2d');
        ctx.scale(dpr, dpr);

        renderCrossSection(ctx, samples);

        // Reset panel position to centered bottom
        panelEl.style.left = '50%';
        panelEl.style.bottom = '20px';
        panelEl.style.top = 'auto';
        panelEl.style.transform = 'translateX(-50%)';
        panelEl.style.display = 'block';
    }

    function hidePanel() {
        if (panelEl) panelEl.style.display = 'none';
    }

    function panelVisible() {
        return panelEl && panelEl.style.display !== 'none';
    }

    /**
     * Recalculate the cross-section if a transect is currently drawn.
     * Called when corridor width changes.
     */
    function recalculateIfReady() {
        if (transectPoints.length < 2) return;

        // Redraw the corridor polygon on the map
        if (corridorPolygon) {
            AppState.map.removeLayer(corridorPolygon);
            corridorPolygon = null;
        }
        var a = transectPoints[0];
        var b = transectPoints[1];
        var halfWidthM = corridorWidthFt * conv.feetToMeters;
        var bearing = computeBearing(a, b);
        var perpL = (bearing + 90) % 360;
        var perpR = (bearing + 270) % 360;
        corridorPolygon = L.polygon([
            offsetLatLng(a, perpL, halfWidthM),
            offsetLatLng(a, perpR, halfWidthM),
            offsetLatLng(b, perpR, halfWidthM),
            offsetLatLng(b, perpL, halfWidthM)
        ], {
            color: '#ffff00', weight: 1, fillColor: '#ffff00',
            fillOpacity: 0.07, dashArray: '4, 4', opacity: 0.4
        }).addTo(AppState.map);

        // Recollect samples and re-render
        var samples = collectSamples();
        if (samples.length > 0) {
            lastSamples = samples;
            renderPanel(samples);
        } else {
            hidePanel();
            showStatus('No samples within ' + corridorWidthFt + 'ft corridor.');
        }
    }

    // ===== CANVAS RENDERING =====

    /**
     * Render the full cross-section diagram on a 2D canvas context.
     * Assumes the context has already been scaled for device pixel ratio.
     */
    function renderCrossSection(ctx, samples) {
        var w = CANVAS_WIDTH;
        var h = CANVAS_HEIGHT;
        var analyte = AppState.currentAnalyte;
        var thresh = AppConfig.thresholds[analyte];

        // Plot area bounds
        var pL = MARGIN.left;
        var pR = w - MARGIN.right;
        var pT = MARGIN.top;
        var pB = h - MARGIN.bottom;
        var pW = pR - pL;
        var pH = pB - pT;

        // Transect length in feet
        var transectFt = transectPoints[0].distanceTo(transectPoints[1]) * METERS_TO_FEET;

        // Determine maximum depth from data
        var maxDepth = 1;
        samples.forEach(function(s) {
            if (s.depthEnd > maxDepth) maxDepth = s.depthEnd;
        });
        // Round up to a clean number
        if (maxDepth <= 2)       maxDepth = 2;
        else if (maxDepth <= 5)  maxDepth = 5;
        else if (maxDepth <= 10) maxDepth = 10;
        else if (maxDepth <= 15) maxDepth = 15;
        else                     maxDepth = Math.ceil(maxDepth / 10) * 10;

        // Scale functions: data units -> pixel coordinates
        function xPx(dist) { return pL + (dist / transectFt) * pW; }
        function yPx(depth) { return pT + (depth / maxDepth) * pH; }

        // ---- Background ----
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, w, h);

        // Plot area background
        ctx.fillStyle = '#16213e';
        ctx.fillRect(pL, pT, pW, pH);

        // ---- Grid lines ----
        var depthStep = niceStep(maxDepth, Math.max(2, Math.floor(pH / 40)));
        var distStep = niceStep(transectFt, Math.max(2, Math.floor(pW / 80)));

        // Horizontal grid (depth)
        ctx.strokeStyle = '#2a3a5c';
        ctx.lineWidth = 0.5;
        for (var d = depthStep; d <= maxDepth; d += depthStep) {
            var gy = yPx(d);
            ctx.beginPath();
            ctx.moveTo(pL, gy);
            ctx.lineTo(pR, gy);
            ctx.stroke();
        }

        // Vertical grid (distance)
        for (var dd = distStep; dd < transectFt; dd += distStep) {
            var gx = xPx(dd);
            ctx.beginPath();
            ctx.moveTo(gx, pT);
            ctx.lineTo(gx, pB);
            ctx.stroke();
        }

        // ---- Ground surface line ----
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pL, yPx(0));
        ctx.lineTo(pR, yPx(0));
        ctx.stroke();

        ctx.fillStyle = '#8B6914';
        ctx.font = '9px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Ground Surface', pR, yPx(0) - 3);

        // ---- Axes ----
        drawAxes(ctx, pL, pR, pT, pB, pW, pH, maxDepth, transectFt, depthStep, distStep, xPx, yPx);

        // ---- Plot border ----
        ctx.strokeStyle = '#4a5a8e';
        ctx.lineWidth = 1;
        ctx.strokeRect(pL, pT, pW, pH);

        // ---- Group sample intervals by location ID ----
        var groups = {};
        var groupOrder = [];
        samples.forEach(function(s) {
            if (!groups[s.id]) {
                groups[s.id] = {
                    id: s.id,
                    type: s.type,
                    distAlong: s.distAlong,
                    intervals: []
                };
                groupOrder.push(s.id);
            }
            groups[s.id].intervals.push(s);
        });

        // Compute display x-positions and resolve overlaps
        var displayPositions = resolveOverlaps(groupOrder.map(function(id) {
            return { id: id, x: xPx(groups[id].distAlong) };
        }), COLUMN_WIDTH_PX + 2, pL, pR);

        // ---- Draw sample columns ----
        var colHalf = COLUMN_WIDTH_PX / 2;

        displayPositions.forEach(function(pos) {
            var group = groups[pos.id];
            var cx = pos.x;

            // Vertical guide line from surface to deepest interval
            var deepest = 0;
            group.intervals.forEach(function(iv) {
                if (iv.depthEnd > deepest) deepest = iv.depthEnd;
            });

            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(cx, yPx(0));
            ctx.lineTo(cx, yPx(deepest));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // Draw each depth interval as a colored rectangle
            group.intervals.forEach(function(iv) {
                var x1 = cx - colHalf;
                var y1 = yPx(iv.depthStart);
                var y2 = yPx(iv.depthEnd);
                var rectH = Math.max(y2 - y1, MIN_RECT_HEIGHT_PX);

                var color = AppConfig.getColorForValue(iv.value, analyte);

                // Filled rectangle
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = color;
                ctx.fillRect(x1, y1, COLUMN_WIDTH_PX, rectH);
                ctx.globalAlpha = 1.0;

                // Border
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 0.75;
                ctx.strokeRect(x1, y1, COLUMN_WIDTH_PX, rectH);

                // Value text (only if rectangle is tall enough)
                if (rectH >= 16 && iv.value !== null && iv.value !== undefined) {
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 9px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.shadowColor = 'rgba(0,0,0,0.7)';
                    ctx.shadowBlur = 2;
                    ctx.fillText(Utils.formatVal(iv.value), cx, y1 + rectH / 2);
                    ctx.shadowBlur = 0;
                }
            });

            // ---- Sample ID label (rotated above plot) ----
            ctx.save();
            ctx.translate(cx, pT - 6);
            ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = typeColor(group.type);
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(group.id, 0, 0);
            ctx.restore();

            // Small tick mark connecting label to column
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(cx, pT - 4);
            ctx.lineTo(cx, pT);
            ctx.stroke();
        });

        // ---- Title ----
        drawTitle(ctx, w, pL, pR, analyte, thresh, transectFt, groupOrder.length);

        // ---- Legend ----
        drawLegend(ctx, pL, pR, h, analyte, thresh);
    }

    /**
     * Draw depth (Y) and distance (X) axes with labels and title text.
     */
    function drawAxes(ctx, pL, pR, pT, pB, pW, pH, maxDepth, transectFt, depthStep, distStep, xPx, yPx) {
        // ---- Depth axis labels (left) ----
        ctx.fillStyle = '#aaaacc';
        ctx.font = '11px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (var d = 0; d <= maxDepth; d += depthStep) {
            var yy = yPx(d);
            ctx.fillText(formatDepthLabel(d), pL - 8, yy);

            // Small tick mark
            ctx.strokeStyle = '#4a5a8e';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pL - 4, yy);
            ctx.lineTo(pL, yy);
            ctx.stroke();
        }

        // Depth axis title (rotated)
        ctx.save();
        ctx.translate(16, pT + pH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#8888bb';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Depth (ft bgs)', 0, 0);
        ctx.restore();

        // ---- Distance axis labels (bottom) ----
        ctx.fillStyle = '#aaaacc';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (var dd = 0; dd <= transectFt; dd += distStep) {
            var xx = xPx(dd);
            ctx.fillText(Math.round(dd).toString(), xx, pB + 6);

            // Small tick mark
            ctx.strokeStyle = '#4a5a8e';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xx, pB);
            ctx.lineTo(xx, pB + 4);
            ctx.stroke();
        }

        // Distance axis title
        ctx.fillStyle = '#8888bb';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Distance Along Transect (ft)', pL + pW / 2, pB + 26);
    }

    /**
     * Draw the title and summary in the top region of the canvas.
     */
    function drawTitle(ctx, w, pL, pR, analyte, thresh, transectFt, locationCount) {
        // Main title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Cross-Section: ' + analyte, pL, 8);

        // Subtitle with metadata
        ctx.fillStyle = '#7777aa';
        ctx.font = '11px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(
            'Transect: ' + Math.round(transectFt) + ' ft' +
            '  |  Corridor: \u00b1' + corridorWidthFt + ' ft' +
            '  |  ' + locationCount + ' location' + (locationCount !== 1 ? 's' : ''),
            pL, 28
        );

        // Threshold info on the right
        if (thresh) {
            ctx.fillStyle = '#666688';
            ctx.font = '10px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(
                'PMB: ' + thresh.low + ' ' + thresh.unit +
                '  |  ROD: ' + thresh.high + ' ' + thresh.unit,
                pR, 10
            );
        }
    }

    /**
     * Draw the color legend and sample type legend along the bottom of the canvas.
     */
    function drawLegend(ctx, pL, pR, canvasH, analyte, thresh) {
        var y = canvasH - 15;
        var x = pL;

        ctx.font = '10px Arial';
        ctx.textBaseline = 'middle';

        // "Legend:" label
        ctx.fillStyle = '#7777aa';
        ctx.textAlign = 'left';
        ctx.fillText('Legend:', x, y);
        x += 48;

        if (thresh) {
            // Below PMB (green)
            x = drawLegendBox(ctx, x, y, AppConfig.colors.low,
                '\u2264 ' + thresh.low + ' (Below PMB)');

            // Above PMB (orange) -- only if PMB differs from ROD
            if (thresh.high !== thresh.low) {
                x = drawLegendBox(ctx, x, y, AppConfig.colors.medium,
                    thresh.low + '-' + thresh.high + ' (Above PMB)');
            }

            // Exceeds ROD (red)
            x = drawLegendBox(ctx, x, y, AppConfig.colors.high,
                '> ' + thresh.high + ' (Exceeds ROD)');
        }

        // No Data (gray)
        x = drawLegendBox(ctx, x, y, AppConfig.colors.notSampled, 'No Data');

        // Separator
        x += 6;
        ctx.fillStyle = '#444466';
        ctx.fillText('|', x, y);
        x += 10;

        // Sample type legend
        var types = [
            { key: 'SS', label: 'Surface' },
            { key: 'EA', label: 'EA Hist.' },
            { key: 'TP', label: 'Test Pit' },
            { key: 'SB', label: 'Soil Boring' }
        ];
        types.forEach(function(t) {
            ctx.fillStyle = typeColor(t.key);
            ctx.textAlign = 'left';
            ctx.fillText('\u25CF', x, y);
            x += 10;
            ctx.fillStyle = '#aaaacc';
            ctx.fillText(t.label, x, y);
            x += ctx.measureText(t.label).width + 12;
        });
    }

    /**
     * Draw a single legend color box with label. Returns the new x position.
     */
    function drawLegendBox(ctx, x, y, color, label) {
        // Color box
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y - 5, 12, 10);
        ctx.globalAlpha = 1.0;

        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y - 5, 12, 10);

        // Label
        ctx.fillStyle = '#aaaacc';
        ctx.font = '10px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 15, y);

        return x + 15 + ctx.measureText(label).width + 14;
    }

    // ===== RENDERING HELPERS =====

    /**
     * Resolve horizontal overlaps between columns by nudging positions apart.
     * Operates on an array of { id, x } objects.
     */
    function resolveOverlaps(positions, minGap, plotLeft, plotRight) {
        if (positions.length <= 1) return positions;

        // Sort by x
        positions.sort(function(a, b) { return a.x - b.x; });

        // Push overlapping items apart (iterative relaxation)
        for (var pass = 0; pass < 5; pass++) {
            var changed = false;
            for (var i = 1; i < positions.length; i++) {
                var gap = positions[i].x - positions[i - 1].x;
                if (gap < minGap) {
                    var shift = (minGap - gap) / 2;
                    positions[i - 1].x -= shift;
                    positions[i].x += shift;
                    changed = true;
                }
            }
            if (!changed) break;
        }

        // Clamp to plot bounds
        var halfCol = COLUMN_WIDTH_PX / 2;
        positions.forEach(function(p) {
            if (p.x - halfCol < plotLeft) p.x = plotLeft + halfCol;
            if (p.x + halfCol > plotRight) p.x = plotRight - halfCol;
        });

        return positions;
    }

    /**
     * Compute a "nice" step value for axis tick marks.
     * @param {number} range - Total axis range
     * @param {number} maxTicks - Desired maximum number of ticks
     * @returns {number}
     */
    function niceStep(range, maxTicks) {
        if (maxTicks < 2) maxTicks = 2;
        var rough = range / maxTicks;
        var mag = Math.pow(10, Math.floor(Math.log10(rough)));
        var norm = rough / mag;
        var nice;
        if (norm <= 1.5)      nice = 1;
        else if (norm <= 3.5) nice = 2;
        else if (norm <= 7.5) nice = 5;
        else                  nice = 10;
        return nice * mag;
    }

    /**
     * Format a depth value for axis labels.
     */
    function formatDepthLabel(d) {
        if (d === Math.floor(d)) return d.toString();
        return d.toFixed(1);
    }

    /**
     * Get the display color for a sample type code.
     */
    function typeColor(type) {
        switch (type) {
            case 'SS': return '#00ff88';
            case 'EA': return '#cd853f';
            case 'TP': return '#cc6600';
            case 'SB': return '#00aaff';
            default:   return '#aaaaaa';
        }
    }

    // ===== DOM UTILITIES =====

    /**
     * Apply a style object to an element.
     */
    function applyStyles(el, styles) {
        Object.keys(styles).forEach(function(prop) {
            el.style[prop] = styles[prop];
        });
    }

    /**
     * Create a small styled span element.
     */
    function makeSpan(text, color, fontSize) {
        var span = document.createElement('span');
        span.textContent = text;
        applyStyles(span, { color: color, fontSize: fontSize });
        return span;
    }

    /**
     * Update the toggle button's active state.
     */
    function setButtonActive(isActive) {
        var btn = document.getElementById('btn-crosssection');
        if (!btn) return;
        if (isActive) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    /**
     * Make a panel draggable by a handle element.
     */
    function enableDrag(panel, handle) {
        var dragging = false;
        var startX, startY, origLeft, origTop;

        handle.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            var rect = panel.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
            // Switch from centered positioning to absolute
            panel.style.left = origLeft + 'px';
            panel.style.top = origTop + 'px';
            panel.style.bottom = 'auto';
            panel.style.transform = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            panel.style.left = (origLeft + e.clientX - startX) + 'px';
            panel.style.top = (origTop + e.clientY - startY) + 'px';
        });

        document.addEventListener('mouseup', function() {
            dragging = false;
        });
    }

    // ===== PUBLIC API =====

    return {
        init: init,
        toggle: toggle,
        activate: activate,
        deactivate: deactivate,
        isActive: isActive,

        /**
         * Set the corridor width in feet.
         * If a transect is active, the cross-section will be recalculated.
         * @param {number} ft
         */
        setCorridorWidth: function(ft) {
            corridorWidthFt = Math.max(10, Math.min(500, ft));
            var input = document.getElementById('csCorridorInput');
            if (input) input.value = corridorWidthFt;
            recalculateIfReady();
        }
    };
})();
