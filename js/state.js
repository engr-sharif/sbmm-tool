/**
 * SBMM Planning Tool - Application State
 *
 * Centralized state management. All mutable application state lives here.
 * Modules read and write state through this object instead of globals.
 */
var AppState = (function() {
    'use strict';

    var state = {
        // Leaflet map instance
        map: null,

        // Layer groups (Leaflet LayerGroups)
        layers: {
            sampled2025: null,
            notSampled2025: null,
            eaSamples: null,
            eaTestPits: null,
            planned: null,
            testPits2025: null,
            soilBorings2025: null
        },

        // Marker lookup tables (keyed by sample ID)
        markers2025: {},
        markersEA: {},

        // Loaded data arrays (populated from JSON files)
        data: {
            samples2025: [],
            eaSamples: [],
            eaTestPits: [],
            testPits2025: [],
            soilBorings2025: []
        },

        // Planning mode: 'view' | 'proposed' | 'stepout'
        currentMode: 'view',

        // User-created planned sampling points
        plannedPoints: [],

        // Pending point (during add confirmation popup)
        pendingPoint: null,

        // Analysis tools
        measureMode: false,
        measurePoints: [],
        measureMarkers: [],
        measureLine: null,
        gapLayer: null,
        gapsVisible: false,
        hotzoneLayer: null,
        hotzoneVisible: false,
        gridSizeFt: AppConfig.gridDefaults.sizeFt,
        includePlannedInGaps: true,

        // Current analyte for color-by and hot zone analysis
        currentAnalyte: 'Mercury',

        // Label layer
        labelLayer: null,
        labelsVisible: false,

        // Popup state tracking (for "Show All Metals" toggles)
        ssShowAllMetals: {},
        tpShowAllMetals: {},

        // ===== NEW: Undo/Redo Stack =====
        undoStack: [],
        redoStack: [],
        maxUndoSize: 50,

        // ===== NEW: Dark mode =====
        darkMode: false,

        // ===== NEW: Contour layer =====
        contourLayer: null,
        contourVisible: false,

        // ===== NEW: Polygon tool =====
        polygonMode: false,
        polygonLayer: null,
        polygonVertices: [],

        // ===== NEW: Cross-section =====
        crossSectionMode: false,
        crossSectionPoints: [],
        crossSectionMarkers: [],
        crossSectionLine: null,

        // ===== NEW: Buffer zone =====
        bufferLayer: null,
        bufferVisible: false,
        bufferRadiusFt: 50
    };

    // ===== Undo/Redo Methods =====

    /**
     * Push an action to the undo stack.
     * @param {Object} action - { type: string, data: any }
     */
    state.pushUndo = function(action) {
        state.undoStack.push(action);
        if (state.undoStack.length > state.maxUndoSize) {
            state.undoStack.shift();
        }
        state.redoStack = []; // Clear redo on new action
        state.updateUndoRedoButtons();
    };

    /**
     * Undo the last action.
     */
    state.undo = function() {
        if (state.undoStack.length === 0) return;
        var action = state.undoStack.pop();
        state.redoStack.push(action);

        switch (action.type) {
            case 'add_point':
                PlanningModule.deletePointById(action.data.id);
                break;
            case 'delete_point':
                var pt = action.data;
                state.plannedPoints.push(pt);
                PlanningModule.addPlannedMarker(pt);
                PlanningModule.updatePlannedPointsList();
                break;
            case 'move_point':
                var point = state.plannedPoints.find(function(p) { return p.id === action.data.id; });
                if (point) {
                    point.lat = action.data.oldLat;
                    point.lon = action.data.oldLon;
                    state.layers.planned.eachLayer(function(layer) {
                        if (layer.pointId === action.data.id) {
                            layer.setLatLng([action.data.oldLat, action.data.oldLon]);
                        }
                    });
                    PlanningModule.updatePlannedPointsList();
                }
                break;
            case 'edit_point':
                var ep = state.plannedPoints.find(function(p) { return p.id === action.data.id; });
                if (ep) {
                    ep.note = action.data.oldNote;
                    ep.depth = action.data.oldDepth;
                    PlanningModule.updatePlannedPointsList();
                }
                break;
        }

        if (StorageModule && StorageModule.savePlannedPoints) StorageModule.savePlannedPoints();
        if (state.gapsVisible && AnalysisModule) AnalysisModule.createGapGrid();
        state.updateUndoRedoButtons();
    };

    /**
     * Redo the last undone action.
     */
    state.redo = function() {
        if (state.redoStack.length === 0) return;
        var action = state.redoStack.pop();
        state.undoStack.push(action);

        switch (action.type) {
            case 'add_point':
                var pt = action.data;
                state.plannedPoints.push(pt);
                PlanningModule.addPlannedMarker(pt);
                PlanningModule.updatePlannedPointsList();
                break;
            case 'delete_point':
                PlanningModule.deletePointById(action.data.id);
                break;
            case 'move_point':
                var point = state.plannedPoints.find(function(p) { return p.id === action.data.id; });
                if (point) {
                    point.lat = action.data.newLat;
                    point.lon = action.data.newLon;
                    state.layers.planned.eachLayer(function(layer) {
                        if (layer.pointId === action.data.id) {
                            layer.setLatLng([action.data.newLat, action.data.newLon]);
                        }
                    });
                    PlanningModule.updatePlannedPointsList();
                }
                break;
            case 'edit_point':
                var ep = state.plannedPoints.find(function(p) { return p.id === action.data.id; });
                if (ep) {
                    ep.note = action.data.newNote;
                    ep.depth = action.data.newDepth;
                    PlanningModule.updatePlannedPointsList();
                }
                break;
        }

        if (StorageModule && StorageModule.savePlannedPoints) StorageModule.savePlannedPoints();
        if (state.gapsVisible && AnalysisModule) AnalysisModule.createGapGrid();
        state.updateUndoRedoButtons();
    };

    /**
     * Update undo/redo button states.
     */
    state.updateUndoRedoButtons = function() {
        var undoBtn = document.getElementById('btn-undo');
        var redoBtn = document.getElementById('btn-redo');
        if (undoBtn) {
            undoBtn.disabled = state.undoStack.length === 0;
            undoBtn.title = state.undoStack.length > 0
                ? 'Undo (' + state.undoStack.length + ')'
                : 'Nothing to undo';
        }
        if (redoBtn) {
            redoBtn.disabled = state.redoStack.length === 0;
            redoBtn.title = state.redoStack.length > 0
                ? 'Redo (' + state.redoStack.length + ')'
                : 'Nothing to redo';
        }
    };

    // ===== URL State =====

    /**
     * Encode current view state into URL hash.
     */
    state.encodeURLState = function() {
        if (!state.map) return;
        var center = state.map.getCenter();
        var zoom = state.map.getZoom();
        var params = [
            'lat=' + center.lat.toFixed(6),
            'lon=' + center.lng.toFixed(6),
            'z=' + zoom,
            'a=' + state.currentAnalyte
        ];

        // Active layers
        var layerFlags = [];
        if (document.getElementById('toggle2025Sampled') && document.getElementById('toggle2025Sampled').checked) layerFlags.push('s');
        if (document.getElementById('toggle2025NotSampled') && document.getElementById('toggle2025NotSampled').checked) layerFlags.push('n');
        if (document.getElementById('toggleEASamples') && document.getElementById('toggleEASamples').checked) layerFlags.push('e');
        if (document.getElementById('toggleEATestPits') && document.getElementById('toggleEATestPits').checked) layerFlags.push('et');
        if (document.getElementById('toggleTestPits2025') && document.getElementById('toggleTestPits2025').checked) layerFlags.push('tp');
        if (document.getElementById('toggleSoilBorings2025') && document.getElementById('toggleSoilBorings2025').checked) layerFlags.push('sb');
        if (document.getElementById('togglePlanned') && document.getElementById('togglePlanned').checked) layerFlags.push('p');
        if (layerFlags.length > 0) params.push('l=' + layerFlags.join(','));

        if (state.darkMode) params.push('dark=1');

        return '#' + params.join('&');
    };

    /**
     * Decode URL hash into state parameters.
     * @returns {Object|null}
     */
    state.decodeURLState = function() {
        var hash = window.location.hash;
        if (!hash || hash.length < 2) return null;

        var params = {};
        hash.substring(1).split('&').forEach(function(pair) {
            var parts = pair.split('=');
            if (parts.length === 2) params[parts[0]] = parts[1];
        });

        return {
            lat: params.lat ? parseFloat(params.lat) : null,
            lon: params.lon ? parseFloat(params.lon) : null,
            zoom: params.z ? parseInt(params.z) : null,
            analyte: params.a || null,
            layers: params.l ? params.l.split(',') : null,
            darkMode: params.dark === '1'
        };
    };

    /**
     * Update the URL hash with current state (debounced).
     */
    var urlUpdateTimer = null;
    state.updateURLState = function() {
        clearTimeout(urlUpdateTimer);
        urlUpdateTimer = setTimeout(function() {
            var newHash = state.encodeURLState();
            if (newHash && window.location.hash !== newHash) {
                history.replaceState(null, '', newHash);
            }
        }, 500);
    };

    return state;
})();
