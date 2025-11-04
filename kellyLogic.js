/************************************************************
 * kellyLogic.js
 * Simplified Kelly calculation using only back/fair odds.
 ************************************************************/

function calculateKellyStake({ bankroll, impliedOdds, fairOdds }) { // Removed expectedValue and fractionType
  if (!bankroll || bankroll <= 0 || !impliedOdds || impliedOdds <= 1 || !fairOdds || fairOdds <= 1) {
       console.log("[KellyLogic] Invalid input for calculation:", { bankroll, impliedOdds, fairOdds });
       return 0; // Return 0 if any input is invalid
  }

  // Calculate Expected Value directly
  const expectedValue = (impliedOdds / fairOdds) - 1;
  console.log(`[KellyLogic] Calculated EV: ${expectedValue.toFixed(4)} from Back=${impliedOdds}, Fair=${fairOdds}`);


  // If EV is not positive, stake is 0
  if (expectedValue <= 0) {
      console.log("[KellyLogic] EV is zero or negative. Stake = 0.");
      return 0;
  }

  // Calculate raw Kelly stake (f* = EV / (Odds - 1))
  // Using impliedOdds (back odds) for the denominator (Odds - 1) part of the formula: b-1
  const denominator = impliedOdds - 1;
  if (denominator <= 0) {
      console.log("[KellyLogic] Invalid denominator (impliedOdds - 1 <= 0). Stake = 0.");
      return 0; // Avoid division by zero or negative denominator
  }

  const rawKellyFraction = expectedValue / denominator;
  const rawKellyStake = bankroll * rawKellyFraction;
  console.log(`[KellyLogic] Raw Kelly Fraction: ${rawKellyFraction.toFixed(4)}, Raw Stake: £${rawKellyStake.toFixed(2)}`);


  // Apply a fixed 1/4 fraction
  const fraction = 1 / 4;
  let stake = rawKellyStake * fraction;
  console.log(`[KellyLogic] Applied 1/4 Fraction Stake: £${stake.toFixed(2)}`);


  // Cap at 1% of bankroll
  const cap = bankroll * 0.01;
  if (stake > cap) {
    console.log(`[KellyLogic] Stake £${stake.toFixed(2)} exceeds cap £${cap.toFixed(2)}. Setting stake to cap.`);
    stake = cap;
  }

  // Round to nearest 50p
  stake = Math.round(stake * 2) / 2;
  console.log(`[KellyLogic] Stake after rounding to 50p: £${stake.toFixed(2)}`);


  // Ensure minimum stake of 0.50 if it was positive before rounding
  if (stake > 0 && stake < 0.5) {
    console.log(`[KellyLogic] Stake was > 0 but < 0.50. Setting to £0.50.`);
    stake = 0.5;
  }
  // Final check for negative stake just in case (shouldn't happen with EV check)
  if (stake < 0) {
    console.log(`[KellyLogic] Stake was negative. Setting to £0.`);
    stake = 0;
  }

  console.log(`[KellyLogic] Final Recommended Stake: £${stake.toFixed(2)}`);
  return stake;
}

module.exports = { calculateKellyStake };