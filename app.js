/**
 * Travel IO - App Utilities
 * Shared UI functions
 */

import travelEngine from './engine.js';

// ============================================
// DROPDOWN POPULATION
// ============================================

export async function populateCountryDropdown(selectElement, options = {}) {
  const { 
    includeBlank = true, 
    blankText = 'Select a country',
    selectedValue = null 
  } = options;

  await travelEngine.init();
  
  const countries = travelEngine.getAllCountries();
  
  selectElement.innerHTML = '';
  
  if (includeBlank) {
    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = blankText;
    blankOption.disabled = true;
    blankOption.selected = !selectedValue;
    selectElement.appendChild(blankOption);
  }

  // Group by continent
  const continents = {};
  countries.forEach(country => {
    if (!continents[country.continent]) {
      continents[country.continent] = [];
    }
    continents[country.continent].push(country);
  });

  const continentOrder = ['Europe', 'Asia', 'North America', 'South America', 'Africa', 'Oceania'];
  
  continentOrder.forEach(continent => {
    if (continents[continent]) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = continent;
      
      continents[continent].forEach(country => {
        const option = document.createElement('option');
        option.value = country.code;
        option.textContent = country.name;
        if (selectedValue === country.code) {
          option.selected = true;
        }
        optgroup.appendChild(option);
      });
      
      selectElement.appendChild(optgroup);
    }
  });
}

// ============================================
// UI HELPERS
// ============================================

export function getStatusColor(status) {
  const colors = {
    free: '#10b981',
    green: '#10b981',
    voa: '#f59e0b',
    yellow: '#f59e0b',
    evisa: '#3b82f6',
    blue: '#3b82f6',
    required: '#ef4444',
    red: '#ef4444',
    restricted: '#7f1d1d',
    orange: '#f97316',
    gray: '#6b7280'
  };
  return colors[status] || colors.gray;
}

export function getStatusIcon(type) {
  const icons = {
    free: '✓',
    voa: '⚡',
    evisa: '📧',
    embassy: '🏛️',
    restricted: '⛔',
    domestic: '🏠',
    error: '❌'
  };
  return icons[type] || '❓';
}

export function formatStayDuration(days) {
  if (!days) return 'Varies';
  if (days === 90) return '90 days (within 180)';
  return `${days} days`;
}

export function createResultCard(result) {
  const color = getStatusColor(result.color || result.status);
  const icon = getStatusIcon(result.type);
  
  return `
    <div class="result-card" style="--accent-color: ${color}">
      <div class="result-header">
        <span class="result-icon">${icon}</span>
        <span class="result-status">${result.text}</span>
      </div>
      <div class="result-body">
        <p class="result-details">${result.details}</p>
        ${result.stay ? `<p class="result-stay"><strong>Maximum stay:</strong> ${formatStayDuration(result.stay)}</p>` : ''}
        ${result.requirements ? `
          <div class="result-requirements">
            <strong>Typical requirements:</strong>
            <ul>
              ${result.requirements.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${result.confidence === 'estimated' ? `
          <p class="result-warning">⚠️ This is an estimate. Verify with official sources.</p>
        ` : ''}
        ${result.advisory ? `
          <p class="result-advisory advisory-${result.advisory.level}">
            Travel Advisory Level ${result.advisory.level}: ${result.advisory.text}
          </p>
        ` : ''}
      </div>
    </div>
  `;
}

export function createAlertCard(alert) {
  const severityColors = {
    none: '#10b981',
    low: '#3b82f6',
    moderate: '#f59e0b',
    high: '#ef4444'
  };
  
  const severityIcons = {
    none: '✓',
    low: 'ℹ️',
    moderate: '⚠️',
    high: '🚨'
  };

  return `
    <div class="alert-card" style="--severity-color: ${severityColors[alert.severity]}">
      <div class="alert-header">
        <span class="alert-icon">${severityIcons[alert.severity]}</span>
        <span class="alert-title">${alert.title}</span>
      </div>
      <p class="alert-message">${alert.message}</p>
    </div>
  `;
}

// ============================================
// LOADING STATES
// ============================================

export function showLoading(container) {
  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading...</p>
    </div>
  `;
}

export function showError(container, message) {
  container.innerHTML = `
    <div class="error-state">
      <span class="error-icon">❌</span>
      <p>${message}</p>
    </div>
  `;
}

// ============================================
// LOCAL STORAGE
// ============================================

export function saveUserPreference(key, value) {
  try {
    localStorage.setItem(`travelio_${key}`, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save preference:', e);
  }
}

export function getUserPreference(key, defaultValue = null) {
  try {
    const stored = localStorage.getItem(`travelio_${key}`);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// Initialize engine on import
travelEngine.init().catch(console.error);

export { travelEngine };
