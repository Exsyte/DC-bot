// kellyUtils.js (with async file ops and improved error handling)
const fs = require('fs').promises; // Use async promises version
const path = require('path');

const COMMON_SPORTS = [ /* ... keep your list ... */
    'Football', 'Basketball', 'NFL', 'NBA', 'Horse Racing', 'Tennis', 'Darts',
    'Golf', 'Cricket', 'Boxing', 'MMA', 'F1', 'NHL', 'Politics', 'Rugby',
    'Snooker', 'Super-Sub', 'Mixed Sports'
];

const BOOKMAKER_ALIAS_FILE_PATH = path.join(__dirname, 'bookmaker_aliases.json');
const SPORT_ALIAS_FILE_PATH = path.join(__dirname, 'sport_aliases.json');
const DEFAULT_ALIASES = {}; // Default is empty object

// --- Async Alias Loading ---
async function loadAliases(filePath, aliasType = 'unknown') {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        try {
            const jsonData = JSON.parse(data);
            // Basic validation: ensure it's an object
            if (typeof jsonData === 'object' && jsonData !== null && !Array.isArray(jsonData)) {
                return jsonData;
            } else {
                console.warn(`[Utils] Invalid data type in ${aliasType} alias file (${filePath}). Expected object. Using default.`);
                // Optionally backup corrupted file
                return { ...DEFAULT_ALIASES };
            }
        } catch (parseError) {
            console.error(`[Utils] Error parsing JSON from ${aliasType} alias file (${filePath}):`, parseError);
            // Optionally backup corrupted file
            return { ...DEFAULT_ALIASES };
        }
    } catch (readError) {
        if (readError.code === 'ENOENT') {
            console.log(`[Utils] ${aliasType} alias file (${filePath}) not found. Creating with defaults.`);
            try {
                // Use saveAliases to create the file
                await saveAliases(filePath, { ...DEFAULT_ALIASES }, aliasType);
                return { ...DEFAULT_ALIASES };
            } catch (createError) {
                console.error(`[Utils] CRITICAL: Failed to create ${aliasType} alias file (${filePath}):`, createError);
                return { ...DEFAULT_ALIASES }; // Return default in-memory
            }
        } else {
            console.error(`[Utils] Error reading ${aliasType} alias file (${filePath}):`, readError);
            // Re-throw other read errors so the calling function (startup) knows something went wrong
            throw new Error(`Failed to read ${aliasType} aliases: ${readError.message}`);
        }
    }
}

// --- Async Alias Saving ---
async function saveAliases(filePath, aliasData, aliasType = 'unknown') {
    if (typeof aliasData !== 'object' || aliasData === null || Array.isArray(aliasData)) {
        const errorMsg = `[Utils] Attempted to save invalid data type to ${aliasType} alias file (${filePath}). Must be an object. Save aborted.`;
        console.error(errorMsg);
        throw new Error(`Invalid data type for saving ${aliasType} aliases.`);
    }
    try {
        const dataString = JSON.stringify(aliasData, null, 2);
        await fs.writeFile(filePath, dataString, 'utf8');
        console.log(`[Utils] Successfully saved ${aliasType} aliases to ${filePath}.`);
    } catch (writeError) {
        console.error(`[Utils] CRITICAL: Error writing ${aliasType} aliases to ${filePath}:`, writeError);
        throw new Error(`Failed to save ${aliasType} aliases: ${writeError.message}`);
    }
}

// --- Specific Load/Save Functions using the generic ones ---
async function loadBookmakerAliases() { return loadAliases(BOOKMAKER_ALIAS_FILE_PATH, 'bookmaker'); }
async function saveBookmakerAliases(a) { return saveAliases(BOOKMAKER_ALIAS_FILE_PATH, a, 'bookmaker'); }
async function loadSportAliases() { return loadAliases(SPORT_ALIAS_FILE_PATH, 'sport'); }
async function saveSportAliases(a) { return saveAliases(SPORT_ALIAS_FILE_PATH, a, 'sport'); }

// --- checkAlias / resolveAlias (Keep as is) ---
function checkAlias(key, aliasMap, commonNamesList = []) {
    if (!key || !aliasMap) return false; const upperKey = key.toUpperCase(); const lowerKey = key.toLowerCase();
    if (aliasMap.hasOwnProperty(upperKey) || aliasMap.hasOwnProperty(key)) return true;
    if (commonNamesList.some(commonName => commonName.toLowerCase() === lowerKey)) return true; return false;
}
function resolveAlias(key, aliasMap, commonNamesList = []) {
    if (!key || !aliasMap) return key; const upperKey = key.toUpperCase(); if (aliasMap.hasOwnProperty(upperKey)) return aliasMap[upperKey]; if (aliasMap.hasOwnProperty(key)) return aliasMap[key];
    const lowerKey = key.toLowerCase(); const commonMatch = commonNamesList.find(commonName => commonName.toLowerCase() === lowerKey); if (commonMatch) return commonMatch; return key;
}


// --- parseBetString (Keep as is - primarily string focused) ---
// It already focuses on Bookie - Sport - Name - BackOdds / FairOdds structure
// and doesn't rely on the removed fields. Ensure robust error messages remain.
function parseBetString(betString, bookmakerAliases, sportAliases, commonBookmakers = [], commonSports = []) {
    console.log(`\n--- [PARSE_DEBUG] Starting parseBetString (Revised Logic v6) ---`);
    console.log(`[PARSE_DEBUG] Input String: "${betString}"`);
    if (!betString || typeof betString !== 'string') throw new Error("Input string empty/invalid.");
    betString = betString.trim(); let backOdds = NaN; let fairOdds = NaN; let nameParts = []; let nameSegment = "";
    const finalOddsRegex = /(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)(?:\s+[a-zA-Z]*)?$/;
    const oddsMatch = betString.match(finalOddsRegex);
    if (oddsMatch) {
        const potentialBackOdds = parseFloat(oddsMatch[1]); const potentialFairOdds = parseFloat(oddsMatch[2]); const fullMatchedString = oddsMatch[0];
        if (!isNaN(potentialBackOdds) && !isNaN(potentialFairOdds) && potentialBackOdds > 1 && potentialFairOdds > 1) {
            backOdds = potentialBackOdds; fairOdds = potentialFairOdds; const oddsMatchStartIndex = betString.lastIndexOf(fullMatchedString);
            if (oddsMatchStartIndex > 0) {
                 nameSegment = betString.substring(0, oddsMatchStartIndex).trim(); console.log(`[PARSE_DEBUG] Raw Name Segment: "${nameSegment}"`); nameSegment = nameSegment.replace(/\u00A0/g, ' ');
                 nameSegment = nameSegment.replace(/\s*-\s*/g, ' - '); // Normalize spacing around hyphens
                 nameParts = nameSegment.split(/\s+-\s+/); console.log(`[PARSE_DEBUG] Name parts after split:`, nameParts);
                 if (nameParts.length < 3 && !nameSegment.includes(' - ')) { // Handle case where segment itself is short and has no separators
                    throw new Error(`Invalid format before odds in "${nameSegment}". Need 'Bookmaker - Sport - Name' structure.`);
                 }
            } else throw new Error("Odds pattern matched at start of string.");
        } else throw new Error(`Invalid odds values at end: Back='${oddsMatch[1]}', Fair='${oddsMatch[2]}' (Must be > 1)`);
    } else throw new Error("Could not find odds pattern (e.g., '10 / 9.4') precisely at the end.");
    console.log("[PARSE_DEBUG] Parts for Bookie/Sport/Name check:", nameParts);
    if (nameParts.length < 3) throw new Error(`Invalid format before odds. Need 'Bookie - Sport - Name'. Found ${nameParts.length} parts in "${nameSegment}".`);
    bookmakerAliases = (bookmakerAliases && typeof bookmakerAliases === 'object') ? bookmakerAliases : {}; sportAliases = (sportAliases && typeof sportAliases === 'object') ? sportAliases : {};
    let finalBookmaker = null, finalSport = null, finalBetName = null; let bookmakerPart = null, sportPart = null; let nameStartIndexInSegment = -1;
    const check0_bookie = checkAlias(nameParts[0], bookmakerAliases, commonBookmakers); const check1_sport = checkAlias(nameParts[1], sportAliases, commonSports);
    if (check0_bookie && check1_sport) {
        bookmakerPart = nameParts[0]; sportPart = nameParts[1]; const sportEndIndex = nameSegment.indexOf(sportPart) + sportPart.length; nameStartIndexInSegment = nameSegment.indexOf(' - ', sportEndIndex); if (nameStartIndexInSegment !== -1) nameStartIndexInSegment += 3; else throw new Error("Found Bookie/Sport, but no ' - ' separator before bet name.");
    } else if (nameParts.length >= 4) {
        const check1_bookie = checkAlias(nameParts[1], bookmakerAliases, commonBookmakers); const check2_sport = checkAlias(nameParts[2], sportAliases, commonSports);
        if (check1_bookie && check2_sport) {
             bookmakerPart = nameParts[1]; sportPart = nameParts[2]; const sportEndIndex = nameSegment.indexOf(sportPart, nameSegment.indexOf(bookmakerPart)) + sportPart.length; nameStartIndexInSegment = nameSegment.indexOf(' - ', sportEndIndex); if (nameStartIndexInSegment !== -1) nameStartIndexInSegment += 3; else throw new Error("Found Bookie/Sport (after prefix), but no ' - ' separator before bet name.");
        }
    }
    if (bookmakerPart && sportPart && nameStartIndexInSegment !== -1) {
        finalBookmaker = resolveAlias(bookmakerPart, bookmakerAliases, commonBookmakers); finalSport = resolveAlias(sportPart, sportAliases, commonSports); finalBetName = nameSegment.substring(nameStartIndexInSegment).trim();
    } else throw new Error(`Could not identify 'Bookmaker - Sport - Name' structure within "${nameSegment}". Check separators and spelling.`);
    if (!finalBookmaker || !finalSport || !finalBetName) throw new Error("Failed to extract all required components after resolution.");
    const resultObject = { bookmaker: finalBookmaker, sport: finalSport, betName: finalBetName, backOdds, fairOdds };
    console.log("[PARSE_DEBUG] Successfully parsed:", resultObject); console.log(`--- [PARSE_DEBUG] Ending parseBetString ---`); return resultObject;
}


module.exports = {
    parseBetString,
    loadBookmakerAliases, saveBookmakerAliases,
    loadSportAliases, saveSportAliases
};