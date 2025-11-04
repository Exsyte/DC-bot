// kellyBetManager.js (with improved error handling and commission)
const fs = require('fs'); // Using sync fs here
const path = require('path');
// Ensure managers are required correctly
const { getCurrentBankroll, deductStake, addWinnings } = require('./kellyBankrollManager.js');
const { calculateKellyStake } = require('./kellyLogic.js');

const BETS_FILE = path.join(__dirname, 'kellyBets.json');
const DEFAULT_BETS = []; // Default is an empty array

/**
 * Reads bets data from kellyBets.json.
 * Includes error handling for file not found, read errors, JSON parsing, and data type validation.
 */
function getBetsData() {
  try {
    const data = fs.readFileSync(BETS_FILE, 'utf8');
    try {
        const jsonData = JSON.parse(data);
        // Validate that the parsed data is an array
        if (Array.isArray(jsonData)) {
            return jsonData;
        } else {
            console.warn(`[BetManager] Invalid data type in ${BETS_FILE} (expected array). Using default empty array.`);
            // Optionally backup corrupted file
            return [...DEFAULT_BETS]; // Return a copy
        }
    } catch (parseError) {
        console.error(`[BetManager] Error parsing JSON from ${BETS_FILE}:`, parseError);
        // Optionally backup corrupted file
        return [...DEFAULT_BETS]; // Return default if parsing fails
    }
  } catch (readError) {
    if (readError.code === 'ENOENT') {
      // File doesn't exist, create it with default
      console.log(`[BetManager] ${BETS_FILE} not found. Creating with default empty array.`);
      try {
          // Use saveBetsData to create the file
          saveBetsData([...DEFAULT_BETS]);
          return [...DEFAULT_BETS];
      } catch (createError) {
          console.error(`[BetManager] CRITICAL: Failed to create ${BETS_FILE}:`, createError);
          return [...DEFAULT_BETS]; // Return default in-memory
      }
    } else {
      console.error(`[BetManager] Error reading ${BETS_FILE}:`, readError);
      return [...DEFAULT_BETS]; // Return default on other read errors
    }
  }
}

/**
 * Saves the bets array to kellyBets.json.
 * Includes type checking and error handling for write errors.
 */
function saveBetsData(bets) {
  // Ensure we are saving a valid array
  if (!Array.isArray(bets)) {
      const errorMsg = `[BetManager] Attempted to save non-array data to ${BETS_FILE}. Save aborted. Data: ${JSON.stringify(bets)}`;
      console.error(errorMsg);
      throw new Error("Invalid data type: Can only save an array of bets.");
  }

  try {
    const dataString = JSON.stringify(bets, null, 2);
    fs.writeFileSync(BETS_FILE, dataString, 'utf8');
    // console.log(`[BetManager] Successfully saved bets data to ${BETS_FILE}.`); // Less verbose logging
  } catch (writeError) {
    console.error(`[BetManager] CRITICAL: Error writing to ${BETS_FILE}:`, writeError);
    throw new Error(`Failed to save bets data: ${writeError.message}`);
  }
}

// --- generateBetId, initNewBet, finalizeNewBet ---
function generateBetId() {
  const bets = getBetsData();
  let newId; let attempts=0;
  do {
    newId = Math.random().toString(36).substring(2, 7).toUpperCase(); attempts++;
    if (attempts > 1000) throw new Error('Failed to generate unique ID.');
  } while (bets.some(b => b.id === newId)); return newId;
}

// UPDATED: Accept commission
function initNewBet(betInput, commission = null) {
  const bankroll = getCurrentBankroll(); let recommendedStake = 0; let calculationError = null;
  if (typeof betInput.backOdds !== 'number' || betInput.backOdds <= 1 || typeof betInput.fairOdds !== 'number' || betInput.fairOdds <= 1) {
      calculationError = `Invalid odds (Back: ${betInput.backOdds}, Fair: ${betInput.fairOdds}). Must be > 1.`;
  } else { try { recommendedStake = calculateKellyStake({ bankroll, impliedOdds: betInput.backOdds, fairOdds: betInput.fairOdds }); } catch (calcError) { calculationError = `Calc error: ${calcError.message}`; recommendedStake = 0; } }
  if (calculationError) betInput.calculationError = calculationError;

  // UPDATED: Store valid commission in the betInput object
  if (commission !== null && typeof commission === 'number' && commission >= 0 && commission <= 100) {
       betInput.commission = commission;
  } else {
       delete betInput.commission; // Ensure no invalid commission is stored
  }

  return { recommendedStake, finalBetInput: betInput };
}

function finalizeNewBet(betInput, finalStake) {
    if (finalStake <= 0) throw new Error("Cannot finalize bet with zero/negative stake.");
    // Wrap deductStake in try...catch in case bankroll saving fails
    try {
        deductStake(finalStake);
    } catch (deductError) {
         console.error(`[BetManager - finalizeNewBet] Failed to deduct stake for bet '${betInput.betName}':`, deductError);
         // Re-throw or handle - stopping bet creation if deduction fails is probably safest
         throw new Error(`Failed to deduct stake, bet not created: ${deductError.message}`);
    }
    // UPDATED: Include commission in newBet object if present
    const newBet = {
        id: generateBetId(),
        bookmaker: betInput.bookmaker,
        sport: betInput.sport,
        betName: betInput.betName,
        backOdds: betInput.backOdds,
        fairOdds: betInput.fairOdds,
        stake: finalStake,
        status: 'pending',
        timestamp: new Date().toISOString(),
        // Add commission if it exists in betInput
        ...(betInput.commission !== undefined && { commission: betInput.commission })
    };

    const bets = getBetsData();
    bets.push(newBet);
    // Wrap saveBetsData in try...catch
    try {
        saveBetsData(bets);
        console.log(`[BetManager - finalizeNewBet] Bet ${newBet.id} created and saved.`);
        return newBet;
    } catch (saveError) {
        console.error(`[BetManager - finalizeNewBet] Failed to save bet ${newBet.id} after deducting stake:`, saveError);
        // CRITICAL: Stake was deducted but bet not saved! Manual intervention might be needed.
        // Try to revert the stake deduction
        try {
            addWinnings(finalStake); // Add the deducted stake back
            console.warn(`[BetManager - finalizeNewBet] Attempted to revert stake deduction for bet ${newBet.id} due to save failure.`);
        } catch (revertError) {
            console.error(`[BetManager - finalizeNewBet] CRITICAL ERROR: Failed to revert stake deduction after bet save failure for ${newBet.id}. Bankroll incorrect!`, revertError);
        }
        throw new Error(`Failed to save the new bet after deducting stake: ${saveError.message}`);
    }
}


/** listPendingBets */
function listPendingBets() {
  const pending = getBetsData().filter(b => b.status === 'pending');
  pending.sort((a, b) => (a.bookmaker || '').localeCompare(b.bookmaker || ''));
  // UPDATED: Include commission in returned data (formatting happens in kellyIndex.js)
  return pending;
}

/** editBet */
// UPDATED: Allow editing 'commission'
function editBet(betId, updates) {
  const bets = getBetsData();
  const idx = bets.findIndex(b => b.id === betId);
  if (idx === -1) throw new Error(`Bet ID '${betId}' not found.`);
  const currentBet = bets[idx]; // Get the bet object
  if (currentBet.status !== 'pending') throw new Error(`Bet '${betId}' is already settled.`);

  const allowedFields = ['bookmaker', 'sport', 'betname', 'backodds', 'fairodds', 'stake', 'commission']; // Add 'commission'
  const updateKeys = Object.keys(updates);
  let changesMade = false;

  // Prepare the data structure for the potentially updated bet
  const updatedBetData = { ...currentBet }; // Start with a copy

  for (const key of updateKeys) {
      const lowerKey = key.toLowerCase();
      if (!allowedFields.includes(lowerKey)) throw new Error(`Invalid field specified: '${key}'.`);

      let processedValue = updates[key]; // Value from the updates object

      if (['backodds', 'fairodds', 'stake', 'commission'].includes(lowerKey)) { // Add 'commission'
           // Handle null/empty value for commission to remove it
           if (lowerKey === 'commission' && (processedValue === null || processedValue === '' || processedValue === undefined)) {
               processedValue = null; // Sentinel value to indicate removal
           } else {
               const numVal = parseFloat(processedValue);
               if (isNaN(numVal)) throw new Error(`Invalid numeric value ('${processedValue}') for field '${key}'.`);
               // Add validation for commission range
               if (lowerKey === 'commission' && (numVal < 0 || numVal > 100)) throw new Error(`Commission must be between 0 and 100.`);
               if ((lowerKey === 'backodds' || lowerKey === 'fairodds') && numVal <= 1) console.warn(`Editing ${lowerKey} for ${betId} to ${numVal} (<= 1).`);
               if (lowerKey === 'stake' && numVal <= 0) throw new Error("Stake must be positive.");
               processedValue = numVal; // Use the processed numeric value
           }
       }

      // Map 'betname' input field to 'betName' object key if necessary
      const fieldKey = lowerKey === 'betname' ? 'betName' : lowerKey;

      // Assign the processed value to the correct key in updatedBetData
       if (processedValue === null && lowerKey === 'commission') { // Handle removal
           if (updatedBetData.hasOwnProperty(fieldKey)) {
               delete updatedBetData[fieldKey];
               changesMade = true;
               console.log(`[BetManager - editBet] Removed commission field for bet ${betId}.`);
           }
       } else if (updatedBetData[fieldKey] !== processedValue) {
           updatedBetData[fieldKey] = processedValue;
           changesMade = true;
       }
  }

  if (!changesMade) {
       console.log(`[BetManager - editBet] No changes detected for bet ${betId}. Save skipped.`);
       return currentBet; // Return the original if no changes
  }


  bets[idx] = updatedBetData; // Update the array

  // Wrap saveBetsData in try...catch
  try {
    saveBetsData(bets);
    console.log(`[BetManager - editBet] Bet ${betId} updated and saved.`);
    return bets[idx]; // Return the updated bet object from the array
  } catch (saveError) {
       console.error(`[BetManager - editBet] Failed to save updates for bet ${betId}:`, saveError);
       // Depending on requirements, could try to revert in-memory change, but safer to throw
       throw new Error(`Failed to save bet updates: ${saveError.message}`);
  }
}


/** settleBet */
// UPDATED: Implement commission calculation
function settleBet(betId, result, userReturn) {
  const bets = getBetsData();
  const idx = bets.findIndex(b => b.id === betId);
  if (idx === -1) throw new Error(`Bet ID '${betId}' not found.`);

  const bet = bets[idx];
  if (bet.status !== 'pending') throw new Error(`Bet '${betId}' is already settled.`);

  if ((result === 'win' || result === 'part-win') && (typeof bet.backOdds !== 'number' || bet.backOdds <= 1) && result !== 'part-win') { // Allow part-win without odds check initially
       throw new Error(`Cannot settle bet ${betId} as '${result}' - Back Odds missing/invalid.`);
   }

   // Store original status and try bankroll adjustment first
   const originalBetData = { ...bet }; // Copy before modification
   let bankrollAdjustment = 0;
   let newStatus = bet.status;
   let profitLoss = bet.profitLoss; // Keep existing if available (shouldn't be for pending)
   let partialReturn = bet.partialReturn; // Keep existing
   const commissionRate = (bet.commission !== undefined && bet.commission > 0) ? bet.commission / 100 : 0; // Commission rate (e.g., 0.05 for 5%)


   try {
        switch (result) {
            case 'win':
                 if (typeof bet.backOdds !== 'number' || bet.backOdds <= 1) throw new Error("Back Odds invalid for 'win' settlement.");
                 const grossWinnings = bet.stake * (bet.backOdds - 1); // Winnings before commission
                 const commissionAmountWin = grossWinnings > 0 ? grossWinnings * commissionRate : 0; // Calculate commission only on positive profit
                 const netWinnings = grossWinnings - commissionAmountWin;
                 bankrollAdjustment = bet.stake + netWinnings; // Return stake + net winnings
                 newStatus = 'win';
                 profitLoss = netWinnings; // Profit is net winnings
                 break;
            case 'loss':
                bankrollAdjustment = 0;
                newStatus = 'loss';
                profitLoss = -bet.stake; // No bankroll change, P/L is -stake
                break;
            case 'push':
                bankrollAdjustment = bet.stake; // Return stake
                newStatus = 'push';
                profitLoss = 0;
                break;
            case 'part-win':
                if (typeof userReturn !== 'number' || userReturn < 0) throw new Error('Invalid "userReturn" for partial-win.');
                const partWinProfit = userReturn - bet.stake; // Profit before commission
                const partWinCommission = partWinProfit > 0 ? partWinProfit * commissionRate : 0; // Commission on profit
                const partWinNetProfit = partWinProfit - partWinCommission;
                bankrollAdjustment = userReturn - partWinCommission; // Total returned minus commission paid
                newStatus = 'partial-win';
                partialReturn = bankrollAdjustment; // Store the actual amount returned after commission
                profitLoss = partWinNetProfit; // Store the net profit
                break;
            default: throw new Error(`Unknown result type '${result}'`);
        }

        // Perform bankroll update (this might throw an error if saving bankroll fails)
        if (bankrollAdjustment !== 0) {
             // AddWinnings handles positive/negative correctly
             addWinnings(bankrollAdjustment);
        } else if (result === 'loss'){
            // Special case: Loss doesn't adjust bankroll via addWinnings, but it's a valid settlement
            console.log(`[BankrollManager] No bankroll adjustment for loss settlement of bet ${betId}.`);
        }


        // If bankroll update succeeds, update bet status in memory
        bet.status = newStatus;
        bet.profitLoss = profitLoss; // Store the calculated net profit/loss
        if (partialReturn !== undefined) bet.partialReturn = partialReturn; // Store actual return for part-win

        // Attempt to save the updated bet list
        bets[idx] = bet;
        saveBetsData(bets); // This might throw if saving bets fails

        console.log(`[BetManager - settleBet] Bet ${betId} settled as ${result}. P/L: ${profitLoss.toFixed(2)}${commissionRate > 0 ? ` (Comm: ${bet.commission}%)` : ''}. Bankroll updated.`);
        return bet;

   } catch (error) {
        console.error(`[BetManager - settleBet] Error during settlement for bet ${betId}:`, error);
        // Attempt to revert bankroll change if it was made and the error occurred afterwards (e.g., during bets save)
        // Check if an adjustment was *supposed* to be made (covers loss case where adjustment is 0)
        if (bankrollAdjustment !== 0) {
            console.warn(`[BetManager - settleBet] Attempting to revert bankroll adjustment for ${betId} due to error.`);
            try {
                addWinnings(-bankrollAdjustment); // Subtract what was added (or add if it was negative)
                console.log(`[BetManager - settleBet] Bankroll adjustment reverted for ${betId}.`);
            } catch (revertError) {
                console.error(`[BetManager - settleBet] CRITICAL ERROR: Failed to revert bankroll adjustment for ${betId}. Bankroll may be incorrect!`, revertError);
            }
        }
        // Re-throw the original error to inform the caller
        throw new Error(`Settlement failed for bet ${betId}: ${error.message}`);
   }
}


/** unsettleBet */
// UPDATED: Refined bankroll adjustment calculation
function unsettleBet(betId) {
    const bets = getBetsData();
    const idx = bets.findIndex(b => b.id === betId);
    if (idx === -1) throw new Error(`Bet ID '${betId}' not found.`);

    const bet = { ...bets[idx] }; // Work with a copy initially
    const originalStatus = bet.status;

    if (originalStatus === 'pending') throw new Error(`Bet '${betId}' is already pending.`);

    let bankrollAdjustment = 0; // The amount to subtract/add back

    // Determine the bankroll adjustment needed based on original status
    switch (originalStatus) {
        case 'win':
            // Bankroll was increased by (stake + netWinnings) during settlement. Subtract this amount.
            // Use stored profitLoss if available (it's the netWinnings), otherwise recalculate.
            const netWinnings = bet.profitLoss ?? (() => {
                 const gross = bet.stake * (bet.backOdds - 1);
                 const rate = (bet.commission !== undefined && bet.commission > 0) ? bet.commission / 100 : 0;
                 const comm = gross > 0 ? gross * rate : 0;
                 return gross - comm;
            })(); // Recalculate if needed
            bankrollAdjustment = -(bet.stake + netWinnings);
            break;
        case 'loss':
            bankrollAdjustment = 0; // No change was made on settlement
            break;
        case 'push':
            bankrollAdjustment = -bet.stake; // Subtract the stake that was returned
            break;
        case 'partial-win':
            // Bankroll was increased by the 'partialReturn' value stored during settlement (which is post-commission)
            if (bet.partialReturn != null && typeof bet.partialReturn === 'number') {
                bankrollAdjustment = -bet.partialReturn; // Subtract the actual amount returned
            } else {
                 // Less accurate fallback if partialReturn wasn't stored correctly
                 console.warn(`[BetManager - unsettleBet] Cannot accurately revert 'partial-win' for ${betId} (missing partialReturn). Reverting stake only.`);
                 bankrollAdjustment = -bet.stake;
            }
            break;
        default:
            throw new Error(`Cannot unsettle bet with unrecognized prior status: ${originalStatus}`);
    }

    try {
        // Perform bankroll adjustment first
        if (bankrollAdjustment !== 0) {
            addWinnings(bankrollAdjustment); // This handles +/- correctly and might throw on save failure
        } else if (originalStatus === 'loss'){
             console.log(`[BankrollManager] No bankroll adjustment needed for unsettling loss bet ${betId}.`);
        }

        // If bankroll adjustment successful, update bet status in memory
        bet.status = 'pending';
        delete bet.profitLoss;
        delete bet.partialReturn;
        // Remove old fields if they exist (optional cleanup)
        delete bet.is2pc; delete bet.evPercent; delete bet.combinedOdds;

        // Update the array and save
        bets[idx] = bet;
        saveBetsData(bets); // This might throw on save failure

        console.log(`[BetManager - unsettleBet] Bet ${betId} unsettled from ${originalStatus}. Bankroll adjusted.`);
        return bet; // Return the updated bet object

    } catch (error) {
         console.error(`[BetManager - unsettleBet] Error during unsettlement for bet ${betId}:`, error);
         // Attempt to revert the bankroll change if it happened before a subsequent error (like bets save failure)
         if (bankrollAdjustment !== 0) {
              console.warn(`[BetManager - unsettleBet] Attempting to revert bankroll adjustment for ${betId} due to error.`);
              try {
                   addWinnings(-bankrollAdjustment); // Reverse the adjustment
                   console.log(`[BetManager - unsettleBet] Bankroll adjustment reverted for ${betId}.`);
              } catch (revertError) {
                   console.error(`[BetManager - unsettleBet] CRITICAL ERROR: Failed to revert bankroll adjustment for ${betId} during unsettle failure. Bankroll may be incorrect!`, revertError);
              }
         }
         throw new Error(`Unsettlement failed for bet ${betId}: ${error.message}`);
    }
}


// --- Exports ---
module.exports = {
  getBetsData, saveBetsData, initNewBet, finalizeNewBet, listPendingBets, editBet, settleBet, unsettleBet
};