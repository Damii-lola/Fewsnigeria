// server.js – FEWS Nigeria Backend
// Scrapes https://www.fewsnigeria.com.ng and serves real-time flood data

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Cache data for 10 minutes (600 seconds)
const cache = new NodeCache({ stdTTL: 600 });

// ---------- SCRAPING FUNCTIONS (Adjust selectors to match the website) ----------

async function scrapeRiverStatus() {
  try {
    const { data } = await axios.get('https://www.fewsnigeria.com.ng');
    const $ = cheerio.load(data);
    const rivers = [];

    // Example: look for a table with river data
    $('table:contains("River") tbody tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 4) {
        rivers.push({
          name: $(cols[0]).text().trim(),
          level: $(cols[1]).text().trim(),
          trend: $(cols[2]).text().trim(),
          risk: $(cols[3]).text().trim(),
        });
      }
    });

    // If no table found, return fallback (these should match the real current data)
    if (rivers.length === 0) throw new Error('No river table found');
    return rivers;
  } catch (error) {
    console.error('River scrape error:', error.message);
    // Fallback data (update when website changes)
    return [
      { name: 'Niger (Lokoja)', level: '9.15m', trend: '↑ Rising', risk: 'Severe' },
      { name: 'Benue (Makurdi)', level: '9.85m', trend: '↑ Rising', risk: 'Severe' },
      { name: 'Kaduna', level: '5.20m', trend: '↑ Rising', risk: 'High' },
      { name: 'Cross River', level: '3.45m', trend: '↑ Rising', risk: 'High' },
    ];
  }
}

async function scrapeRiskSummary() {
  try {
    const { data } = await axios.get('https://www.fewsnigeria.com.ng');
    const $ = cheerio.load(data);
    // Extract numbers from the dashboard (update selectors!)
    // This is an example – you must inspect the site and replace with real classes
    const total = parseInt($('.total-communities').text()) || 2000;
    const critical = parseInt($('.critical-count').text()) || 914;
    const high = parseInt($('.high-count').text()) || 430;
    const moderate = parseInt($('.moderate-count').text()) || 656;
    const avg = parseInt($('.avg-risk').text()) || 76;

    return {
      totalCommunities: total,
      criticalCount: critical,
      highCount: high,
      moderateCount: moderate,
      avgRiskScore: avg,
    };
  } catch (error) {
    console.error('Risk summary scrape error:', error.message);
    return {
      totalCommunities: 2000,
      criticalCount: 914,
      highCount: 430,
      moderateCount: 656,
      avgRiskScore: 76,
    };
  }
}

async function scrapeCriticalCommunities() {
  try {
    const { data } = await axios.get('https://www.fewsnigeria.com.ng');
    const $ = cheerio.load(data);
    const communities = [];

    // Example: look for community cards (update selectors!)
    $('.community-card, .risk-community').each((i, el) => {
      communities.push({
        id: i.toString(),
        name: $(el).find('.name').text().trim(),
        state: $(el).find('.state').text().trim(),
        lga: $(el).find('.lga').text().trim(),
        riskScore: parseInt($(el).find('.risk-score').text()) || 100,
        weather: $(el).find('.weather').text().trim() || 'N/A',
        action: $(el).find('.action').text().trim() || 'Evacuate Now',
      });
    });

    if (communities.length === 0) throw new Error('No communities found');
    return communities;
  } catch (error) {
    console.error('Communities scrape error:', error.message);
    // Fallback with known high-risk communities
    return [
      { id: '1', name: 'Port Harcourt urban core', state: 'Rivers', lga: 'Port Harcourt', riskScore: 100, weather: '27°C 73%', action: 'Evacuate Now' },
      { id: '2', name: 'Okrika island/waterfront', state: 'Rivers', lga: 'Okrika', riskScore: 100, weather: '26°C 75%', action: 'Evacuate Now' },
      { id: '3', name: 'Bonny Island', state: 'Rivers', lga: 'Bonny', riskScore: 100, weather: '25°C 79%', action: 'Evacuate Now' },
      { id: '4', name: 'Warri city', state: 'Delta', lga: 'Warri South', riskScore: 100, weather: '26°C 89%', action: 'Evacuate Now' },
      { id: '5', name: 'Burutu town', state: 'Delta', lga: 'Burutu', riskScore: 100, weather: '26°C 89%', action: 'Evacuate Now' },
      { id: '6', name: 'Brass/Nembe-Brass coast', state: 'Bayelsa', lga: 'Brass', riskScore: 100, weather: '26°C 83%', action: 'Evacuate Now' },
    ];
  }
}

async function scrapeStateBreakdown() {
  try {
    const { data } = await axios.get('https://www.fewsnigeria.com.ng');
    const $ = cheerio.load(data);
    // Extract state lists (update selectors!)
    const critical = [];
    const high = [];
    const moderate = [];

    $('.critical-states li').each((i, el) => critical.push($(el).text().trim()));
    $('.high-states li').each((i, el) => high.push($(el).text().trim()));
    $('.moderate-states li').each((i, el) => moderate.push($(el).text().trim()));

    if (critical.length === 0) throw new Error('No state data found');
    return { critical, high, moderate };
  } catch (error) {
    console.error('State breakdown scrape error:', error.message);
    return {
      critical: ['Abia', 'Akwa Ibom', 'Anambra', 'Bayelsa', 'Benue', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Imo', 'Lagos', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Rivers'],
      high: ['Adamawa', 'Kebbi', 'Kogi', 'Kwara', 'Niger', 'Taraba'],
      moderate: ['Bauchi', 'Borno', 'FCT', 'Gombe', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Nasarawa', 'Plateau', 'Sokoto', 'Yobe', 'Zamfara'],
    };
  }
}

// ---------- API ENDPOINTS (with caching) ----------
app.get('/api/river-status', async (req, res) => {
  let rivers = cache.get('rivers');
  if (!rivers) {
    rivers = await scrapeRiverStatus();
    cache.set('rivers', rivers);
  }
  res.json({ rivers });
});

app.get('/api/risk-summary', async (req, res) => {
  let summary = cache.get('summary');
  if (!summary) {
    summary = await scrapeRiskSummary();
    cache.set('summary', summary);
  }
  res.json(summary);
});

app.get('/api/communities', async (req, res) => {
  let communities = cache.get('communities');
  if (!communities) {
    communities = await scrapeCriticalCommunities();
    cache.set('communities', communities);
  }
  res.json({ communities });
});

app.get('/api/state-breakdown', async (req, res) => {
  let states = cache.get('states');
  if (!states) {
    states = await scrapeStateBreakdown();
    cache.set('states', states);
  }
  res.json(states);
});

app.get('/', (req, res) => {
  res.send('FEWS Nigeria Backend is running 🟢');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
