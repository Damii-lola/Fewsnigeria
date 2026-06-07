// server.js – FEWS Nigeria Backend
// Weather: Open-Meteo (free, no API key)
// Communities: scraped from fewsnigeria.com.ng/floodmap/wwo_flood_lga@risk.php

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

const cache = new NodeCache({ stdTTL: 600 });

const http = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  },
  timeout: 30000,
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

// DEBUG endpoints
app.get('/test-scrape', async (req, res) => {
  const url = req.query.url || 'https://www.fewsnigeria.com.ng';
  const html = await fetchHTML(url);
  if (html) res.send(`<pre>${html.substring(0, 5000)}</pre>`);
  else res.status(500).send('Cannot fetch website');
});

app.get('/test-communities-raw', async (req, res) => {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng/floodmap/wwo_flood_lga@risk.php');
  if (html) res.send(`<pre>${html.substring(0, 10000)}</pre>`);
  else res.status(500).send('Cannot fetch communities page');
});

// RIVER STATUS
async function scrapeRiverStatus() {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (!html) return getFallbackRivers();
  const $ = cheerio.load(html);
  let rivers = [];
  console.log(`Found ${$('table').length} tables on page`);
  $('table').each((idx, table) => {
    $(table).find('tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 4) {
        const name  = $(cols[0]).text().trim();
        const level = $(cols[1]).text().trim();
        const trend = $(cols[2]).text().trim();
        const risk  = $(cols[3]).text().trim();
        if (name && (level.includes('m') || trend.includes('↑'))) {
          rivers.push({ name, level, trend, risk });
        }
      }
    });
  });
  console.log(`Scraped ${rivers.length} river entries`);
  if (rivers.length === 0) return getFallbackRivers();
  return rivers.slice(0, 10);
}

function getFallbackRivers() {
  return [
    { name: 'Niger (Lokoja)',  level: '9.15m', trend: '↑ Rising', risk: 'Severe' },
    { name: 'Benue (Makurdi)', level: '9.85m', trend: '↑ Rising', risk: 'Severe' },
    { name: 'Kaduna',          level: '5.20m', trend: '↑ Rising', risk: 'High' },
    { name: 'Cross River',     level: '3.45m', trend: '↑ Rising', risk: 'High' },
  ];
}

// RISK SUMMARY
async function scrapeRiskSummary() {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (!html) return getFallbackSummary();
  const totalMatch    = html.match(/(\d{1,4}(?:,\d{3})*)\s*(?:communities|total)/i);
  const criticalMatch = html.match(/(\d{1,3})\s*(?:critical|severe)/i);
  const highMatch     = html.match(/(\d{1,3})\s*high\s*risk/i);
  const moderateMatch = html.match(/(\d{1,3})\s*moderate/i);
  const avgMatch      = html.match(/(\d{1,2})\/100/i);
  const total    = totalMatch    ? parseInt(totalMatch[1].replace(/,/g, '')) : 2000;
  const critical = criticalMatch ? parseInt(criticalMatch[1])                : 914;
  const high     = highMatch     ? parseInt(highMatch[1])                    : 430;
  const moderate = moderateMatch ? parseInt(moderateMatch[1])                : 656;
  const avg      = avgMatch      ? parseInt(avgMatch[1])                     : 76;
  console.log(`Risk summary: total=${total}, critical=${critical}, high=${high}, moderate=${moderate}, avg=${avg}`);
  return { totalCommunities: total, criticalCount: critical, highCount: high, moderateCount: moderate, avgRiskScore: avg };
}

function getFallbackSummary() {
  return { totalCommunities: 2000, criticalCount: 914, highCount: 430, moderateCount: 656, avgRiskScore: 76 };
}

// COMMUNITIES
function parseRiskScore(rawRisk, rawScore) {
  const num = parseInt(rawScore);
  if (!isNaN(num) && num > 0) return Math.min(num, 100);
  const r = (rawRisk || '').toLowerCase();
  if (r.includes('critical') || r.includes('severe') || r.includes('extreme')) return 92;
  if (r.includes('high'))     return 75;
  if (r.includes('moderate')) return 55;
  if (r.includes('low'))      return 25;
  return 50;
}

function scoreToAction(score) {
  if (score >= 85) return 'Evacuate Now';
  if (score >= 70) return 'Take Action';
  if (score >= 50) return 'Be Prepared';
  return 'Monitor Situation';
}

const RISK_WORDS = new Set(['critical','high','moderate','low','severe','extreme','evacuate','emergency','n/a','na','nil','none']);

function isJunkName(raw) {
  if (!raw) return true;
  const s = raw.toLowerCase().trim();
  if (/^\d+(\.\d+)?$/.test(s)) return true;
  if (/^(critical|high|moderate|low|severe|extreme|evacuate|emergency)(\s*[·•\-]\s*\d+)?$/i.test(s)) return true;
  if (/^[^a-z0-9]+$/i.test(s)) return true;
  if (s.length < 2) return true;
  return false;
}

async function scrapeCriticalCommunities() {
  const html = await fetchHTML('https://www.fewsnigeria.com.ng/floodmap/wwo_flood_lga@risk.php');

  if (html) {
    const $ = cheerio.load(html);
    const communities = [];
    const tables = $('table');
    console.log(`Communities page: found ${tables.length} tables`);

    tables.each((tIdx, table) => {
      // Log headers
      const headerCells = [];
      $(table).find('tr').first().find('th, td').each((ci, cell) => {
        headerCells.push(`[${ci}]="${$(cell).text().trim()}"`);
      });
      console.log(`Table ${tIdx} headers: ${headerCells.join(', ')}`);

      // Detect if this is a SUMMARY table (has community count col but no LGA col)
      let hasCommunityCountCol = false;
      let hasLgaCol = false;
      $(table).find('tr').first().find('th, td').each((ci, cell) => {
        const h = $(cell).text().toLowerCase().trim();
        if (h === 'communities' || h === 'no. of communities' || h === 'community count') hasCommunityCountCol = true;
        if (h === 'lga' || h.startsWith('lga ') || h === 'local government') hasLgaCol = true;
      });

      if (hasCommunityCountCol && !hasLgaCol) {
        console.log(`Table ${tIdx} — summary table, skipping`);
        return;
      }

      // Detect columns — score BEFORE risk to prevent "Risk Score" hitting colRisk
      let colSN = -1, colState = -1, colLga = -1, colCommunity = -1, colRisk = -1, colScore = -1;

      $(table).find('tr').first().find('th, td').each((ci, cell) => {
        const h = $(cell).text().toLowerCase().trim();
        if      (h === 's/n' || h === 'sn' || h === 'rank' || h === 'no' || h === '#') colSN        = ci;
        else if (h === 'state' || h === 'state name')                                    colState     = ci;
        else if (h === 'lga' || h === 'lga name' || h.startsWith('local gov'))          colLga       = ci;
        else if (h === 'community name' || h === 'community' || h === 'town'
               || h === 'name' || h.includes('settlement'))                              colCommunity = ci;
        // score BEFORE risk
        else if (h === 'risk score' || h === 'avg score' || h === 'score'
               || h.includes('flood score') || h === 'index')                            colScore     = ci;
        else if (h === 'risk level' || h === 'risk' || h === 'risk status'
               || h === 'level' || h === 'category')                                     colRisk      = ci;
      });

      // Positional defaults using known Table 1 layout:
      // [0]=S/N [1]=State [2]=LGA [3]=Community Name [4]=Risk Level [5]=Risk Score
      const offset = colSN >= 0 ? 1 : 0;
      if (colState     < 0) colState     = offset + 0;
      if (colLga       < 0) colLga       = offset + 1;
      if (colCommunity < 0) colCommunity = offset + 2;
      if (colRisk      < 0) colRisk      = offset + 3;
      if (colScore     < 0) colScore     = offset + 4;

      console.log(`Table ${tIdx} final cols — state:${colState} lga:${colLga} community:${colCommunity} risk:${colRisk} score:${colScore}`);

      $(table).find('tr').each((rIdx, row) => {
        if (rIdx === 0) return; // skip header
        const cols = $(row).find('td');
        if (cols.length < 3) return;

        const state     = $(cols[colState])?.text().trim()     || '';
        const lga       = $(cols[colLga])?.text().trim()       || '';
        const nameRaw   = $(cols[colCommunity])?.text().trim() || '';
        const riskText  = $(cols[colRisk])?.text().trim()      || '';
        const scoreText = $(cols[colScore])?.text().trim()     || '';

        if (!state && !lga && !nameRaw) return;

        // Clean "· 42" or "• 42" count suffixes from state/lga first
        const cleanState = state.replace(/[·•]\s*\d+/g, '').trim();
        const cleanLga   = lga.replace(/[·•]\s*\d+/g, '').trim();

        // Validate name — use isJunkName() which catches numbers, risk labels,
        // "Critical · 42" style strings, pure punctuation etc.
        const displayName = !isJunkName(nameRaw)
          ? nameRaw
          : !isJunkName(cleanLga)
            ? cleanLga
            : !isJunkName(cleanState)
              ? cleanState
              : null;

        if (!displayName) return; // skip rows with no usable name at all

        const score = parseRiskScore(riskText, scoreText);
        communities.push({
          id:        `${tIdx}_${rIdx}`,
          name:      displayName,
          state:     cleanState,
          lga:       cleanLga,
          riskScore: score,
          weather:   'N/A',
          action:    scoreToAction(score),
        });
      });
    });

    console.log(`Scraped ${communities.length} communities from WWO flood map`);

    if (communities.length > 0) {
      // Deduplicate
      const seen = new Set();
      const unique = communities.filter(c => {
        const key = `${c.name}|${c.state}|${c.lga}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => b.riskScore - a.riskScore);
      console.log(`Returning ${unique.length} unique communities`);
      return unique;
    }
  }

  // FALLBACK: homepage
  console.log('WWO page failed — trying homepage fallback');
  const homeHtml = await fetchHTML('https://www.fewsnigeria.com.ng');
  if (homeHtml) {
    const $h = cheerio.load(homeHtml);
    const communities = [];
    const pattern = /Port Harcourt|Okrika|Bonny|Warri|Lokoja|Makurdi|Onitsha|Asaba|Calabar|Benin City/;
    $h('.community,.card,.item,li').each((i, el) => {
      const text = $h(el).text();
      if (pattern.test(text)) {
        const name = $h(el).find('h3,h4,strong,.title').first().text().trim() || text.slice(0, 60).trim();
        if (name) communities.push({ id: i.toString(), name, state: '', lga: '', riskScore: 85, weather: 'N/A', action: 'Evacuate Now' });
      }
    });
    if (communities.length > 0) {
      console.log(`Homepage fallback: ${communities.length} communities`);
      return communities;
    }
  }

  console.log('All scrapes failed — using hardcoded fallback');
  return getFallbackCommunities();
}

function getFallbackCommunities() {
  return [
    { id:'1',  name:'Port Harcourt urban core',  state:'Rivers',  lga:'Port Harcourt',  riskScore:100, weather:'N/A', action:'Evacuate Now' },
    { id:'2',  name:'Okrika island/waterfront',   state:'Rivers',  lga:'Okrika',         riskScore:100, weather:'N/A', action:'Evacuate Now' },
    { id:'3',  name:'Bonny Island',               state:'Rivers',  lga:'Bonny',          riskScore:100, weather:'N/A', action:'Evacuate Now' },
    { id:'4',  name:'Warri city',                 state:'Delta',   lga:'Warri South',    riskScore:100, weather:'N/A', action:'Evacuate Now' },
    { id:'5',  name:'Burutu town',                state:'Delta',   lga:'Burutu',         riskScore:100, weather:'N/A', action:'Evacuate Now' },
    { id:'6',  name:'Brass/Nembe-Brass coast',    state:'Bayelsa', lga:'Brass',          riskScore:100, weather:'N/A', action:'Evacuate Now' },
    { id:'7',  name:'Onitsha metropolis',         state:'Anambra', lga:'Onitsha North',  riskScore:98,  weather:'N/A', action:'Evacuate Now' },
    { id:'8',  name:'Asaba city',                 state:'Delta',   lga:'Oshimili South', riskScore:97,  weather:'N/A', action:'Evacuate Now' },
    { id:'9',  name:'Lokoja metropolis',          state:'Kogi',    lga:'Lokoja',         riskScore:96,  weather:'N/A', action:'Evacuate Now' },
    { id:'10', name:'Makurdi city',               state:'Benue',   lga:'Makurdi',        riskScore:95,  weather:'N/A', action:'Evacuate Now' },
  ];
}

// STATE BREAKDOWN
async function scrapeStateBreakdown() {
  return {
    critical: ['Abia','Akwa Ibom','Anambra','Bayelsa','Benue','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Imo','Lagos','Ogun','Ondo','Osun','Oyo','Rivers'],
    high:     ['Adamawa','Kebbi','Kogi','Kwara','Niger','Taraba'],
    moderate: ['Bauchi','Borno','FCT','Gombe','Jigawa','Kaduna','Kano','Katsina','Nasarawa','Plateau','Sokoto','Yobe','Zamfara'],
  };
}

// WEATHER
async function fetchWeatherFromOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,weather_code&wind_speed_unit=kmh&timezone=auto`;
  const response = await axios.get(url);
  const current  = response.data.current;
  const desc = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Light showers',81:'Showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with heavy hail' };
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return {
    temp:      `${current.temperature_2m}°C`,
    condition: desc[current.weather_code] || 'Unknown',
    humidity:  `${current.relative_humidity_2m}%`,
    feelsLike: `${current.apparent_temperature}°C`,
    wind:      `${dirs[Math.round(current.wind_direction_10m/45)%8]} ${current.wind_speed_10m} km/h`,
  };
}

// ENDPOINTS
app.get('/river-status', async (req, res) => {
  let d = cache.get('rivers');
  if (!d) { d = await scrapeRiverStatus(); cache.set('rivers', d); }
  res.json({ rivers: d });
});

app.get('/risk-summary', async (req, res) => {
  let d = cache.get('summary');
  if (!d) { d = await scrapeRiskSummary(); cache.set('summary', d); }
  res.json(d);
});

app.get('/communities', async (req, res) => {
  let d = cache.get('communities');
  if (!d) { d = await scrapeCriticalCommunities(); cache.set('communities', d, 3600); }
  res.json({ communities: d });
});

app.get('/state-breakdown', async (req, res) => {
  let d = cache.get('states');
  if (!d) { d = await scrapeStateBreakdown(); cache.set('states', d); }
  res.json(d);
});

app.get('/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });
  try {
    const key = `weather_${lat}_${lon}`;
    let d = cache.get(key);
    if (!d) { d = await fetchWeatherFromOpenMeteo(lat, lon); cache.set(key, d); }
    res.json(d);
  } catch (e) {
    console.error('Weather error:', e.message);
    res.status(502).json({ error: 'Weather failed' });
  }
});

app.get('/', (req, res) => res.send('FEWS Nigeria Backend is live'));
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
