// server.js - Enhanced with better logging and User-Agent
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

const cache = new NodeCache({ stdTTL: 600 });

const WWO_API_KEY = process.env.WWO_API_KEY;

// Custom axios instance with proper headers to avoid blocking
const http = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  },
  timeout: 15000,
});

async function fetchHTML(url) {
  try {
    const response = await http.get(url);
    console.log(`Fetched ${url} - status: ${response.status}, length: ${response.data.length}`);
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    return null;
  }
}

// Test endpoint to see raw HTML
app.get('/test-scrape', async (req, res) => {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (html) {
    // Send first 2000 chars for inspection
    res.send(`<pre>${html.substring(0, 2000)}</pre>`);
  } else {
    res.status(500).send('Cannot fetch website');
  }
});

// ------------------- RIVER STATUS -------------------
async function scrapeRiverStatus() {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (!html) return getFallbackRivers();
  
  const $ = cheerio.load(html);
  let rivers = [];
  
  // Log all tables found
  console.log(`Found ${$('table').length} tables on page`);
  
  // Try to find any table with river-like content
  $('table').each((idx, table) => {
    const rows = $(table).find('tr');
    rows.each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 4) {
        const name = $(cols[0]).text().trim();
        const level = $(cols[1]).text().trim();
        const trend = $(cols[2]).text().trim();
        const risk = $(cols[3]).text().trim();
        if (name && (level.includes('m') || trend.includes('↑'))) {
          rivers.push({ name, level, trend, risk });
        }
      }
    });
  });
  
  if (rivers.length === 0) {
    // Try to find divs or other structures
    $('.river-item, .water-level').each((i, el) => {
      const name = $(el).find('.name').text().trim();
      const level = $(el).find('.level').text().trim();
      const trend = $(el).find('.trend').text().trim();
      const risk = $(el).find('.risk').text().trim();
      if (name) rivers.push({ name, level, trend, risk });
    });
  }
  
  console.log(`Scraped ${rivers.length} river entries`);
  if (rivers.length === 0) return getFallbackRivers();
  return rivers.slice(0, 10); // limit
}

function getFallbackRivers() {
  return [
    { name: 'Niger (Lokoja)', level: '9.15m', trend: '↑ Rising', risk: 'Severe' },
    { name: 'Benue (Makurdi)', level: '9.85m', trend: '↑ Rising', risk: 'Severe' },
    { name: 'Kaduna', level: '5.20m', trend: '↑ Rising', risk: 'High' },
    { name: 'Cross River', level: '3.45m', trend: '↑ Rising', risk: 'High' },
  ];
}

// ------------------- RISK SUMMARY -------------------
async function scrapeRiskSummary() {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (!html) return getFallbackSummary();
  
  // Look for numbers using regex
  const totalMatch = html.match(/(\d{1,4}(?:,\d{3})*)\s*(?:communities|total)/i);
  const criticalMatch = html.match(/(\d{1,3})\s*(?:critical|severe)/i);
  const highMatch = html.match(/(\d{1,3})\s*high\s*risk/i);
  const moderateMatch = html.match(/(\d{1,3})\s*moderate/i);
  const avgMatch = html.match(/(\d{1,2})\/100/i);
  
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g,'')) : 2000;
  const critical = criticalMatch ? parseInt(criticalMatch[1]) : 914;
  const high = highMatch ? parseInt(highMatch[1]) : 430;
  const moderate = moderateMatch ? parseInt(moderateMatch[1]) : 656;
  const avg = avgMatch ? parseInt(avgMatch[1]) : 76;
  
  console.log(`Risk summary: total=${total}, critical=${critical}, high=${high}, moderate=${moderate}, avg=${avg}`);
  return { totalCommunities: total, criticalCount: critical, highCount: high, moderateCount: moderate, avgRiskScore: avg };
}

function getFallbackSummary() {
  return {
    totalCommunities: 2000,
    criticalCount: 914,
    highCount: 430,
    moderateCount: 656,
    avgRiskScore: 76,
  };
}

// ------------------- CRITICAL COMMUNITIES -------------------
async function scrapeCriticalCommunities() {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (!html) return getFallbackCommunities();
  
  const $ = cheerio.load(html);
  let communities = [];
  
  // Try common patterns
  $('.community, .card, .item, li').each((i, el) => {
    const text = $(el).text();
    if (text.includes('Port Harcourt') || text.includes('Okrika') || text.includes('Bonny') || text.includes('Warri')) {
      const name = $(el).find('h3, h4, strong, .title').first().text().trim() || $(el).text().slice(0, 50);
      communities.push({
        id: i.toString(),
        name: name,
        state: 'Rivers', // default
        lga: '',
        riskScore: 100,
        weather: 'N/A',
        action: 'Evacuate Now',
      });
    }
  });
  
  if (communities.length === 0) return getFallbackCommunities();
  console.log(`Scraped ${communities.length} communities`);
  return communities;
}

function getFallbackCommunities() {
  return [
    { id: '1', name: 'Port Harcourt urban core', state: 'Rivers', lga: 'Port Harcourt', riskScore: 100, weather: '27°C 73%', action: 'Evacuate Now' },
    { id: '2', name: 'Okrika island/waterfront', state: 'Rivers', lga: 'Okrika', riskScore: 100, weather: '26°C 75%', action: 'Evacuate Now' },
    { id: '3', name: 'Bonny Island', state: 'Rivers', lga: 'Bonny', riskScore: 100, weather: '25°C 79%', action: 'Evacuate Now' },
    { id: '4', name: 'Warri city', state: 'Delta', lga: 'Warri South', riskScore: 100, weather: '26°C 89%', action: 'Evacuate Now' },
    { id: '5', name: 'Burutu town', state: 'Delta', lga: 'Burutu', riskScore: 100, weather: '26°C 89%', action: 'Evacuate Now' },
    { id: '6', name: 'Brass/Nembe-Brass coast', state: 'Bayelsa', lga: 'Brass', riskScore: 100, weather: '26°C 83%', action: 'Evacuate Now' },
  ];
}

// ------------------- STATE BREAKDOWN -------------------
async function scrapeStateBreakdown() {
  // For now return fallback; we can improve later
  return {
    critical: ['Abia', 'Akwa Ibom', 'Anambra', 'Bayelsa', 'Benue', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Imo', 'Lagos', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Rivers'],
    high: ['Adamawa', 'Kebbi', 'Kogi', 'Kwara', 'Niger', 'Taraba'],
    moderate: ['Bauchi', 'Borno', 'FCT', 'Gombe', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Nasarawa', 'Plateau', 'Sokoto', 'Yobe', 'Zamfara'],
  };
}

// ------------------- WEATHER -------------------
async function fetchWeatherFromWWO(lat, lon) {
  if (!WWO_API_KEY) throw new Error('Weather API key missing');
  const url = `https://api.worldweatheronline.com/premium/v1/weather.ashx?key=${WWO_API_KEY}&q=${lat},${lon}&format=json&num_of_days=1`;
  const response = await axios.get(url);
  const current = response.data.data.current_condition[0];
  return {
    temp: `${current.temp_C}°C`,
    condition: current.weatherDesc[0].value,
    humidity: `${current.humidity}%`,
    feelsLike: `${current.FeelsLikeC}°C`,
    wind: `${current.winddir16Point} ${current.windspeedKmph} km/h`,
  };
}

// ------------------- API ENDPOINTS (no /api prefix) -------------------
app.get('/river-status', async (req, res) => {
  let rivers = cache.get('rivers');
  if (!rivers) {
    rivers = await scrapeRiverStatus();
    cache.set('rivers', rivers);
  }
  res.json({ rivers });
});

app.get('/risk-summary', async (req, res) => {
  let summary = cache.get('summary');
  if (!summary) {
    summary = await scrapeRiskSummary();
    cache.set('summary', summary);
  }
  res.json(summary);
});

app.get('/communities', async (req, res) => {
  let communities = cache.get('communities');
  if (!communities) {
    communities = await scrapeCriticalCommunities();
    cache.set('communities', communities);
  }
  res.json({ communities });
});

app.get('/state-breakdown', async (req, res) => {
  let states = cache.get('states');
  if (!states) {
    states = await scrapeStateBreakdown();
    cache.set('states', states);
  }
  res.json(states);
});

app.get('/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });
  try {
    const cacheKey = `weather_${lat}_${lon}`;
    let weather = cache.get(cacheKey);
    if (!weather) {
      weather = await fetchWeatherFromWWO(lat, lon);
      cache.set(cacheKey, weather);
    }
    res.json(weather);
  } catch (error) {
    console.error('Weather error:', error.message);
    res.status(502).json({ error: 'Weather failed' });
  }
});

app.get('/', (req, res) => {
  res.send('FEWS Nigeria Backend is live');
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
