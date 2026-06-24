/**
 * Travel IO - Core Engine
 * Deterministic visa requirement calculations
 */

class TravelEngine {
  constructor() {
    this.data = null;
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return;
    
    try {
      const response = await fetch('./data/travelrules.json');
      if (!response.ok) throw new Error('Failed to load travel rules');
      this.data = await response.json();
      this.loaded = true;
      console.log('TravelEngine initialized with', Object.keys(this.data.countries).length, 'countries');
    } catch (error) {
      console.error('TravelEngine init error:', error);
      throw error;
    }
  }

  // ============================================
  // COUNTRY UTILITIES
  // ============================================

  getAllCountries() {
    if (!this.data) return [];
    return Object.entries(this.data.countries)
      .map(([code, info]) => ({
        code,
        name: info.name,
        continent: info.continent
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getCountryName(code) {
    return this.data?.countries[code]?.name || code;
  }

  getCountryCode(name) {
    const entry = Object.entries(this.data.countries)
      .find(([, info]) => info.name.toLowerCase() === name.toLowerCase());
    return entry ? entry[0] : null;
  }

  getCountriesByContinent(continent) {
    return this.getAllCountries().filter(c => c.continent === continent);
  }

  isInRegion(countryCode, region) {
    return this.data?.regions[region]?.includes(countryCode) || false;
  }

  getRegionsForCountry(countryCode) {
    const regions = [];
    for (const [region, countries] of Object.entries(this.data.regions)) {
      if (countries.includes(countryCode)) {
        regions.push(region);
      }
    }
    return regions;
  }

  // ============================================
  // VISA REQUIREMENT ENGINE (CORE)
  // ============================================

  /**
   * Get visa requirement for traveling from passport country to destination
   * @param {string} passportCountry - ISO code of passport
   * @param {string} destination - ISO code of destination
   * @returns {Object} Structured visa requirement
   */
  getVisaRequirement(passportCountry, destination) {
    if (!this.data) {
      return this._errorResult('Engine not initialized');
    }

    // Validate inputs
    if (!this.data.countries[passportCountry]) {
      return this._errorResult(`Unknown passport country: ${passportCountry}`);
    }
    if (!this.data.countries[destination]) {
      return this._errorResult(`Unknown destination: ${destination}`);
    }

    // Same country - no visa needed
    if (passportCountry === destination) {
      return {
        type: 'domestic',
        status: 'free',
        text: 'No visa required',
        stay: null,
        details: 'Traveling within your own country requires no visa.',
        color: 'green'
      };
    }

    // Check high-risk/restricted destinations first
    if (this.data.highRiskCountries.includes(destination)) {
      return {
        type: 'restricted',
        status: 'restricted',
        text: 'Travel not advised',
        stay: null,
        details: `${this.getCountryName(destination)} is currently classified as high-risk. Check government travel advisories.`,
        color: 'red',
        advisory: this._getAdvisoryLevel(destination)
      };
    }

    // Check if destination has specific restrictions against passport country
    const destRules = this.data.visaRules[destination];
    if (destRules?.restricted?.includes(passportCountry)) {
      return {
        type: 'restricted',
        status: 'restricted',
        text: 'Entry restricted',
        stay: null,
        details: `${this.getCountryName(destination)} restricts entry for ${this.getCountryName(passportCountry)} passport holders.`,
        color: 'red'
      };
    }

    // Check regional rules first (Schengen, GCC, etc.)
    const regionalResult = this._checkRegionalRules(passportCountry, destination);
    if (regionalResult) return regionalResult;

    // Check passport-specific rules
    const passportRules = this.data.visaRules[passportCountry];
    if (passportRules) {
      // Visa-free access
      if (passportRules.visaFree?.includes(destination)) {
        return {
          type: 'free',
          status: 'free',
          text: 'Visa-free',
          stay: this._getStayDays(passportCountry, destination, 'visaFree'),
          details: `${this.getCountryName(passportCountry)} passport holders can enter ${this.getCountryName(destination)} visa-free.`,
          color: 'green'
        };
      }

      // Visa on arrival
      if (passportRules.visaOnArrival?.includes(destination)) {
        return {
          type: 'voa',
          status: 'voa',
          text: 'Visa on arrival',
          stay: this._getStayDays(passportCountry, destination, 'visaOnArrival'),
          details: `Visa available on arrival at ${this.getCountryName(destination)} ports of entry.`,
          color: 'yellow',
          requirements: ['Valid passport', 'Return ticket', 'Proof of accommodation', 'Sufficient funds']
        };
      }

      // E-Visa
      if (passportRules.eVisa?.includes(destination)) {
        return {
          type: 'evisa',
          status: 'evisa',
          text: 'E-Visa available',
          stay: this._getStayDays(passportCountry, destination, 'eVisa'),
          details: `Apply for an electronic visa online before traveling to ${this.getCountryName(destination)}.`,
          color: 'blue',
          requirements: ['Online application', 'Valid passport', 'Digital photo', 'Payment method']
        };
      }
    }

    // Check if destination grants access TO this passport (reverse lookup)
    if (destRules) {
      if (destRules.visaFree?.includes(passportCountry)) {
        return {
          type: 'free',
          status: 'free',
          text: 'Visa-free',
          stay: this._getStayDays(passportCountry, destination, 'visaFree'),
          details: `${this.getCountryName(destination)} grants visa-free access to ${this.getCountryName(passportCountry)} passport holders.`,
          color: 'green'
        };
      }

      if (destRules.visaOnArrival?.includes(passportCountry)) {
        return {
          type: 'voa',
          status: 'voa',
          text: 'Visa on arrival',
          stay: this._getStayDays(passportCountry, destination, 'visaOnArrival'),
          details: `Visa available on arrival.`,
          color: 'yellow'
        };
      }

      if (destRules.eVisa?.includes(passportCountry)) {
        return {
          type: 'evisa',
          status: 'evisa',
          text: 'E-Visa available',
          stay: this._getStayDays(passportCountry, destination, 'eVisa'),
          details: `Apply for electronic visa online.`,
          color: 'blue'
        };
      }
    }

    // Fallback based on passport power tier
    return this._fallbackByTier(passportCountry, destination);
  }

  _checkRegionalRules(passportCountry, destination) {
    // Schengen internal travel
    if (this.isInRegion(passportCountry, 'schengen') && this.isInRegion(destination, 'schengen')) {
      return {
        type: 'free',
        status: 'free',
        text: 'Schengen free movement',
        stay: null,
        details: 'Free movement within the Schengen Area for member state citizens.',
        color: 'green',
        regional: 'schengen'
      };
    }

    // EU citizens in non-Schengen EU
    if (this.isInRegion(passportCountry, 'eu') && this.isInRegion(destination, 'eu')) {
      return {
        type: 'free',
        status: 'free',
        text: 'EU free movement',
        stay: null,
        details: 'EU citizens have freedom of movement within the European Union.',
        color: 'green',
        regional: 'eu'
      };
    }

    // GCC citizens within GCC
    if (this.isInRegion(passportCountry, 'gcc') && this.isInRegion(destination, 'gcc')) {
      return {
        type: 'free',
        status: 'free',
        text: 'GCC free movement',
        stay: 180,
        details: 'GCC nationals enjoy visa-free travel within Gulf Cooperation Council states.',
        color: 'green',
        regional: 'gcc'
      };
    }

    // ASEAN simplified travel
    if (this.isInRegion(passportCountry, 'asean') && this.isInRegion(destination, 'asean')) {
      return {
        type: 'free',
        status: 'free',
        text: 'ASEAN travel',
        stay: 30,
        details: 'ASEAN nationals can travel visa-free between member states.',
        color: 'green',
        regional: 'asean'
      };
    }

    // MERCOSUR
    if (this.isInRegion(passportCountry, 'mercosur') && this.isInRegion(destination, 'mercosur')) {
      return {
        type: 'free',
        status: 'free',
        text: 'MERCOSUR travel',
        stay: 90,
        details: 'MERCOSUR citizens can travel within member states with national ID.',
        color: 'green',
        regional: 'mercosur'
      };
    }

    // CARICOM
    if (this.isInRegion(passportCountry, 'caricom') && this.isInRegion(destination, 'caricom')) {
      return {
        type: 'free',
        status: 'free',
        text: 'CARICOM travel',
        stay: 180,
        details: 'CARICOM nationals enjoy visa-free movement within the Caribbean Community.',
        color: 'green',
        regional: 'caricom'
      };
    }

    return null;
  }

  _fallbackByTier(passportCountry, destination) {
    const tier = this._getPassportTier(passportCountry);
    const destTier = this._getPassportTier(destination);
    
    // Strong passport visiting weaker passport country - often VOA or eVisa
    if (tier <= 2 && destTier >= 4) {
      return {
        type: 'voa',
        status: 'voa',
        text: 'Likely visa on arrival',
        stay: 30,
        details: `Based on passport strength, visa on arrival or e-visa is typically available. Verify with ${this.getCountryName(destination)} embassy.`,
        color: 'yellow',
        confidence: 'estimated'
      };
    }

    // Weak passport visiting strong country - likely embassy visa
    if (tier >= 4 && destTier <= 2) {
      return {
        type: 'embassy',
        status: 'required',
        text: 'Visa required',
        stay: null,
        details: `Embassy visa application required. Contact the ${this.getCountryName(destination)} embassy or consulate.`,
        color: 'red',
        requirements: [
          'Completed visa application form',
          'Valid passport (6+ months validity)',
          'Passport-sized photos',
          'Proof of accommodation',
          'Travel itinerary',
          'Financial statements',
          'Travel insurance'
        ]
      };
    }

    // Default: embassy visa required
    return {
      type: 'embassy',
      status: 'required',
      text: 'Visa required',
      stay: null,
      details: `Check with the ${this.getCountryName(destination)} embassy for visa requirements.`,
      color: 'orange',
      confidence: 'verify'
    };
  }

  _getPassportTier(countryCode) {
    const tiers = this.data.passportPower;
    if (tiers.tier1.includes(countryCode)) return 1;
    if (tiers.tier2.includes(countryCode)) return 2;
    if (tiers.tier3.includes(countryCode)) return 3;
    if (tiers.tier4.includes(countryCode)) return 4;
    if (tiers.tier5.includes(countryCode)) return 5;
    return 6;
  }

  _getStayDays(passport, destination, visaType) {
    // Check regional defaults first
    if (this.isInRegion(destination, 'schengen')) {
      return 90; // Schengen 90/180 rule
    }
    return this.data.defaultStayDays[visaType] || 30;
  }

  _getAdvisoryLevel(countryCode) {
    const advisories = this.data.travelAdvisories;
    if (advisories.level4_doNotTravel.includes(countryCode)) {
      return { level: 4, text: 'Do Not Travel' };
    }
    if (advisories.level3_reconsider.includes(countryCode)) {
      return { level: 3, text: 'Reconsider Travel' };
    }
    if (advisories.level2_caution.includes(countryCode)) {
      return { level: 2, text: 'Exercise Increased Caution' };
    }
    return { level: 1, text: 'Exercise Normal Precautions' };
  }

  _errorResult(message) {
    return {
      type: 'error',
      status: 'error',
      text: 'Error',
      stay: null,
      details: message,
      color: 'gray'
    };
  }

  // ============================================
  // TRAVEL ELIGIBILITY & REQUIREMENTS
  // ============================================

  getTravelRequirements(passportCountry, destination) {
    const visa = this.getVisaRequirement(passportCountry, destination);
    const advisory = this._getAdvisoryLevel(destination);
    const destInfo = this.data.countries[destination];

    return {
      visa,
      advisory,
      destination: {
        name: this.getCountryName(destination),
        continent: destInfo?.continent,
        regions: this.getRegionsForCountry(destination)
      },
      generalRequirements: [
        'Valid passport (minimum 6 months validity beyond travel dates)',
        'Return or onward ticket',
        'Proof of accommodation',
        'Sufficient funds for duration of stay',
        'Travel insurance (recommended)'
      ],
      healthRequirements: this._getHealthRequirements(destination),
      checklist: this._generateChecklist(visa, destination)
    };
  }

  _getHealthRequirements(destination) {
    // Simplified health requirement rules based on region
    const requirements = [];
    const destInfo = this.data.countries[destination];
    
    if (destInfo?.continent === 'Africa') {
      requirements.push('Yellow fever vaccination (may be required)');
      requirements.push('Malaria prophylaxis (recommended for most regions)');
    }
    if (destInfo?.continent === 'South America') {
      requirements.push('Yellow fever vaccination (required for some countries)');
    }
    if (['IN', 'PK', 'BD', 'NP'].includes(destination)) {
      requirements.push('Typhoid vaccination recommended');
      requirements.push('Hepatitis A vaccination recommended');
    }
    
    requirements.push('COVID-19: Check current entry requirements');
    
    return requirements;
  }

  _generateChecklist(visa, destination) {
    const checklist = [
      { item: 'Passport validity check', category: 'documents', required: true },
      { item: 'Travel insurance', category: 'insurance', required: true }
    ];

    if (visa.type === 'embassy' || visa.status === 'required') {
      checklist.push({ item: 'Visa application', category: 'visa', required: true });
      checklist.push({ item: 'Visa appointment booking', category: 'visa', required: true });
    }
    if (visa.type === 'evisa') {
      checklist.push({ item: 'E-visa application online', category: 'visa', required: true });
    }

    checklist.push(
      { item: 'Flight booking', category: 'transport', required: true },
      { item: 'Accommodation booking', category: 'accommodation', required: true },
      { item: 'Local currency/travel card', category: 'finance', required: false },
      { item: 'Emergency contacts list', category: 'safety', required: false }
    );

    return checklist;
  }

  // ============================================
  // WEATHER & ALERTS (Simulated)
  // ============================================

  getWeatherAlert(destination) {
    // Simulated weather alerts based on season and region
    const now = new Date();
    const month = now.getMonth(); // 0-11
    const destInfo = this.data.countries[destination];
    
    const alerts = [];

    // Monsoon seasons
    if (['IN', 'BD', 'NP', 'LK', 'MM', 'TH', 'VN', 'KH', 'LA', 'PH'].includes(destination)) {
      if (month >= 5 && month <= 9) {
        alerts.push({
          type: 'weather',
          severity: 'moderate',
          title: 'Monsoon Season',
          message: 'Heavy rainfall expected. Pack waterproof gear and expect some travel disruptions.'
        });
      }
    }

    // Hurricane season (Caribbean/Gulf)
    if (['JM', 'HT', 'DO', 'CU', 'BS', 'PR', 'MX', 'BZ', 'HN', 'NI', 'GT'].includes(destination)) {
      if (month >= 5 && month <= 10) {
        alerts.push({
          type: 'weather',
          severity: 'high',
          title: 'Hurricane Season',
          message: 'Atlantic hurricane season active. Monitor weather forecasts and have flexible travel plans.'
        });
      }
    }

    // Typhoon season (Pacific)
    if (['PH', 'JP', 'TW', 'CN', 'VN', 'HK'].includes(destination)) {
      if (month >= 5 && month <= 11) {
        alerts.push({
          type: 'weather',
          severity: 'moderate',
          title: 'Typhoon Season',
          message: 'Typhoons may affect travel. Check forecasts and airline policies.'
        });
      }
    }

    // Extreme heat
    if (['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'IQ', 'IR'].includes(destination)) {
      if (month >= 4 && month <= 9) {
        alerts.push({
          type: 'weather',
          severity: 'moderate',
          title: 'Extreme Heat Warning',
          message: 'Temperatures may exceed 45°C. Stay hydrated, limit outdoor activities during midday.'
        });
      }
    }

    // Wildfire season
    if (['AU', 'US', 'CA', 'GR', 'PT', 'ES', 'IT'].includes(destination)) {
      if ((destInfo?.continent === 'Oceania' && month >= 10) || 
          (destInfo?.continent !== 'Oceania' && month >= 5 && month <= 9)) {
        alerts.push({
          type: 'weather',
          severity: 'moderate',
          title: 'Wildfire Risk',
          message: 'Elevated wildfire risk in some regions. Check local conditions.'
        });
      }
    }

    // Winter conditions
    if (['CA', 'RU', 'NO', 'SE', 'FI', 'IS'].includes(destination)) {
      if (month >= 10 || month <= 2) {
        alerts.push({
          type: 'weather',
          severity: 'low',
          title: 'Winter Conditions',
          message: 'Heavy snow and extreme cold possible. Pack appropriate winter gear.'
        });
      }
    }

    if (alerts.length === 0) {
      alerts.push({
        type: 'weather',
        severity: 'none',
        title: 'No Active Weather Alerts',
        message: 'Normal weather conditions expected. Always check local forecasts before travel.'
      });
    }

    return alerts;
  }

  // ============================================
  // DASHBOARD STATS
  // ============================================

  getPassportStats(passportCountry) {
    let visaFreeCount = 0;
    let voaCount = 0;
    let eVisaCount = 0;
    let visaRequiredCount = 0;

    for (const destCode of Object.keys(this.data.countries)) {
      if (destCode === passportCountry) continue;
      
      const result = this.getVisaRequirement(passportCountry, destCode);
      
      switch (result.type) {
        case 'free':
        case 'domestic':
          visaFreeCount++;
          break;
        case 'voa':
          voaCount++;
          break;
        case 'evisa':
          eVisaCount++;
          break;
        case 'embassy':
        case 'restricted':
        default:
          visaRequiredCount++;
      }
    }

    return {
      passport: this.getCountryName(passportCountry),
      passportCode: passportCountry,
      tier: this._getPassportTier(passportCountry),
      visaFree: visaFreeCount,
      visaOnArrival: voaCount,
      eVisa: eVisaCount,
      visaRequired: visaRequiredCount,
      totalDestinations: Object.keys(this.data.countries).length - 1,
      mobilityScore: visaFreeCount + voaCount + eVisaCount
    };
  }
}

// Singleton export
const travelEngine = new TravelEngine();
export default travelEngine;
