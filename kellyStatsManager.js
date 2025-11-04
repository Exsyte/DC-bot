/************************************************************
 * kellyStatsManager.js
 *
 * Stats logic simplified, removing is2pc filter.
 ************************************************************/
const { getBetsData } = require('./kellyBetManager.js');
const { getCurrentBankroll } = require('./kellyBankrollManager.js');

/**
 * getBasicStats({
 * timeRange: 'today'|'yesterday'|'7days'|'lastmonth'|null,
 * sport: 'Football'|null,
 * bookmaker: 'Bet365'|null,
 * returnFilteredBets: boolean // Added option to return the filtered bets array
 * })
 * - Removed is2pcOnly filter
 */
function getBasicStats({
  timeRange  = null,
  sport      = null,
  bookmaker  = null,
  // is2pcOnly parameter removed
  returnFilteredBets = false // Keep this for detailed view
}) {
  const allBets = getBetsData();
  let filteredBets = [...allBets]; // Start with all bets

  // (1) Filter by sport if provided
  if (sport) {
    filteredBets = filteredBets.filter(bet =>
      bet.sport && bet.sport.toLowerCase() === sport.toLowerCase()
    );
  }

  // (2) Filter by bookmaker if provided
  if (bookmaker) {
    filteredBets = filteredBets.filter(bet =>
      bet.bookmaker && bet.bookmaker.toLowerCase() === bookmaker.toLowerCase()
    );
  }

  // (3) Filter by timeRange if provided
  if (timeRange) {
    const now = new Date();
    let startDate;

    switch (timeRange) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'yesterday':
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = new Date(startOfToday.getTime() - 24*60*60*1000);
        const endOfYesterday = new Date(startOfToday.getTime() - 1);
        // Special handling for yesterday to filter UP TO end of yesterday
        filteredBets = filteredBets.filter(bet => {
             const betTime = new Date(bet.timestamp);
             return betTime >= startDate && betTime <= endOfYesterday;
         });
        startDate = null; // Prevent double filtering below
        break;
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24*60*60*1000);
        break;
      case 'lastmonth': // Assuming 30 days for simplicity
        startDate = new Date(now.getTime() - 30 * 24*60*60*1000);
        break;
      default:
        startDate = null; // No time filter if range is invalid
        break;
    }

    // Apply the date filter if startDate was set (and not handled by 'yesterday')
    if (startDate) {
         filteredBets = filteredBets.filter(bet => {
             const betTime = new Date(bet.timestamp);
             // Filter from startDate up to the current time
             return betTime >= startDate && betTime <= now;
         });
     }
  }

  // (4) Consider only SETTLED bets for P/L and ROI calculation
  const settledBets = filteredBets.filter(bet => bet.status !== 'pending');

  // (5) Compute stats based on settled bets
  const totalSettledBets = settledBets.length; // Use count of settled bets for ROI
  let wins = 0, losses = 0, pushes = 0, partialWins = 0;
  let totalStake = 0; // Sum of stakes for settled bets
  let totalProfitLoss = 0; // P/L based on settled bets

  settledBets.forEach(bet => {
    // Accumulate total stake for ROI calculation
    totalStake += bet.stake;

    // Calculate P/L and count outcomes
    switch (bet.status) {
      case 'win':
        wins++;
        // Ensure profitLoss was calculated and stored during settlement
        totalProfitLoss += (bet.profitLoss ?? ((bet.stake * (bet.backOdds ?? 1)) - bet.stake)); // Use stored or recalculate if missing
        break;
      case 'loss':
        losses++;
        totalProfitLoss += (bet.profitLoss ?? -bet.stake); // Use stored or recalculate
        break;
      case 'push':
        pushes++;
        // P/L is 0 for push
        break;
      case 'partial-win':
        partialWins++;
         // Ensure profitLoss was calculated and stored during settlement
        totalProfitLoss += (bet.profitLoss ?? (bet.partialReturn ? bet.partialReturn - bet.stake : 0)); // Use stored or recalculate if missing
        break;
      // 'pending' bets are already excluded from settledBets
    }
  });

  // ROI = totalProfitLoss / totalStake (based only on settled bets in the filtered period)
  const ROI = totalStake > 0 ? (totalProfitLoss / totalStake) : 0; // Avoid division by zero
  const currentBankroll = getCurrentBankroll();

  const statsResult = {
    totalBets: filteredBets.length, // Total bets matching filters (including pending)
    totalSettledBets: totalSettledBets, // Count of settled bets matching filters
    wins,
    losses,
    pushes,
    partialWins,
    totalProfitLoss, // P/L from settled bets matching filters
    ROI, // ROI based on settled bets matching filters
    currentBankroll
  };

  if (returnFilteredBets) {
    // Return all filtered bets (including pending) if requested for display
    statsResult.filteredBets = filteredBets;
  }

  console.log(`[StatsManager - getBasicStats] Filters:`, { timeRange, sport, bookmaker });
  console.log(`[StatsManager - getBasicStats] Results:`, statsResult);

  return statsResult;
}

module.exports = {
  getBasicStats
};