/**
 * SBMM Planning Tool - Storage Module
 *
 * Persists planned points and app preferences to LocalStorage.
 * Auto-saves on every change, auto-restores on page load.
 */
var StorageModule = (function() {
    'use strict';

    var STORAGE_KEYS = {
        plannedPoints: 'sbmm_planned_points',
        preferences: 'sbmm_preferences',
        version: 'sbmm_storage_version'
    };

    var CURRENT_VERSION = '2.0';

    /**
     * Check if LocalStorage is available.
     */
    function isAvailable() {
        try {
            var test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Save planned points to LocalStorage.
     */
    function savePlannedPoints() {
        if (!isAvailable()) return;
        try {
            var data = AppState.plannedPoints.map(function(p) {
                return {
                    id: p.id,
                    type: p.type,
                    lat: p.lat,
                    lon: p.lon,
                    depth: p.depth,
                    note: p.note,
                    color: p.color
                };
            });
            localStorage.setItem(STORAGE_KEYS.plannedPoints, JSON.stringify(data));
            localStorage.setItem(STORAGE_KEYS.version, CURRENT_VERSION);
            updateStorageIndicator(true);
        } catch (e) {
            console.warn('Failed to save planned points:', e);
        }
    }

    /**
     * Restore planned points from LocalStorage.
     * @returns {Array} Restored points or empty array
     */
    function restorePlannedPoints() {
        if (!isAvailable()) return [];
        try {
            var raw = localStorage.getItem(STORAGE_KEYS.plannedPoints);
            if (!raw) return [];
            var points = JSON.parse(raw);
            if (!Array.isArray(points)) return [];
            // Validate each point
            return points.filter(function(p) {
                return p.id && p.type && typeof p.lat === 'number' && typeof p.lon === 'number';
            });
        } catch (e) {
            console.warn('Failed to restore planned points:', e);
            return [];
        }
    }

    /**
     * Save user preferences (analyte, grid size, dark mode, etc.)
     */
    function savePreferences() {
        if (!isAvailable()) return;
        try {
            var prefs = {
                currentAnalyte: AppState.currentAnalyte,
                gridSizeFt: AppState.gridSizeFt,
                darkMode: AppState.darkMode || false,
                includePlannedInGaps: AppState.includePlannedInGaps
            };
            localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(prefs));
        } catch (e) {
            console.warn('Failed to save preferences:', e);
        }
    }

    /**
     * Restore user preferences.
     * @returns {Object|null}
     */
    function restorePreferences() {
        if (!isAvailable()) return null;
        try {
            var raw = localStorage.getItem(STORAGE_KEYS.preferences);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    /**
     * Clear all stored data.
     */
    function clearAll() {
        if (!isAvailable()) return;
        Object.keys(STORAGE_KEYS).forEach(function(key) {
            localStorage.removeItem(STORAGE_KEYS[key]);
        });
        updateStorageIndicator(false);
    }

    /**
     * Get storage size info.
     */
    function getStorageInfo() {
        if (!isAvailable()) return { available: false };
        var pointsData = localStorage.getItem(STORAGE_KEYS.plannedPoints);
        return {
            available: true,
            pointCount: AppState.plannedPoints.length,
            sizeBytes: pointsData ? pointsData.length : 0,
            hasData: !!pointsData
        };
    }

    /**
     * Update the storage status indicator in the UI.
     */
    function updateStorageIndicator(saved) {
        var indicator = document.getElementById('storageStatus');
        if (!indicator) return;
        if (saved && AppState.plannedPoints.length > 0) {
            indicator.textContent = 'Auto-saved (' + AppState.plannedPoints.length + ' pts)';
            indicator.className = 'storage-status saved';
        } else {
            indicator.textContent = '';
            indicator.className = 'storage-status';
        }
    }

    return {
        isAvailable: isAvailable,
        savePlannedPoints: savePlannedPoints,
        restorePlannedPoints: restorePlannedPoints,
        savePreferences: savePreferences,
        restorePreferences: restorePreferences,
        clearAll: clearAll,
        getStorageInfo: getStorageInfo,
        updateStorageIndicator: updateStorageIndicator
    };
})();
