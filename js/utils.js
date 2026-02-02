/**
 * SBMM Planning Tool - Utility Functions
 *
 * Shared helper functions used across modules.
 */
var Utils = (function() {
    'use strict';

    /**
     * Format a numeric value for display. Returns em-dash for null/undefined/NaN.
     * @param {number|null} val
     * @returns {string}
     */
    function fmt(val) {
        if (val === null || val === undefined || isNaN(val)) return '\u2014';
        return Number(val).toLocaleString();
    }

    /**
     * Format a value with appropriate decimal places based on magnitude.
     * @param {number|null} val
     * @returns {string}
     */
    function formatVal(val) {
        if (val === null || val === undefined) return '\u2014';
        if (val >= 1000) return val.toFixed(0);
        if (val >= 1) return val.toFixed(1);
        return val.toFixed(2);
    }

    /**
     * Create a DOM element with attributes and children.
     * Safer alternative to innerHTML for building UI.
     * @param {string} tag
     * @param {Object} attrs
     * @param {Array|string} children
     * @returns {HTMLElement}
     */
    function createElement(tag, attrs, children) {
        var el = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function(key) {
                if (key === 'className') {
                    el.className = attrs[key];
                } else if (key === 'style' && typeof attrs[key] === 'object') {
                    Object.keys(attrs[key]).forEach(function(prop) {
                        el.style[prop] = attrs[key][prop];
                    });
                } else if (key.startsWith('on') && typeof attrs[key] === 'function') {
                    el.addEventListener(key.substring(2).toLowerCase(), attrs[key]);
                } else {
                    el.setAttribute(key, attrs[key]);
                }
            });
        }
        if (children !== undefined && children !== null) {
            if (Array.isArray(children)) {
                children.forEach(function(child) {
                    if (typeof child === 'string') {
                        el.appendChild(document.createTextNode(child));
                    } else if (child instanceof HTMLElement) {
                        el.appendChild(child);
                    }
                });
            } else if (typeof children === 'string') {
                el.textContent = children;
            }
        }
        return el;
    }

    /**
     * Parse a CSV line handling quoted fields with commas.
     * @param {string} line
     * @returns {string[]}
     */
    function parseCSVLine(line) {
        var result = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    /**
     * Get analyte value from a sample object.
     * Handles the different data structures of 2025 vs EA samples.
     * @param {Object} sample
     * @param {string} analyte
     * @param {boolean} isEA - true if EA historical sample
     * @returns {number|null}
     */
    function getSampleValue(sample, analyte, isEA) {
        if (isEA) {
            switch (analyte) {
                case 'Mercury': return sample.mercury;
                case 'Arsenic': return sample.arsenic;
                case 'Antimony': return sample.antimony;
                case 'Thallium': return sample.thallium;
            }
        } else {
            return sample.metals ? sample.metals[analyte] : null;
        }
        return null;
    }

    /**
     * Fetch a JSON data file.
     * @param {string} url - Path to JSON file
     * @returns {Promise<Array>}
     */
    function loadJSON(url) {
        return fetch(url)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load ' + url + ': ' + response.statusText);
                }
                return response.json();
            });
    }

    // ===== DATA VALIDATION =====

    /**
     * Validate a samples-2025 array entry.
     * @param {Object} s
     * @param {number} index
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    function validateSample2025(s, index) {
        var errors = [];
        if (typeof s.lat !== 'number' || isNaN(s.lat)) errors.push('Item ' + index + ': missing or invalid lat');
        if (typeof s.lon !== 'number' || isNaN(s.lon)) errors.push('Item ' + index + ': missing or invalid lon');
        if (!s.label) errors.push('Item ' + index + ': missing label');
        if (typeof s.sampled !== 'boolean') errors.push('Item ' + index + ': missing sampled flag');
        return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Validate an ea-samples array entry.
     */
    function validateEASample(e, index) {
        var errors = [];
        if (typeof e.lat !== 'number' || isNaN(e.lat)) errors.push('Item ' + index + ': missing or invalid lat');
        if (typeof e.lon !== 'number' || isNaN(e.lon)) errors.push('Item ' + index + ': missing or invalid lon');
        if (!e.id) errors.push('Item ' + index + ': missing id');
        return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Validate an entire dataset and log warnings for bad entries.
     * Returns the filtered valid entries.
     * @param {Array} data
     * @param {string} datasetName
     * @param {Function} validator
     * @returns {Array}
     */
    function validateDataset(data, datasetName, validator) {
        if (!Array.isArray(data)) {
            console.error('Data validation: ' + datasetName + ' is not an array');
            return [];
        }

        var valid = [];
        var allErrors = [];

        data.forEach(function(item, index) {
            var result = validator(item, index);
            if (result.valid) {
                valid.push(item);
            } else {
                allErrors = allErrors.concat(result.errors);
            }
        });

        if (allErrors.length > 0) {
            console.warn('Data validation warnings for ' + datasetName + ' (' + allErrors.length + ' issues):');
            allErrors.slice(0, 10).forEach(function(e) { console.warn('  ' + e); });
            if (allErrors.length > 10) console.warn('  ... and ' + (allErrors.length - 10) + ' more');
        }

        console.log(datasetName + ': ' + valid.length + '/' + data.length + ' entries valid');
        return valid;
    }

    /**
     * Validate a generic location entry (test pits, soil borings).
     */
    function validateLocationEntry(item, index) {
        var errors = [];
        if (typeof item.lat !== 'number' || isNaN(item.lat)) errors.push('Item ' + index + ': missing or invalid lat');
        if (typeof item.lon !== 'number' || isNaN(item.lon)) errors.push('Item ' + index + ': missing or invalid lon');
        if (!item.id) errors.push('Item ' + index + ': missing id');
        return { valid: errors.length === 0, errors: errors };
    }

    return {
        fmt: fmt,
        formatVal: formatVal,
        createElement: createElement,
        parseCSVLine: parseCSVLine,
        getSampleValue: getSampleValue,
        loadJSON: loadJSON,
        validateSample2025: validateSample2025,
        validateEASample: validateEASample,
        validateDataset: validateDataset,
        validateLocationEntry: validateLocationEntry
    };
})();
