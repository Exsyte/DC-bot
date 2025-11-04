// kellyBankrollManager.js (with improved error handling)
const fs = require('fs'); // Using sync fs here, consider async if performance becomes an issue
const path = require('path');

const BANKROLL_FILE = path.join(__dirname, 'kellyBankroll.json');
const DEFAULT_BANKROLL = { bankroll: 3000 }; // Define default

/**
 * Reads the current bankroll data from the JSON file.
 * Includes error handling for file not found, read errors, and JSON parsing errors.
 */
function getBankrollData() {
  try {
    const data = fs.readFileSync(BANKROLL_FILE, 'utf8');
    try {
        const jsonData = JSON.parse(data);
        // Validate structure - ensure it has a bankroll property that's a number
        if (jsonData && typeof jsonData.bankroll === 'number') {
            return jsonData;
        } else {
            console.warn(`[BankrollManager] Invalid data structure in ${BANKROLL_FILE}. Using default.`);
            // Optionally backup corrupted file here
            return { ...DEFAULT_BANKROLL }; // Return a copy of the default
        }
    } catch (parseError) {
        console.error(`[BankrollManager] Error parsing JSON from ${BANKROLL_FILE}:`, parseError);
        // Optionally backup corrupted file here
        return { ...DEFAULT_BANKROLL }; // Return default if parsing fails
    }
  } catch (readError) {
    if (readError.code === 'ENOENT') {
      // File doesn't exist, create it with default
      console.log(`[BankrollManager] ${BANKROLL_FILE} not found. Creating with default bankroll.`);
      try {
          // Use saveBankrollData to create the file, ensuring consistent saving logic
          saveBankrollData({ ...DEFAULT_BANKROLL });
          return { ...DEFAULT_BANKROLL };
      } catch (createError) {
          // If even creation fails, log critical error and return default in-memory
          console.error(`[BankrollManager] CRITICAL: Failed to create ${BANKROLL_FILE}:`, createError);
          return { ...DEFAULT_BANKROLL };
      }
    } else {
      // Other read errors
      console.error(`[BankrollManager] Error reading ${BANKROLL_FILE}:`, readError);
      // Fallback to default if reading fails for other reasons
      return { ...DEFAULT_BANKROLL };
    }
  }
}

/**
 * Saves updated bankroll data to the JSON file.
 * Includes type checking and error handling for write errors.
 */
function saveBankrollData(data) {
  // Ensure the bankroll value is a valid number before saving
  if (!data || typeof data.bankroll !== 'number' || isNaN(data.bankroll)) {
       const errorMsg = `[BankrollManager] Attempted to save invalid bankroll data: ${JSON.stringify(data)}. Save aborted.`;
       console.error(errorMsg);
       // Throwing an error here will propagate it back to the caller (e.g., deductStake/addWinnings)
       // which should then handle it (e.g., inform the user the operation failed).
       throw new Error("Invalid bankroll data format during save.");
  }

  try {
    // Convert valid data to JSON string
    const dataString = JSON.stringify(data, null, 2);
    // Write synchronously
    fs.writeFileSync(BANKROLL_FILE, dataString, 'utf8');
    console.log(`[BankrollManager] Successfully saved bankroll data to ${BANKROLL_FILE}.`);

  } catch (writeError) {
    console.error(`[BankrollManager] CRITICAL: Error writing to ${BANKROLL_FILE}:`, writeError);
    // Re-throw the error so the calling function knows the save failed
    throw new Error(`Failed to save bankroll data: ${writeError.message}`);
  }
}

/**
 * Returns the current bankroll amount.
 */
function getCurrentBankroll() {
  const data = getBankrollData(); // Already handles read/parse errors
  // The validation is now primarily within getBankrollData
  return data.bankroll;
}

/**
 * Deducts a stake amount from the bankroll.
 * Throws specific errors for invalid input or insufficient funds.
 */
function deductStake(amount) {
  if (amount === null || amount === undefined || isNaN(amount) || amount <= 0) {
    throw new Error(`Invalid stake amount: ${amount}. Must be a positive number.`);
  }

  const data = getBankrollData(); // Get current valid data

  if (data.bankroll < amount) {
    throw new Error(`Insufficient bankroll (£${data.bankroll.toFixed(2)}) to deduct stake (£${amount.toFixed(2)}).`);
  }

  // Perform deduction in memory
  const newData = { ...data, bankroll: data.bankroll - amount };

  // Attempt to save the updated data - this might throw an error if saving fails
  saveBankrollData(newData);

  // Log success only after saving works
  console.log(`[${new Date().toISOString()}] Deducted stake: -£${amount.toFixed(2)}. New bankroll: £${newData.bankroll.toFixed(2)}`);
  return newData.bankroll; // Return the new bankroll amount
}

/**
 * Adds winnings/adjustments to the bankroll.
 * Handles potentially invalid amounts.
 */
function addWinnings(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
       console.warn(`[BankrollManager - addWinnings] Invalid amount provided: ${amount}. Treating as 0.`);
       amount = 0; // Treat invalid amount as 0 adjustment
  }

  const data = getBankrollData(); // Get current valid data

  // Perform addition in memory
  // Ensure bankroll doesn't go below zero due to adjustments if necessary (depends on requirements)
  const newBankrollValue = data.bankroll + amount;
  // if (newBankrollValue < 0) {
  //    console.warn(`[BankrollManager] Bankroll adjustment resulted in negative value (${newBankrollValue}). Clamping to 0.`);
  //    newBankrollValue = 0;
  // }
  const newData = { ...data, bankroll: newBankrollValue };


  // Attempt to save the updated data - this might throw an error
  saveBankrollData(newData);

  // Log success only after saving works
  const action = amount >= 0 ? 'Added' : 'Subtracted';
  const sign = amount >= 0 ? '+' : '';
  console.log(`[${new Date().toISOString()}] ${action} winnings/adjustment: ${sign}£${Math.abs(amount).toFixed(2)}. New bankroll: £${newData.bankroll.toFixed(2)}`);
  return newData.bankroll; // Return the new bankroll amount
}

module.exports = {
  getCurrentBankroll,
  deductStake,
  addWinnings
};