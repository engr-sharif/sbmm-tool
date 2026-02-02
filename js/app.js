/**
 * SBMM Planning Tool - Application Entry Point
 *
 * Loads data from JSON files, validates it, initializes all modules,
 * restores persisted state, and wires up event listeners.
 */
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        var files = AppConfig.dataFiles;

        // Load all data files in parallel
        Promise.all([
            Utils.loadJSON(files.samples2025),
            Utils.loadJSON(files.eaSamples),
            Utils.loadJSON(files.eaTestPits),
            Utils.loadJSON(files.testPits2025),
            Utils.loadJSON(files.soilBorings2025)
        ]).then(function(results) {
            // Validate and store loaded data
            AppState.data.samples2025 = Utils.validateDataset(results[0], 'samples-2025', Utils.validateSample2025);
            AppState.data.eaSamples = Utils.validateDataset(results[1], 'ea-samples', Utils.validateEASample);
            AppState.data.eaTestPits = Utils.validateDataset(results[2], 'ea-test-pits', Utils.validateLocationEntry);
            AppState.data.testPits2025 = Utils.validateDataset(results[3], 'test-pits-2025', Utils.validateLocationEntry);
            AppState.data.soilBorings2025 = Utils.validateDataset(results[4], 'soil-borings-2025', Utils.validateLocationEntry);

            // Initialize core modules
            MapModule.init();
            MarkersModule.init();

            // Initialize feature modules
            SearchModule.init();
            CompareModule.init();
            TimelineModule.init();
            PrintModule.init();
            ContourModule.init();
            CrossSectionModule.init();
            PolygonModule.init();

            // Build UI
            buildSampleLists();
            bindEventListeners();

            // Restore persisted state
            restoreState();

            console.log('SBMM Planning Tool v2.0 initialized');

        }).catch(function(error) {
            console.error('Failed to load data:', error);
            document.getElementById('map').innerHTML =
                '<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#1a1a1a;color:#ff4444;font-family:Arial;font-size:16px;padding:40px;text-align:center;">' +
                '<div><h2>Data Load Error</h2><p style="color:#aaa;margin-top:10px;">Could not load sampling data files.<br>Ensure the data/ directory contains valid JSON files.<br><br>' +
                '<small style="color:#666;">Error: ' + error.message + '</small></p>' +
                '<p style="color:#888;margin-top:20px;font-size:12px;">Note: This app requires an HTTP server. Use:<br>' +
                '<code style="color:#0af;">python -m http.server 8000</code><br>then open <code style="color:#0af;">http://localhost:8000/index-v2.html</code></p></div></div>';
        });
    });

    // ===== STATE RESTORATION =====

    /**
     * Restore planned points, preferences, and URL state.
     */
    function restoreState() {
        // 1. Restore preferences from LocalStorage
        var prefs = StorageModule.restorePreferences();
        if (prefs) {
            if (prefs.currentAnalyte) {
                AppState.currentAnalyte = prefs.currentAnalyte;
                var select = document.getElementById('colorBySelect');
                if (select) select.value = prefs.currentAnalyte;
            }
            if (prefs.gridSizeFt) {
                AppState.gridSizeFt = prefs.gridSizeFt;
                var gridDisplay = document.getElementById('gridSizeDisplay');
                if (gridDisplay) gridDisplay.textContent = prefs.gridSizeFt + ' ft';
                var gapSize = document.getElementById('gapGridSize');
                if (gapSize) gapSize.textContent = prefs.gridSizeFt;
            }
            if (prefs.darkMode) {
                toggleDarkMode(true);
            }
            if (typeof prefs.includePlannedInGaps === 'boolean') {
                AppState.includePlannedInGaps = prefs.includePlannedInGaps;
                var inclBtn = document.getElementById('btn-include-planned');
                if (inclBtn) {
                    inclBtn.textContent = AppState.includePlannedInGaps ? 'On' : 'Off';
                    inclBtn.classList.toggle('active', AppState.includePlannedInGaps);
                }
            }
        }

        // 2. Restore planned points from LocalStorage
        var savedPoints = StorageModule.restorePlannedPoints();
        if (savedPoints.length > 0) {
            savedPoints.forEach(function(p) {
                AppState.plannedPoints.push(p);
                PlanningModule.addPlannedMarker(p);
            });
            PlanningModule.updatePlannedPointsList();
            StorageModule.updateStorageIndicator(true);
            console.log('Restored ' + savedPoints.length + ' planned points from storage');
        }

        // 3. Apply URL state (overrides LocalStorage for view params)
        var urlState = AppState.decodeURLState();
        if (urlState) {
            if (urlState.lat && urlState.lon && urlState.zoom) {
                AppState.map.setView([urlState.lat, urlState.lon], urlState.zoom);
            }
            if (urlState.analyte && AppConfig.thresholds[urlState.analyte]) {
                AppState.currentAnalyte = urlState.analyte;
                var select = document.getElementById('colorBySelect');
                if (select) select.value = urlState.analyte;
                MarkersModule.updateMarkerColors();
            }
            if (urlState.darkMode && !AppState.darkMode) {
                toggleDarkMode(true);
            }
            if (urlState.layers) {
                applyURLLayers(urlState.layers);
            }
        }
    }

    /**
     * Apply layer visibility from URL state.
     * @param {string[]} flags - Array of layer flag strings
     */
    function applyURLLayers(flags) {
        var flagMap = {
            's': 'toggle2025Sampled',
            'n': 'toggle2025NotSampled',
            'e': 'toggleEASamples',
            'et': 'toggleEATestPits',
            'tp': 'toggleTestPits2025',
            'sb': 'toggleSoilBorings2025',
            'p': 'togglePlanned'
        };

        // Uncheck all first
        Object.keys(flagMap).forEach(function(key) {
            var cb = document.getElementById(flagMap[key]);
            if (cb && cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });

        // Check those in the flags
        flags.forEach(function(flag) {
            var cbId = flagMap[flag];
            if (cbId) {
                var cb = document.getElementById(cbId);
                if (cb) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change'));
                }
            }
        });
    }

    // ===== DARK MODE =====

    /**
     * Toggle dark mode on/off.
     * @param {boolean} [forceOn] - If true, force dark mode on without toggling
     */
    function toggleDarkMode(forceOn) {
        if (forceOn === true) {
            AppState.darkMode = true;
        } else {
            AppState.darkMode = !AppState.darkMode;
        }

        document.body.classList.toggle('dark-mode', AppState.darkMode);

        var btn = document.getElementById('btn-darkmode');
        if (btn) btn.textContent = AppState.darkMode ? 'Light' : 'Dark';

        StorageModule.savePreferences();
        AppState.updateURLState();
    }

    // ===== SIDEBAR TOGGLE (Mobile) =====

    function toggleSidebar() {
        var sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.toggle('open');
        }
    }

    // ===== SAMPLE LISTS =====

    /**
     * Build the sidebar sample lists from loaded data.
     */
    function buildSampleLists() {
        var data = AppState.data;

        // Build 2025 sample list (sorted by mercury, highest first)
        var sorted2025 = data.samples2025.slice().sort(function(a, b) {
            if (!a.sampled) return 1;
            if (!b.sampled) return -1;
            return ((b.metals && b.metals.Mercury) || 0) - ((a.metals && a.metals.Mercury) || 0);
        });

        var list2025Html = '';
        sorted2025.forEach(function(s) {
            var hgText = s.metals && s.metals.Mercury !== null ? Utils.fmt(s.metals.Mercury) : '\u2014';
            var asText = s.metals && s.metals.Arsenic !== null ? Utils.fmt(s.metals.Arsenic) : '\u2014';
            var sbText = s.metals && s.metals.Antimony !== null ? Utils.fmt(s.metals.Antimony) : '\u2014';
            var hgFlag = s.metals && s.metals.Mercury && s.metals.Mercury > 204 ? '<span class="flag">\u26a0</span>' : '';
            var asFlag = s.metals && s.metals.Arsenic && s.metals.Arsenic > 6.1 ? '<span class="flag">\u26a0</span>' : '';
            var sbFlag = s.metals && s.metals.Antimony && s.metals.Antimony > 51 ? '<span class="flag">\u26a0</span>' : '';

            list2025Html += '<div class="sample-item" style="border-color: ' + s.color + ';" data-type="2025" data-id="' + s.num + '">' +
                '<span class="name">' + s.label + '</span>' +
                '<span class="hg">Hg:' + hgText + hgFlag + '</span>' +
                '<span class="as">As:' + asText + asFlag + '</span>' +
                '<span class="sb">Sb:' + sbText + sbFlag + '</span></div>';
        });
        document.getElementById('sampleList2025').innerHTML = list2025Html;

        // Build EA sample list
        var sortedEA = data.eaSamples.slice().sort(function(a, b) {
            return (b.mercury || 0) - (a.mercury || 0);
        });

        var listEAHtml = '';
        sortedEA.forEach(function(e) {
            var hgFlag = e.mercury && e.mercury > 204 ? '<span class="flag">\u26a0</span>' : '';
            var asFlag = e.arsenic && e.arsenic > 6.1 ? '<span class="flag">\u26a0</span>' : '';
            var sbFlag = e.antimony && e.antimony > 51 ? '<span class="flag">\u26a0</span>' : '';

            listEAHtml += '<div class="sample-item" style="border-color: ' + e.color + ';" data-type="EA" data-id="' + e.id + '">' +
                '<span class="name">' + e.id + '</span>' +
                '<span class="hg">Hg:' + Utils.fmt(e.mercury) + hgFlag + '</span>' +
                '<span class="as">As:' + Utils.fmt(e.arsenic) + asFlag + '</span>' +
                '<span class="sb">Sb:' + Utils.fmt(e.antimony) + sbFlag + '</span></div>';
        });
        document.getElementById('sampleListEA').innerHTML = listEAHtml;

        // Click handlers for sample list items
        document.querySelectorAll('.sample-item').forEach(function(item) {
            item.addEventListener('click', function() {
                // If in compare mode, add sample to comparison
                if (CompareModule.isActive()) {
                    var type = this.getAttribute('data-type');
                    var id = this.getAttribute('data-id');
                    CompareModule.addSample(
                        type === '2025' ? AppState.data.samples2025.find(function(s) { return s.num === parseInt(id); }).label : id,
                        type === '2025' ? '2025' : 'ea'
                    );
                    return;
                }

                var type = this.getAttribute('data-type');
                var id = this.getAttribute('data-id');
                var marker;
                if (type === '2025') {
                    marker = AppState.markers2025[parseInt(id)];
                } else {
                    marker = AppState.markersEA[id];
                }
                if (marker) {
                    AppState.map.setView(marker.getLatLng(), 19);
                    marker.openPopup();
                }
            });
        });
    }

    // ===== EVENT LISTENERS =====

    /**
     * Bind all UI event listeners.
     */
    function bindEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
                document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
                this.classList.add('active');
                document.getElementById(this.getAttribute('data-tab')).classList.add('active');
            });
        });

        // ===== HEADER CONTROLS =====
        bindClick('btn-darkmode', function() { toggleDarkMode(); });
        bindClick('btn-print', function() { PrintModule.printView(); });

        // ===== SIDEBAR TOGGLE (Mobile) =====
        bindClick('sidebarToggle', toggleSidebar);

        // ===== MODE BUTTONS =====
        bindClick('btn-view', function() { PlanningModule.setMode('view'); });
        bindClick('btn-proposed', function() { PlanningModule.setMode('proposed'); });
        bindClick('btn-stepout', function() { PlanningModule.setMode('stepout'); });

        // ===== COORDINATE ENTRY =====
        bindClick('btn-addcoord', function() { PlanningModule.addFromCoordinates(); });

        // ===== PLANNING ACTION BUTTONS =====
        bindClick('btn-undo', function() { AppState.undo(); });
        bindClick('btn-redo', function() { AppState.redo(); });
        bindClick('btn-clear', function() { PlanningModule.clearAllPlanned(); });
        bindClick('btn-export', function() { ExportModule.exportCSV(); });
        bindClick('btn-copy', function() { ExportModule.copyToClipboard(); });

        var csvUpload = document.getElementById('csv-upload');
        if (csvUpload) {
            csvUpload.addEventListener('change', function() { ExportModule.loadCSV(); });
        }

        // ===== ANALYSIS TOOLS =====
        bindClick('btn-measure', function() { AnalysisModule.toggleMeasureMode(); });
        bindClick('btn-gaps', function() { AnalysisModule.toggleGapAnalysis(); });
        bindClick('btn-hotzone', function() { AnalysisModule.toggleHotZones(); });
        bindClick('btn-contour', function() { ContourModule.toggle(); });
        bindClick('btn-crosssection', function() { CrossSectionModule.toggle(); });
        bindClick('btn-polygon', function() { PolygonModule.toggle(); });

        // Buffer zone toggle (also show/hide buffer radius row)
        bindClick('btn-buffer', function() {
            AnalysisModule.toggleBufferZones();
            var row = document.getElementById('bufferRadiusRow');
            if (row) row.style.display = AppState.bufferVisible ? 'flex' : 'none';
        });

        // Compare mode
        bindClick('btn-compare', function() { CompareModule.toggle(); });
        bindClick('compareClose', function() { CompareModule.close(); });

        // ===== GRID SIZE =====
        bindClick('btn-grid-down', function() { AnalysisModule.adjustGridSize(-25); });
        bindClick('btn-grid-up', function() { AnalysisModule.adjustGridSize(25); });
        bindClick('btn-include-planned', function() { AnalysisModule.toggleIncludePlanned(); });

        // ===== BUFFER RADIUS =====
        bindClick('btn-buffer-down', function() { AnalysisModule.adjustBufferRadius(-25); });
        bindClick('btn-buffer-up', function() { AnalysisModule.adjustBufferRadius(25); });

        // ===== TIMELINE BUTTONS =====
        document.querySelectorAll('.timeline-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var period = this.getAttribute('data-period');
                TimelineModule.setPeriod(period);
            });
        });

        // ===== COLOR-BY ANALYTE =====
        var colorBySelect = document.getElementById('colorBySelect');
        if (colorBySelect) {
            colorBySelect.addEventListener('change', function() {
                AppState.currentAnalyte = this.value;
                MarkersModule.updateMarkerColors();

                // Refresh active analysis overlays
                if (AppState.hotzoneVisible) {
                    AnalysisModule.createHotZoneGrid();
                    AnalysisModule.updateHotZoneLegend();
                }
                if (AppState.contourVisible) {
                    ContourModule.refresh();
                }
                if (AppState.bufferVisible) {
                    AnalysisModule.refreshBufferZones();
                }

                // Save preference
                StorageModule.savePreferences();
                AppState.updateURLState();
            });
        }

        // ===== LAYER TOGGLES =====
        bindLayerToggle('toggle2025Sampled', 'sampled2025');
        bindLayerToggle('toggle2025NotSampled', 'notSampled2025');
        bindLayerToggle('toggleEASamples', 'eaSamples');
        bindLayerToggle('toggleEATestPits', 'eaTestPits');
        bindLayerToggle('togglePlanned', 'planned');
        bindLayerToggle('toggleTestPits2025', 'testPits2025');
        bindLayerToggle('toggleSoilBorings2025', 'soilBorings2025');

        // ===== LABEL TOGGLE =====
        var labelToggle = document.getElementById('toggleLabels');
        if (labelToggle) {
            labelToggle.addEventListener('change', function() {
                AppState.labelsVisible = this.checked;
                if (AppState.labelsVisible) {
                    MarkersModule.updateLabels();
                    AppState.map.addLayer(AppState.labelLayer);
                } else {
                    AppState.map.removeLayer(AppState.labelLayer);
                }
            });
        }

        // Refresh labels when layer visibility changes
        var labelRefreshToggles = [
            'toggle2025Sampled', 'toggle2025NotSampled', 'toggleEASamples',
            'toggleEATestPits', 'togglePlanned', 'toggleTestPits2025', 'toggleSoilBorings2025'
        ];
        labelRefreshToggles.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    if (AppState.labelsVisible) MarkersModule.updateLabels();
                });
            }
        });

        // ===== MAP EVENTS FOR URL STATE =====
        AppState.map.on('moveend', function() {
            AppState.updateURLState();
        });

        // ===== KEYBOARD SHORTCUTS =====
        document.addEventListener('keydown', function(e) {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            // Ctrl+Z = Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                AppState.undo();
            }
            // Ctrl+Y or Ctrl+Shift+Z = Redo
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
                e.preventDefault();
                AppState.redo();
            }
            // Escape = cancel current tool/mode
            if (e.key === 'Escape') {
                if (AppState.measureMode) AnalysisModule.toggleMeasureMode();
                if (CompareModule.isActive()) CompareModule.close();
                if (CrossSectionModule.isActive()) CrossSectionModule.deactivate();
                if (AppState.polygonMode) PolygonModule.toggle();
                if (AppState.currentMode !== 'view') PlanningModule.setMode('view');
            }
        });
    }

    /**
     * Helper: bind click on an element by ID (null-safe).
     */
    function bindClick(id, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    /**
     * Bind a checkbox to toggle a layer group on/off.
     * @param {string} checkboxId - DOM ID of the checkbox
     * @param {string} layerKey - Key in AppState.layers
     */
    function bindLayerToggle(checkboxId, layerKey) {
        var cb = document.getElementById(checkboxId);
        if (!cb) return;
        cb.addEventListener('change', function() {
            if (this.checked) {
                AppState.map.addLayer(AppState.layers[layerKey]);
            } else {
                AppState.map.removeLayer(AppState.layers[layerKey]);
            }
            AppState.updateURLState();
        });
    }
})();
