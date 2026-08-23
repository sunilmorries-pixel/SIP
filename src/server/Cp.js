/**
 * Cp.js — Channel Partner (CP) dealer coverage layer for the Overview map.
 *
 * WHY A STATIC CATALOG, NO BIGQUERY: unlike FSE (Fse.js), there is no ticket
 * field anywhere in the warehouse that names a CP — coverage here is a
 * DECLARED list of districts/cities per dealer company, not something
 * computed from tickets actually worked. So there is no coverage query, no
 * name-reconciliation step, and no "unmatched" bucket the way Fse.js has for
 * ServiceWRK representatives — buildCpLayer_ only has to resolve coordinates.
 *
 * CP_ROSTER SHIPS POPULATED (unlike FSE_ROSTER's deliberate empty start):
 * this data comes from a named, real source — "Progress on the Service
 * Dealer Network - BRM 2026.xlsx", 'CP' sheet, imported 2026-08-24 — not
 * placeholder content, so there is no "drawing a company that doesn't exist"
 * risk to guard against.
 *
 * Entry shape:
 *   name       {string}  REQUIRED. The dealer company name.
 *   hqCity     {string}  REQUIRED with hqState — informational only; not
 *   hqState    {string}  used to resolve the pin (lat/lng below does that).
 *   lat, lng   {number}  REQUIRED. Explicit HQ coordinate — supplied directly
 *                        rather than resolved through the geo store, because
 *                        most of these HQ/location towns have no guarantee of
 *                        already being geocoded via an existing center.
 *   locations  {Array<{name:string, lat:number, lng:number}>} the declared
 *                        covered districts/cities, each pre-geocoded the same
 *                        explicit way as the HQ.
 *
 * No `aliases`/`active` fields at this size (11 rows, 2026-08-24) — add them
 * if the roster later grows enough to need deactivating an entry without
 * deleting it (see Fse.js for the pattern to follow).
 */
var CP_ROSTER = [
  {
    name: 'SBM Corp', hqCity: 'Pune', hqState: 'Maharashtra', lat: 18.5204, lng: 73.8567,
    locations: [
      { name: 'Wardha', lat: 20.7453, lng: 78.6022 },
      { name: 'Baramati', lat: 18.1514, lng: 74.5815 },
      { name: 'Jalgaon', lat: 21.0077, lng: 75.5626 },
      { name: 'Akola', lat: 20.7002, lng: 77.0082 },
      { name: 'Kolhapur', lat: 16.7050, lng: 74.2433 },
      { name: 'Thane', lat: 19.2183, lng: 72.9781 },
      { name: 'Nagpur', lat: 21.1458, lng: 79.0882 },
      { name: 'Amravati', lat: 20.9374, lng: 77.7796 },
      { name: 'Nandurbar', lat: 21.3667, lng: 74.2500 },
      { name: 'Sindhudurg', lat: 16.0667, lng: 73.6333 },
      { name: 'Gadchiroli', lat: 20.1809, lng: 80.0037 },
      { name: 'Nanded', lat: 19.1383, lng: 77.3210 },
      { name: 'Buldhana', lat: 20.5293, lng: 76.1809 },
      { name: 'Palghar', lat: 19.6963, lng: 72.7692 },
      { name: 'Nashik', lat: 19.9975, lng: 73.7898 },
      { name: 'Gondia', lat: 21.4602, lng: 80.1922 },
      { name: 'Bhandara', lat: 21.1667, lng: 79.6500 },
      { name: 'Latur', lat: 18.4088, lng: 76.5604 },
      { name: 'Washim', lat: 20.1000, lng: 77.1333 },
      { name: 'Chandrapur', lat: 19.9500, lng: 79.3000 },
      { name: 'Satara', lat: 17.6805, lng: 74.0183 },
      // Sheet listed "Sangli" and "Sangali" (typo) as two rows — merged.
      { name: 'Sangli', lat: 16.8524, lng: 74.5815 },
      // Sheet listed "Chh. Sambajinagar" and "Aurangabad" as two rows — same
      // city, renamed 2023 — merged to the current name.
      { name: 'Chhatrapati Sambhajinagar', lat: 19.8762, lng: 75.3433 },
      { name: 'Beed', lat: 18.9891, lng: 75.7601 },
      { name: 'Dhule', lat: 20.9042, lng: 74.7749 },
      { name: 'Solapur', lat: 17.6599, lng: 75.9064 },
      { name: 'Jalna', lat: 19.8410, lng: 75.8864 },
      { name: 'Yavatmal', lat: 20.3888, lng: 78.1204 },
      { name: 'Parbhani', lat: 19.2704, lng: 76.7600 },
      { name: 'Raigad', lat: 18.6414, lng: 72.8722 },
      { name: 'Dharashiv', lat: 18.1667, lng: 76.0333 },
      { name: 'Ahilyanagar', lat: 19.0952, lng: 74.7496 },
      { name: 'Ratnagiri', lat: 16.9902, lng: 73.3120 },
      { name: 'Hingoli', lat: 19.7147, lng: 77.1449 }
      // Sheet also listed a bare lowercase "pune" — dropped as a duplicate of
      // this CP's own HQ city.
    ]
  },
  {
    name: 'Chetan Healthcare', hqCity: 'Vijayawada', hqState: 'Andhra Pradesh', lat: 16.5062, lng: 80.6480,
    locations: [
      // Sheet spells this "Rajamahadevapuram" — the city's newer official name.
      { name: 'Rajamahadevapuram', lat: 17.0005, lng: 81.8040 },
      { name: 'Kakinada', lat: 16.9891, lng: 82.2475 },
      { name: 'Vizag', lat: 17.6868, lng: 83.2185 },
      { name: 'Ongole', lat: 15.5057, lng: 80.0499 },
      { name: 'Nellore', lat: 14.4426, lng: 79.9865 },
      { name: 'Tirupati', lat: 13.6288, lng: 79.4192 },
      { name: 'Khammam', lat: 17.2473, lng: 80.1514 },
      { name: 'Guntur', lat: 16.3067, lng: 80.4365 }
    ]
  },
  {
    name: 'Horizon Technoworld', hqCity: 'Chhatrapati Sambhajinagar', hqState: 'Maharashtra', lat: 19.8762, lng: 75.3433,
    locations: [
      { name: 'Jalna', lat: 19.8410, lng: 75.8864 }
    ]
  },
  {
    name: 'Hospilab Solution', hqCity: 'Varanasi', hqState: 'Uttar Pradesh', lat: 25.3176, lng: 82.9739,
    locations: [
      { name: 'Jaunpur', lat: 25.7539, lng: 82.6825 },
      { name: 'Prayagraj', lat: 25.4358, lng: 81.8463 },
      { name: 'Azamgarh', lat: 26.0685, lng: 83.1836 },
      { name: 'Ghazipur', lat: 25.5859, lng: 83.5772 },
      { name: 'Ballia', lat: 25.7593, lng: 84.1499 },
      { name: 'Sultanpur', lat: 26.2647, lng: 82.0721 }
    ]
  },
  {
    name: 'Shree Sai Healthcare', hqCity: 'Erode', hqState: 'Tamil Nadu', lat: 11.3410, lng: 77.7172,
    locations: [
      { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
      { name: 'Salem', lat: 11.6643, lng: 78.1460 },
      { name: 'Thanjavur', lat: 10.7870, lng: 79.1378 },
      { name: 'Dindigul', lat: 10.3673, lng: 77.9803 },
      { name: 'Karur', lat: 10.9601, lng: 78.0766 },
      { name: 'Ooty', lat: 11.4064, lng: 76.6932 },
      { name: 'Palakkad', lat: 10.7867, lng: 76.6548 },
      { name: 'Thrissur', lat: 10.5276, lng: 76.2144 }
    ]
  },
  {
    // Sheet's HQ column reads "Indore & Bhopal" (two cities) — hqCity is set
    // to Indore (listed first); Bhopal is separately one of the 3 covered
    // locations below, so it is still represented on the map either way.
    name: 'Hayana Enterprises', hqCity: 'Indore', hqState: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577,
    locations: [
      { name: 'Dewas', lat: 22.9676, lng: 76.0534 },
      { name: 'Bhopal', lat: 23.2599, lng: 77.4126 },
      { name: 'Ujjain', lat: 23.1765, lng: 75.7885 }
    ]
  },
  {
    name: 'S S Medical System', hqCity: 'Gorakhpur', hqState: 'Uttar Pradesh', lat: 26.7606, lng: 83.3732,
    locations: [
      { name: 'Basti', lat: 26.8148, lng: 82.7274 },
      { name: 'Deoria', lat: 26.5024, lng: 83.7791 },
      // LOW CONFIDENCE (spec §4/§10): a small tehsil town in Gorakhpur
      // district; placed approximately near Gorakhpur. Revisit if a more
      // precise location is confirmed.
      { name: 'Campierganj', lat: 26.9333, lng: 83.4667 }
    ]
  },
  {
    name: 'Spandan Medi solutions', hqCity: 'Agra', hqState: 'Uttar Pradesh', lat: 27.1767, lng: 78.0081,
    locations: [
      { name: 'Mathura', lat: 27.4924, lng: 77.6737 },
      { name: 'Hathras', lat: 27.5959, lng: 78.0522 },
      { name: 'Aligarh', lat: 27.8974, lng: 78.0880 },
      { name: 'Bharatpur', lat: 27.2173, lng: 77.4901 }
    ]
  },
  {
    name: 'Techmed Solutions', hqCity: 'Ghaziabad', hqState: 'Uttar Pradesh', lat: 28.6692, lng: 77.4538,
    locations: [
      { name: 'New Delhi', lat: 28.6139, lng: 77.2090 },
      { name: 'Gurugram', lat: 28.4595, lng: 77.0266 },
      { name: 'Greater Noida', lat: 28.4744, lng: 77.5040 },
      { name: 'Noida', lat: 28.5355, lng: 77.3910 },
      { name: 'Modinagar', lat: 28.8324, lng: 77.5768 },
      { name: 'Hapur', lat: 28.7300, lng: 77.7800 }
    ]
  },
  {
    name: 'AM Agencies', hqCity: 'Bengaluru', hqState: 'Karnataka', lat: 12.9716, lng: 77.5946,
    locations: [
      { name: 'Hosur', lat: 12.7409, lng: 77.8253 }
    ]
  },
  {
    name: 'Pioneer Medical Devices', hqCity: 'Jaipur', hqState: 'Rajasthan', lat: 26.9124, lng: 75.7873,
    locations: [
      { name: 'Kota', lat: 25.2138, lng: 75.8648 },
      { name: 'Sikar', lat: 27.6094, lng: 75.1399 },
      { name: 'Alwar', lat: 27.5530, lng: 76.6346 }
    ]
  }
];

/**
 * Builds the map's CP layer. Pure — no BigQuery, no Apps Script services — so
 * it is unit-testable against fixture rows, mirroring buildFseLayer_'s shape
 * but without any ticket-coverage computation.
 *
 * @param {Array<Object>} roster CP_ROSTER (or a test fixture of the same shape).
 * @param {function(Object): ?Array<number>} hqCoordFn resolves a roster entry
 *   to its HQ [lat, lng], or null when unresolvable. Injected (rather than
 *   reading entry.lat/entry.lng directly) so a future switch to geo-store
 *   resolution doesn't change this function's shape.
 * @param {function(Object, Object): ?Array<number>} locationCoordFn resolves
 *   one covered-location entry to [lat, lng], or null when unresolvable.
 * @return {{dealers:Array<Object>, unlocatedRoster:Array<string>,
 *           unlocatedLocations:Array<{cp:string, location:string}>}}
 */
function buildCpLayer_(roster, hqCoordFn, locationCoordFn) {
  var dealers = [], unlocatedRoster = [], unlocatedLocations = [];

  (roster || []).forEach(function (entry) {
    var hq = hqCoordFn(entry);
    if (!hq) { unlocatedRoster.push(entry.name); return; }

    var locations = [];
    (entry.locations || []).forEach(function (loc) {
      var coord = locationCoordFn(entry, loc);
      if (!coord) { unlocatedLocations.push({ cp: entry.name, location: loc.name }); return; }
      locations.push({ name: loc.name, lat: coord[0], lng: coord[1] });
    });

    dealers.push({
      name: entry.name,
      hq: [entry.hqCity, entry.hqState].filter(Boolean).join(', '),
      lat: hq[0], lng: hq[1],
      locations: locations
    });
  });

  // Sorted so the payload (and therefore the drawn layer) is stable between
  // refreshes instead of following object key order — same rationale as
  // buildFseLayer_'s engineers.sort().
  dealers.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

  return { dealers: dealers, unlocatedRoster: unlocatedRoster, unlocatedLocations: unlocatedLocations };
}
