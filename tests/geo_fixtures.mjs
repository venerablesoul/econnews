// Answers of the map and monitor sources for the tests, in the shapes the real services return
// (checked against live answers from GitHub's network: probe/ on the probe branch).
const now = Date.now();
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export const usgs = {
  type: "FeatureCollection", metadata: { generated: now - 60e3, title: "USGS Magnitude 2.5+ Earthquakes, Past Week", count: 3 },
  features: [
    { type: "Feature", properties: { mag: 6.4, place: "120 km SSE of Tokyo, Japan", time: now - 5 * 3600e3, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1", tsunami: 1, alert: "yellow" },
      geometry: { type: "Point", coordinates: [140.2, 34.6, 35.2] }, id: "us1" },
    { type: "Feature", properties: { mag: 4.7, place: "Central Chile", time: now - 30 * 3600e3, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us2", tsunami: 0, alert: null },
      geometry: { type: "Point", coordinates: [-71.5, -33.1, 60] }, id: "us2" },
    { type: "Feature", properties: { mag: 2.9, place: "5 km N of Ridgecrest, CA", time: now - 50 * 3600e3, url: "https://earthquake.usgs.gov/earthquakes/eventpage/ci3", tsunami: 0, alert: null },
      geometry: { type: "Point", coordinates: [-117.67, 35.67, 8] }, id: "ci3" },
  ],
};

export const eonet = {
  title: "EONET Events", events: [
    { id: "EONET_1", title: "Canyon Fire, California", categories: [{ id: "wildfires", title: "Wildfires" }], sources: [{ id: "InciWeb", url: "https://inciweb.example/1" }],
      geometry: [{ magnitudeValue: 12500, magnitudeUnit: "acres", date: new Date(now - 864e5).toISOString(), type: "Point", coordinates: [-118.6, 34.4] }] },
    { id: "EONET_2", title: "Wildfire in Siberia", categories: [{ id: "wildfires", title: "Wildfires" }], sources: [{ id: "GDACS", url: "https://gdacs.example/2" }],
      geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: new Date(now - 2 * 864e5).toISOString(), type: "Point", coordinates: [112.5, 58.1] }] },
    { id: "EONET_3", title: "Etna Volcano, Italy", categories: [{ id: "volcanoes", title: "Volcanoes" }], sources: [{ id: "SIVolcano", url: "https://volcano.si.edu/x" }],
      geometry: [{ date: new Date(now - 5 * 864e5).toISOString(), type: "Point", coordinates: [14.99, 37.75] }] },
  ],
};

// GDACS: the SEARCH list gives a point per event; a current cyclone's track and cone come from its "geometry" address
const tcProps = { eventtype: "TC", eventid: 1001234, episodeid: 12, eventname: "MELISSA-26", name: "Tropical Cyclone MELISSA-26", alertlevel: "Orange",
  country: "Jamaica", fromdate: day(now - 4 * 864e5) + "T00:00:00", todate: day(now) + "T06:00:00", iscurrent: "true", Class: "Point_Centroid",
  severitydata: { severity: 213.0, severitytext: "Category 4 hurricane (max wind speed of 213 km/h)", severityunit: "km/h" },
  url: { report: "https://www.gdacs.org/report.aspx?eventid=1001234&episodeid=12&eventtype=TC",
    geometry: "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001234&episodeid=12", details: "" } };
export const gdacsSearchTC = {
  type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-77.4, 17.6] }, properties: tcProps },
    { type: "Feature", geometry: { type: "Point", coordinates: [130.1, 20.2] }, properties: { ...tcProps, eventid: 1001200, eventname: "OLD-26", iscurrent: "false",
      url: { report: "https://www.gdacs.org/x", geometry: "" } } },
  ],
};
export const gdacsGeometry = {
  type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: [[-70.1, 15.0], [-73.2, 15.9], [-75.8, 16.8], [-77.4, 17.6]] }, properties: { Class: "Line_Line_0" } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-77.4, 17.6], [-80.0, 20.5], [-78.5, 21.8], [-75.9, 19.0], [-77.4, 17.6]]] }, properties: { Class: "Poly_Cones" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-73.2, 15.9] }, properties: { Class: "Point_Polygon_Point_1" } },
  ],
};
export const gdacsAlerts = {
  type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [90.4, 23.7] }, properties: { eventtype: "FL", eventid: 22, episodeid: 1, name: "Flood in Bangladesh",
      alertlevel: "Red", Class: "Point_Centroid", iscurrent: "true", country: "Bangladesh", fromdate: day(now - 6 * 864e5) + "T00:00:00", severitydata: { severity: 0, severitytext: "Magnitude 2.1" }, url: { report: "https://www.gdacs.org/x" } } },
    { type: "Feature", geometry: { type: "Point", coordinates: [140.2, 34.6] }, properties: { eventtype: "EQ", eventid: 33, episodeid: 1, name: "Earthquake in Japan",
      alertlevel: "Orange", Class: "Point_Centroid", iscurrent: "true", country: "Japan", fromdate: day(now) + "T00:00:00", severitydata: { severity: 6.4, severitytext: "Magnitude 6.4M, Depth:35km" }, url: { report: "https://www.gdacs.org/y" } } },
  ],
};

export const pwChokepoints = {
  features: [
    { attributes: { portid: "chokepoint1", portname: "Suez Canal", lat: 30.6, lon: 32.35, vessel_count_total: 24000, vessel_count_tanker: 6000, industry_top1: "Container" } },
    { attributes: { portid: "chokepoint6", portname: "Strait of Hormuz", lat: 26.6, lon: 56.4, vessel_count_total: 38000, vessel_count_tanker: 21000, industry_top1: "Tanker" } },
    { attributes: { portid: "chokepoint5", portname: "Malacca Strait", lat: 2.5, lon: 101.3, vessel_count_total: 80000, vessel_count_tanker: 25000, industry_top1: "Container" } },
  ],
};
function dailyRows() {
  const out = [];
  for (let i = 1; i <= 40; i++) {
    const d = new Date(now - (i + 3) * 864e5);
    const base = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    out.push({ attributes: { ...base, portid: "chokepoint1", portname: "Suez Canal", n_total: i <= 7 ? 30 : 40, n_tanker: 8, n_container: 12, n_dry_bulk: 6, n_cargo: 22, capacity: 2.1e6, capacity_tanker: 0.6e6 } });
    out.push({ attributes: { ...base, portid: "chokepoint6", portname: "Strait of Hormuz", n_total: 100, n_tanker: 60, n_container: 10, n_dry_bulk: 5, n_cargo: 40, capacity: 5.5e6, capacity_tanker: 4.1e6 } });
    out.push({ attributes: { ...base, portid: "chokepoint5", portname: "Malacca Strait", n_total: i <= 7 ? 230 : 200, n_tanker: 70, n_container: 80, n_dry_bulk: 40, n_cargo: 160, capacity: 9e6, capacity_tanker: 3e6 } });
  }
  return { features: out };
}
export const pwDaily = dailyRows();

export function openMeteo(n) {
  const time = Array.from({ length: 7 }, (_, i) => day(now + i * 864e5));
  return Array.from({ length: n }, (_, i) => ({
    latitude: 0, longitude: 0, current: { temperature_2m: -5 + (i % 40), wind_speed_10m: 10 + i % 7, weather_code: [0, 3, 61, 71][i % 4] },
    daily: { time, temperature_2m_max: time.map((_, j) => 2 + (i % 35) + j * 0.2), temperature_2m_min: time.map((_, j) => -6 + (i % 35) + j * 0.1), precipitation_sum: time.map(() => 0.5) },
  }));
}

export function nager(cc, y) {
  return [{ date: y + "-12-25", localName: cc === "RU" ? "Рождество" : "Christmas", name: "Christmas Day", countryCode: cc, global: true, types: ["Public"] },
    { date: y + "-11-04", localName: "День народного единства", name: "Unity Day", countryCode: cc, global: true, types: ["Public"] }].filter((h) => cc === "RU" || h.name !== "Unity Day");
}

// the Treasury's Fiscal Data API (auctions_query): strings, "null" for empty
export const treasury = { data: [
  { cusip: "912797QX8", security_type: "Bill", security_term: "13-Week", auction_date: day(now - 3 * 864e5), issue_date: day(now), maturity_date: day(now + 91 * 864e5),
    high_yield: "null", high_discnt_rate: "3.885", high_investment_rate: "3.962", int_rate: "null", bid_to_cover_ratio: "2.91", offering_amt: "86000000000", reopening: "No",
    inflation_index_security: "No", floating_rate: "No" },
  { cusip: "912797QY6", security_type: "Bill", security_term: "26-Week", auction_date: day(now - 3 * 864e5), issue_date: day(now), maturity_date: day(now + 182 * 864e5),
    high_yield: "null", high_discnt_rate: "3.790", high_investment_rate: "3.890", int_rate: "null", bid_to_cover_ratio: "2.77", offering_amt: "77000000000", reopening: "No",
    inflation_index_security: "No", floating_rate: "No" },
], meta: { "total-count": 2 } };

export const binanceTrades = Array.from({ length: 20 }, (_, i) => ({ id: 1000 + i, price: String(81000 + i), qty: String(0.01 * (i + 1)), quoteQty: "810", time: now - (20 - i) * 1000, isBuyerMaker: i % 3 === 0 }));

// money markets and more curves, as rates.py adds them to docs/rates.json
export const ratesExtra = {
  mm: [{ k: "SOFR", c: "US", en: "Secured overnight financing rate", ru: "Обеспеченная ставка овернайт", v: 3.92, prev: 3.9, date: day(now - 864e5) },
    { k: "EFFR", c: "US", en: "Effective federal funds rate", ru: "Эффективная ставка по федеральным фондам", v: 3.88, prev: 3.88, date: day(now - 864e5) },
    { k: "RUONIA", c: "RU", en: "Ruble overnight index average", ru: "Индикатор RUONIA", v: 13.85, prev: 13.9, date: day(now - 864e5) }],
};
export const wpeJson = {
  updated: new Date(now - 3600e3).toISOString(), source: "Yahoo Finance (country ETFs)",
  rows: [{ c: "US", en: "United States", ru: "США", flag: "🇺🇸", s: "SPY", pe: 27.4, fpe: 22.1, pb: 5.2, dy: 1.15, ch: -1.1, rytd: 14.2 },
    { c: "DE", en: "Germany", ru: "Германия", flag: "🇩🇪", s: "EWG", pe: 17.9, fpe: 14.2, pb: 1.9, dy: 2.4, ch: 0.3, rytd: 21.5 },
    { c: "CN", en: "China", ru: "Китай", flag: "🇨🇳", s: "MCHI", pe: 12.3, fpe: 10.8, pb: 1.5, dy: 2.1, ch: 1.4, rytd: 28.9 }],
};
export const macroMap = { year: new Date().getUTCFullYear(), NGDP_RPCH: { USA: 2.0, CHN: 4.8, IND: 6.5, DEU: 0.2, RUS: 0.9, BRA: 2.4, ARG: -1.3 },
  PCPIPCH: { USA: 2.8, ARG: 41.3, TUR: 34.0, RUS: 8.4 }, LUR: { USA: 4.2, ESP: 11.1 }, GGXWDG_NGDP: { USA: 122, JPN: 235 }, BCA_NGDPD: { CHN: 2.1, USA: -3.9 }, GGXCNL_NGDP: { USA: -6.5 } };

// PortWatch ports: 150 ports, Rotterdam the busiest
export const pwPorts = { features: Array.from({ length: 150 }, (_, i) => ({ attributes: i === 0
  ? { portname: "Rotterdam", country: "Netherlands", ISO3: "NLD", lat: 51.95, lon: 4.14, vessel_count_total: 52000, vessel_count_tanker: 15000, industry_top1: "Container" }
  : { portname: "Port " + i, country: "Somewhere", ISO3: "XXX", lat: -40 + (i * 0.53) % 80, lon: -170 + (i * 7.3) % 340, vessel_count_total: 100 + i * 37, vessel_count_tanker: 10 + i, industry_top1: "Dry bulk" } })) };
