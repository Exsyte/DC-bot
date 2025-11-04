// kellyIndex.js (with improved Discord interaction error handling and commission)
console.log("--- Running kellyIndex.js - Version: 7 (Commission Feature) ---");
require('dotenv').config();

const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, InteractionType, ChannelType, EmbedBuilder,
  DiscordAPIError // Import specific error type
} = require('discord.js');

// --- Import other modules (ensure paths are correct) ---
const { kellyCommands } = require('./kellyCommands.js');
const { initNewBet, finalizeNewBet, listPendingBets, editBet, settleBet, unsettleBet, getBetsData } = require('./kellyBetManager.js');
const { getCurrentBankroll, deductStake, addWinnings } = require('./kellyBankrollManager.js');
const { getBasicStats } = require('./kellyStatsManager.js');
const { parseBetString, loadBookmakerAliases, saveBookmakerAliases, loadSportAliases, saveSportAliases, resolveAlias } = require('./kellyUtils'); // Uses async utils

const fs = require('fs').promises;
const path = require('path');

// --- Configuration ---
// IMPORTANT: MOVE TO .env file before deployment!
const DISCORD_BOT_TOKEN = ''; // Actual Token - REMOVE FROM CODE
const DISCORD_CLIENT_ID = ''; // Actual Client ID - REMOVE FROM CODE
const ALLOWED_CHANNEL_ID = ''; // Actual Allowed Channel ID - Consider moving to .env
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null; // Use null if not set

const FAILED_PARSE_LOG_FILE = path.join(__dirname, 'failed_parses.log');
const ALL_BOOKMAKERS = [ /* ... your list ... */ ];
const COMMON_SPORTS = [ /* ... your list ... */ ];
// --- End Configuration ---

const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ],
  partials: [Partials.Channel]
});
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

async function registerCommands() {
    console.log(`Registering ${kellyCommands.length} slash commands...`);
    try {
        await rest.put(
            Routes.applicationCommands(DISCORD_CLIENT_ID),
            { body: kellyCommands },
        );
        console.log('Successfully registered application commands globally.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// --- Bot Startup Logic ---
(async () => {
    client.once(Events.ClientReady, async () => {
      console.log(`Logged in as ${client.user.tag}`);
      await registerCommands(); // Register commands on ready

       try {
           client.bookmakerAliases = await loadBookmakerAliases();
           console.log(`Loaded ${Object.keys(client.bookmakerAliases || {}).length} bookmaker aliases.`);
       } catch (error) {
            console.error("FATAL: Could not load bookmaker aliases on startup. Using empty.", error);
            client.bookmakerAliases = {};
       }
       try {
           client.sportAliases = await loadSportAliases();
           console.log(`Loaded ${Object.keys(client.sportAliases || {}).length} sport aliases.`);
       } catch (error) {
            console.error("FATAL: Could not load sport aliases on startup. Using empty.", error);
            client.sportAliases = {};
       }

      client.tempBetInputs = {};
      client.failedStrings = {};
    });

     try {
        await client.login(DISCORD_BOT_TOKEN);
     } catch (loginError) {
         console.error("Bot Login Error:", loginError);
         process.exit(1);
     }
})();
// --- End Bot Startup Logic ---


// --- Logging Function ---
async function logFailedParse(originalString, correctedData, user) {
     const logEntry = `[${new Date().toISOString()}] User: ${user.tag} (${user.id})\nFailed String: ${originalString}\nCorrected Data: ${JSON.stringify(correctedData)}\n---\n`;
     try { await fs.appendFile(FAILED_PARSE_LOG_FILE, logEntry); } catch (e) { console.error("Failed to write to failed_parses.log:", e); }
     if (LOG_CHANNEL_ID) {
          try { const logChannel = await client.channels.fetch(LOG_CHANNEL_ID); if (logChannel) logChannel.send(`Manual entry used by ${user.tag}:\n\`\`\`${logEntry}\`\`\``); } catch (e) { console.error("Failed to send log to LOG_CHANNEL_ID:", e); }
     }
 }
// --- End Logging Function ---

// --- Utility: Calculation Explanation ---
function getCalculationExplanation(betInput, recommendedStake) {
    if (!betInput || typeof betInput.backOdds !== 'number' || typeof betInput.fairOdds !== 'number') return "Invalid input for calculation explanation.";
    const ev = (betInput.backOdds / betInput.fairOdds) - 1;
    const kellyFractionRaw = ev / (betInput.backOdds - 1);
    const kellyFractionUsed = 1 / 4; // Assuming 1/4 Kelly
    const capPercent = 0.01; // Assuming 1% cap
    return `**Calculation:**\n` +
           `EV = (Back / Fair) - 1 = (${betInput.backOdds} / ${betInput.fairOdds}) - 1 = ${ev.toFixed(4)}\n` +
           `Raw Kelly % = EV / (Back - 1) = ${ev.toFixed(4)} / ${betInput.backOdds - 1} = ${(kellyFractionRaw * 100).toFixed(2)}%\n` +
           `Used Kelly % = Raw Kelly * ${kellyFractionUsed} = ${(kellyFractionRaw * kellyFractionUsed * 100).toFixed(2)}%\n` +
           `Cap % = ${(capPercent * 100).toFixed(1)}% of Bankroll\n` +
           `Final Stake = Min(Used Kelly %, Cap %) * Bankroll, rounded to £0.50 (Min £0.50) = £${recommendedStake.toFixed(2)}`;
}
// --- End Calculation Explanation ---


/** Helper function to safely reply or followUp */
async function safeReply(interaction, options) {
    try {
        const ephemeralOptions = { ...options, ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(ephemeralOptions);
        } else {
            await interaction.reply(ephemeralOptions);
        }
    } catch (error) {
        console.error(`Error sending safeReply/followUp for interaction ${interaction.id}:`, error);
        try {
             if (interaction.channel && !interaction.ephemeral) {
                 await interaction.channel.send(`⚠️ Sorry, ${interaction.user.toString()}, I encountered an error trying to respond to your command.`);
             }
        } catch (channelSendError) {
             console.error("Failed to send even generic channel error message:", channelSendError);
        }
    }
}


/** Main Interaction Handling */
client.on(Events.InteractionCreate, async (interaction) => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  try {
    // --- Autocomplete Handling ---
    if (interaction.isAutocomplete()) {
        const commandName = interaction.commandName; const focusedOption = interaction.options.getFocused(true); const focusedValue = focusedOption.value.toLowerCase(); let choices = []; let sourceList = [];
        if ((commandName === 'pendingbets' || commandName === 'stats' || (commandName === 'editbet' && focusedOption.name === 'bookmaker'))) { const aliasValues = Object.values(client.bookmakerAliases || {}); sourceList = [...new Set([...ALL_BOOKMAKERS, ...aliasValues])]; choices = sourceList.filter(bk => bk.toLowerCase().includes(focusedValue)); }
        // UPDATED: Added 'commission' to editable fields
        else if (commandName === 'editbet' && focusedOption.name === 'field') { const fields = ['bookmaker', 'sport', 'betName', 'backOdds', 'fairOdds', 'stake', 'commission']; choices = fields.filter(field => field.toLowerCase().startsWith(focusedValue)); }
        else if ((commandName === 'editbet' || commandName === 'settlebet') && focusedOption.name === 'betid') { const pending = listPendingBets(); pending.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); choices = pending.filter(bet => bet.id.toLowerCase().startsWith(focusedValue)).map(bet => ({ name: `${bet.id} (${bet.betName.substring(0, 50)}${bet.betName.length > 50 ? '...' : ''})`, value: bet.id })); }
        else if (commandName === 'unsettlebet' && focusedOption.name === 'betid') { const allBets = getBetsData(); const settledBets = allBets.filter(bet => bet.status !== 'pending'); settledBets.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)); choices = settledBets.filter(bet => bet.id.toLowerCase().startsWith(focusedValue)).map(bet => ({ name: `${bet.id} (${bet.betName.substring(0, 50)}${bet.betName.length > 50 ? '...' : ''}) - ${bet.status}`, value: bet.id })); }
        else if ((commandName === 'pendingbets' || commandName === 'stats') && focusedOption.name === 'sport') { const aliasValues = Object.values(client.sportAliases || {}); sourceList = [...new Set([...COMMON_SPORTS, ...aliasValues])]; choices = sourceList.filter(sp => sp.toLowerCase().includes(focusedValue)); }
        if (choices.length > 0) { let responseFormat; if (typeof choices[0] === 'string') { responseFormat = [...new Set(choices)].slice(0, 25).map(choice => ({ name: choice, value: choice })); } else { responseFormat = choices.slice(0, 25); } try { await interaction.respond(responseFormat); } catch (e) { console.warn(`Autocomplete respond error: ${e.message}`); } } else { try { await interaction.respond([]); } catch (e) { console.warn(`Autocomplete respond (empty) error: ${e.message}`); } }
        return;
    } // --- End Autocomplete ---

    // --- Channel/Thread Rules --- (Keep as is)
    if (interaction.isChatInputCommand() || interaction.isButton() || interaction.isModalSubmit()) { // Apply to relevant interactions
        const commandName = interaction.isChatInputCommand() ? interaction.commandName : null;
        const channel = interaction.channel;
        const channelId = interaction.channelId;

        if (commandName === 'kelly') {
            if (channelId !== ALLOWED_CHANNEL_ID) return safeReply(interaction, { content: 'Please use `/kelly` only in the designated channel.' });
        } else if (!interaction.isAutocomplete() && commandName !== 'add_alias' && commandName !== 'add_sport_alias') { // Exclude alias commands from thread check
             if (!channel?.isThread() || channel?.type !== ChannelType.PrivateThread || !channel?.name.startsWith('KellyBot Session')) {
                  const isEphemeral = interaction.ephemeral ?? false;
                  if (!isEphemeral) {
                      return safeReply(interaction, { content: 'Please use betting commands only inside your private KellyBot thread.' });
                  } else {
                      console.warn(`User ${interaction.user.tag} attempted command outside thread in an ephemeral context.`);
                      return;
                  }
             }
        }
    }
    // --- End Channel/Thread Rules ---


    // --- Slash Command Handler ---
    if (interaction.isChatInputCommand()) {
        const { commandName, user } = interaction;
        let commandFunction;
        const commandHandlers = {
            'kelly': handleKellyCommand,
            'add_alias': handleAddAliasCommand,
            'add_sport_alias': handleAddSportAliasCommand,
            'newbet': handleNewBetCommand,
            'editbet': handleEditBetCommand,
            'settlebet': handleSettleBetCommand,
            'pendingbets': handlePendingBetsCommand,
            'unsettlebet': handleUnsettleBetCommand,
            'stats': handleStatsCommand,
        };
        commandFunction = commandHandlers[commandName];

        if (commandFunction) {
             await commandFunction(interaction, user);
        } else {
             console.warn(`Unknown slash command received: ${commandName}`);
             await safeReply(interaction, { content: "Sorry, I don't recognize that command." });
        }
        return;
    } // --- End Slash Command Handler ---


    // --- Button Interaction Handler ---
    if (interaction.isButton()) {
        const { user } = interaction;
        try {
            await handleButtonInteraction(interaction, user);
        } catch (buttonError) {
             console.error(`Error handling button interaction ${interaction.customId}:`, buttonError);
             await safeReply(interaction, { content: `There was an error processing that button press: ${buttonError.message}` });
             try {
                 if (interaction.message && interaction.message.components.length > 0) {
                      await interaction.update({ components: [] }).catch(() => {}); // Attempt to remove buttons, ignore error if already handled
                 }
             } catch (updateError) {
                 console.warn("Failed to remove buttons after button error:", updateError.message);
             }
        }
        return;
    } // --- End Button Interaction Handler ---


    // --- Modal Submission Handler ---
    if (interaction.isModalSubmit()) {
        const { user } = interaction;
         try {
             await handleModalSubmit(interaction, user);
         } catch (modalError) {
             console.error(`Error handling modal submission ${interaction.customId}:`, modalError);
             await safeReply(interaction, { content: `There was an error processing your submission: ${modalError.message}` });
         }
        return;
    } // --- End Modal Submission Handler ---

  } catch (error) { // Main interaction error handler
    console.error('Critical Interaction Error:', error);
    await safeReply(interaction, { content: 'An unexpected error occurred. Please try again later or contact the bot admin.' });
  }
}); // End client.on(Events.InteractionCreate)


// ==================================================
//  COMMAND HANDLER FUNCTIONS
// ==================================================

async function handleKellyCommand(interaction, user) {
     try {
         const thread = await interaction.channel.threads.create({
             name: `KellyBot Session - ${user.username}`, autoArchiveDuration: 1440,
             type: ChannelType.PrivateThread, invitable: false
         });
         await thread.members.add(user.id);
         await safeReply(interaction, { content: `Private thread <#${thread.id}> created.` });
         await thread.send(`Welcome, ${user.tag}! Bankroll: £${getCurrentBankroll().toFixed(2)}.`);
     } catch (err) {
          console.error('Error in /kelly command:', err);
          let errorMsg = 'Could not create thread.';
          if (err instanceof DiscordAPIError) {
              if (err.code === 50013) errorMsg += ' (Missing Permissions).';
              else errorMsg += ` (Discord Error ${err.code}).`;
          }
          await safeReply(interaction, { content: errorMsg });
     }
}

async function handleAddAliasCommand(interaction, user) {
    const alias = interaction.options.getString('alias', true).trim();
    const fullName = interaction.options.getString('full_name', true).trim();
    if (!alias || !fullName) return safeReply(interaction, { content: 'Alias and Full Name cannot be empty.' });
    const aliasKey = alias.toUpperCase();
    try {
         client.bookmakerAliases = await loadBookmakerAliases();
         const oldName = client.bookmakerAliases[aliasKey];
         client.bookmakerAliases[aliasKey] = fullName;
         await saveBookmakerAliases(client.bookmakerAliases);
         const replyMsg = oldName ? `✅ Bookie alias **updated**: \`${aliasKey}\` -> \`${fullName}\`` : `✅ Bookie alias **added**: \`${aliasKey}\` -> \`${fullName}\``;
         await safeReply(interaction, { content: replyMsg });
    } catch (error) {
         console.error("Error adding/saving bookmaker alias:", error);
         await safeReply(interaction, { content: `❌ Error saving bookmaker alias: ${error.message}` });
    }
}

async function handleAddSportAliasCommand(interaction, user) {
    const alias = interaction.options.getString('alias', true).trim();
    const fullName = interaction.options.getString('full_name', true).trim();
    if (!alias || !fullName) return safeReply(interaction, { content: 'Alias and Full Name cannot be empty.' });
    const aliasKey = alias.toUpperCase();
    try {
        client.sportAliases = await loadSportAliases();
        const oldName = client.sportAliases[aliasKey];
        client.sportAliases[aliasKey] = fullName;
        await saveSportAliases(client.sportAliases);
        const replyMsg = oldName ? `✅ Sport alias **updated**: \`${aliasKey}\` -> \`${fullName}\`` : `✅ Sport alias **added**: \`${aliasKey}\` -> \`${fullName}\``;
        await safeReply(interaction, { content: replyMsg });
    } catch (error) {
        console.error("Error adding/saving sport alias:", error);
        await safeReply(interaction, { content: `❌ Error saving sport alias: ${error.message}` });
    }
}

// UPDATED: Handle commission option
async function handleNewBetCommand(interaction, user) {
    const betString = interaction.options.getString('betstring', true);
    const commission = interaction.options.getNumber('commission'); // Get optional commission
    try {
        const parsedBet = parseBetString(betString, client.bookmakerAliases || {}, client.sportAliases || {}, ALL_BOOKMAKERS, COMMON_SPORTS);
        if (!parsedBet) throw new Error("Parser returned undefined.");

        const betInput = { bookmaker: parsedBet.bookmaker, sport: parsedBet.sport, betName: parsedBet.betName, backOdds: parsedBet.backOdds, fairOdds: parsedBet.fairOdds };

        // Pass commission to initNewBet
        const { recommendedStake, finalBetInput } = initNewBet(betInput, commission);

        if (recommendedStake <= 0) {
             return safeReply(interaction, { content: `**Parsed OK, but Kelly stake £0.00.**\nReason: ${finalBetInput.calculationError || 'Low/Neg EV or invalid odds.'}\nBet not initiated.` });
        }

        client.tempBetInputs[user.id] = finalBetInput;

        // UPDATED: Display commission if present
        let content = `**Parsed Bet:**\n* Bookmaker: \`${finalBetInput.bookmaker}\`\n* Sport: \`${finalBetInput.sport}\`\n* Name: \`${finalBetInput.betName}\`\n* Back Odds: \`${finalBetInput.backOdds}\`\n* Fair Odds: \`${finalBetInput.fairOdds}\``;
        if (finalBetInput.commission !== undefined) {
             content += `\n* Commission: \`${finalBetInput.commission}%\``; // Display commission
        }
        content += `\n\n**Kelly Recommends: £${recommendedStake.toFixed(2)}**`;

        const components = [ new ActionRowBuilder().addComponents( new ButtonBuilder().setCustomId(`kelly_yesfull_${recommendedStake}`).setLabel('Yes, full stake').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`kelly_nopartial_${recommendedStake}`).setLabel('No, partial').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`kelly_calc_${recommendedStake}`).setLabel('Calculation').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`kelly_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Danger))];
        await safeReply(interaction, { content, components });

    } catch (error) {
        console.warn(`[NewBet Handler Failed] User: ${user.tag}, Error: ${error.message}`);
        client.failedStrings[user.id] = betString;
        const content = `⚠️ **Processing Failed!**\nError: ${error.message}\nString: \`${betString}\`\n\nEnter manually?`;
        const components = [ new ActionRowBuilder().addComponents( new ButtonBuilder().setCustomId(`manual_entry_yes`).setLabel('Yes, Manual Entry').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`manual_entry_no`).setLabel('No, Cancel').setStyle(ButtonStyle.Danger))];
        await safeReply(interaction, { content, components });
    }
}

async function handleEditBetCommand(interaction, user) {
    const betId = interaction.options.getString('betid', true).toUpperCase();
    const field = interaction.options.getString('field', true).toLowerCase();
    const value = interaction.options.getString('value', true);
    try {
         // editBet now handles commission validation
         const updatedBet = editBet(betId, { [field]: value });
         await safeReply(interaction, { content: `✅ Bet **${betId}** updated! Field \`${field}\` set to \`${value}\`.` });
    } catch (err) {
         await safeReply(interaction, { content: `❌ Error editing bet ${betId}: ${err.message}` });
    }
}

async function handleSettleBetCommand(interaction, user) {
    const betId = interaction.options.getString('betid', true).toUpperCase();
    const result = interaction.options.getString('result', true);
    const userReturn = interaction.options.getNumber('userreturn');
    try {
        if (result === 'part-win' && (userReturn === null || isNaN(userReturn) || userReturn < 0)) {
             throw new Error('For partial-win, a non-negative "userreturn" amount is needed.');
        }
        // settleBet now handles commission calculation
        const updatedBet = settleBet(betId, result, userReturn);
        const commissionInfo = updatedBet.commission !== undefined ? ` (Comm: ${updatedBet.commission}%)` : '';
        const details = `Bet: ${updatedBet.betName}\nStake: £${updatedBet.stake.toFixed(2)}\nP/L: £${(updatedBet.profitLoss ?? 0).toFixed(2)}${commissionInfo}\n`;
        await safeReply(interaction, { content: `✅ **Bet ${betId} Settled: ${result.toUpperCase()}**!\n${details}Bankroll: £${getCurrentBankroll().toFixed(2)}` });
    } catch (err) {
         await safeReply(interaction, { content: `❌ Error settling bet ${betId}: ${err.message}` });
    }
}

async function handlePendingBetsCommand(interaction, user) {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const filterBookmaker = interaction.options.getString('bookmaker');
    const filterSport = interaction.options.getString('sport');
    try {
        let allPendingSorted = listPendingBets();
        let filtered = allPendingSorted;
        if (filterBookmaker) filtered = filtered.filter(bet => bet.bookmaker?.toLowerCase() === filterBookmaker.toLowerCase());
        if (filterSport) filtered = filtered.filter(bet => bet.sport?.toLowerCase() === filterSport.toLowerCase());

        if (!filtered.length) {
             return safeReply(interaction, { content: 'No pending bets match filters.' });
        }

        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ content: `Found **${filtered.length}** pending bet(s). Sending individually...` });

        let messagesSent = 0;
        for (const bet of filtered) {
            // UPDATED: Display commission info
            const commissionInfo = bet.commission !== undefined ? ` | Comm: ${bet.commission}%` : '';
            const betLine = `**ID:** \`${bet.id}\` | ${bet.bookmaker || '?'} | ${bet.sport || '?'} | Stake: £${bet.stake?.toFixed(2) || '?'}${commissionInfo}\n*${bet.betName || 'No Name'}*`;

            const row = new ActionRowBuilder().addComponents(
                 new ButtonBuilder().setCustomId(`settle_win_${bet.id}`).setLabel('Win').setStyle(ButtonStyle.Success),
                 new ButtonBuilder().setCustomId(`settle_loss_${bet.id}`).setLabel('Loss').setStyle(ButtonStyle.Danger),
                 new ButtonBuilder().setCustomId(`settle_push_${bet.id}`).setLabel('Push').setStyle(ButtonStyle.Secondary),
                 new ButtonBuilder().setCustomId(`settle_partwin_${bet.id}`).setLabel('Partial').setStyle(ButtonStyle.Primary)
             );
            try {
                await interaction.followUp({ content: betLine, components: [row], ephemeral: true });
                messagesSent++;
                if (messagesSent % 10 === 0) await delay(500);
                else await delay(200);
            } catch (followUpError) {
                console.error(`Error sending follow-up for bet ${bet.id} after ${messagesSent} sent:`, followUpError);
                let errorFeedback = `⚠️ Error sending details for bet ${bet.id}.`;
                if (followUpError instanceof DiscordAPIError && followUpError.code === 40060) { errorFeedback += ` The interaction might have expired. Try again.`; }
                 else if (followUpError.message.includes('rate limit')) { errorFeedback += ` Hit Discord rate limits. Wait and try again.`; }
                 else { errorFeedback += ` Further messages stopped. (${followUpError.message})`; }
                 try { await interaction.followUp({ content: errorFeedback, ephemeral: true }); } catch { /* Ignore */ }
                 break;
            }
        } // end for loop
    } catch (err) {
         console.error(`Error in handlePendingBetsCommand: ${err.message}`);
         if (!interaction.deferred && !interaction.replied) {
            await safeReply(interaction, { content: `❌ Error listing pending bets: ${err.message}` });
         } else {
             try { await interaction.editReply({ content: `❌ Error listing pending bets: ${err.message}`, components: [] }); }
              catch (editError) { console.error("Failed to edit reply after pending bets error:", editError); try { await interaction.followUp({ content: `❌ Error listing pending bets: ${err.message}`, ephemeral: true }); } catch {} }
         }
    }
}


async function handleUnsettleBetCommand(interaction, user) {
     const betId = interaction.options.getString('betid', true).toUpperCase();
     try {
         // unsettleBet now handles commission reversal implicitly via bankroll adjustment logic
         const revertedBet = unsettleBet(betId);
         await safeReply(interaction, { content: `✅ Bet **${betId}** (${revertedBet.betName}) reverted to **pending**.\nBankroll: £${getCurrentBankroll().toFixed(2)}` });
     } catch (err) {
         await safeReply(interaction, { content: `❌ Error reverting bet ${betId}: ${err.message}` });
     }
}

async function handleStatsCommand(interaction, user) {
    const timeRange = interaction.options.getString('time') || null;
    const sport = interaction.options.getString('sport') || null;
    const bookmaker = interaction.options.getString('bookmaker') || null;
    const showDetail = interaction.options.getBoolean('showdetails') || false;

    try {
        const resolvedSport = sport ? resolveAlias(sport, client.sportAliases || {}, COMMON_SPORTS) : null;
        const resolvedBookmaker = bookmaker ? resolveAlias(bookmaker, client.bookmakerAliases || {}, ALL_BOOKMAKERS) : null;

        // getBasicStats reads bets file and uses stored profitLoss (which includes commission effect)
        const { filteredBets, ...statsSummary } = getBasicStats({
            timeRange, sport: resolvedSport, bookmaker: resolvedBookmaker, returnFilteredBets: true
        });

        const filtersApplied = [timeRange || 'All Time', resolvedSport || 'All Sports', resolvedBookmaker || 'All Bookies'].filter(Boolean).join(' | ');
        const embed = new EmbedBuilder()
            .setColor(0x0099FF).setTitle('📊 Betting Stats').setDescription(`Filters: ${filtersApplied}`)
            .addFields(
                { name: 'Bankroll', value: `£${statsSummary.currentBankroll.toFixed(2)}`, inline: true }, { name: 'Total Bets', value: `${statsSummary.totalBets}`, inline: true }, { name: 'Settled Bets', value: `${statsSummary.totalSettledBets}`, inline: true },
                { name: 'Wins', value: `${statsSummary.wins}`, inline: true }, { name: 'Losses', value: `${statsSummary.losses}`, inline: true }, { name: 'Pushes', value: `${statsSummary.pushes} (+${statsSummary.partialWins} P)`, inline: true },
                { name: 'Total P/L', value: `£${statsSummary.totalProfitLoss.toFixed(2)}`, inline: true }, { name: 'ROI (Settled)', value: `${(statsSummary.ROI * 100).toFixed(2)}%`, inline: true }, { name: '\u200B', value: '\u200B', inline: true }
            ).setTimestamp().setFooter({ text: 'Kelly Bot Stats' });

        await safeReply(interaction, { embeds: [embed] });

        if (showDetail && filteredBets && filteredBets.length > 0) {
             let detailMsg = `\n**Matching Bets (${filteredBets.length}):**\n`;
             filteredBets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
             const MAX_DETAIL_MSG_LENGTH = 1950;
             let followUpCount = 0;
             for (const bet of filteredBets) {
                  let profitLossStr = bet.status !== 'pending' ? ` | P/L: £${(bet.profitLoss ?? 0).toFixed(2)}` : '';
                  let commissionStr = bet.commission !== undefined ? ` (C:${bet.commission}%)` : '';
                  let betDesc = `• \`${bet.id}\` [${bet.status.toUpperCase()}] ${new Date(bet.timestamp).toLocaleDateString()} | ${bet.bookmaker || '?'} | ${bet.sport || '?'} | £${bet.stake.toFixed(2)}${bet.backOdds ? ` @ ${bet.backOdds}` : ''}${commissionStr}${profitLossStr} | *${bet.betName}*\n`;
                  if ((detailMsg + betDesc).length > MAX_DETAIL_MSG_LENGTH) {
                       try { await interaction.followUp({ content: detailMsg, ephemeral: true }); followUpCount++; if (followUpCount > 8) await delay(1000); else await delay(200); } catch (e){ console.error("Stats detail followUp failed:", e); throw new Error("Failed sending bet details."); }
                       detailMsg = betDesc;
                  } else { detailMsg += betDesc; }
             }
             if (detailMsg.trim().length > `**Matching Bets (${filteredBets.length}):**\n`.length) {
                  await interaction.followUp({ content: detailMsg, ephemeral: true });
             }
        } else if (showDetail) {
             await interaction.followUp({ content: "\n*(No matching bets for details)*", ephemeral: true });
        }
    } catch (err) {
         await safeReply(interaction, { content: `❌ Error generating stats: ${err.message}` });
    }
}


// ==================================================
//  BUTTON & MODAL HANDLER FUNCTIONS
// ==================================================

async function handleButtonInteraction(interaction, user) {
    const customIdParts = interaction.customId.split('_');
    const prefix = customIdParts[0];
    const action = customIdParts[1];

    // Manual Entry Buttons
    if (prefix === 'manual' && action === 'entry') {
        const decision = customIdParts[2];
        if (decision === 'yes') {
             try {
                 const modal = new ModalBuilder().setCustomId('manual_bet_modal').setTitle('Manual Bet Entry');
                 // UPDATED: Add commission field to modal
                 modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('manual_bookmaker').setLabel("Bookmaker").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('manual_sport').setLabel("Sport").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('manual_betname').setLabel("Bet Name").setStyle(TextInputStyle.Paragraph).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('manual_backodds').setLabel("Back Odds (>1)").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('manual_fairodds').setLabel("Fair Odds (>1)").setStyle(TextInputStyle.Short).setRequired(true)),
                    // Add commission field
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('manual_commission').setLabel("Commission % (Optional, 0-100)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g., 5 for 5%'))
                 );
                 await interaction.showModal(modal);
             } catch (modalError) {
                  console.error("Error showing manual entry modal:", modalError);
                  try { await interaction.followUp({ content: "Sorry, couldn't open the manual entry form.", ephemeral: true }); } catch {}
             }
        } else { // decision === 'no'
            if (client.failedStrings?.[user.id]) delete client.failedStrings[user.id];
            await interaction.update({ content: 'Manual entry canceled.', components: [] });
        }
        return;
    }

    // Kelly Confirmation Buttons
    else if (prefix === 'kelly') {
        const stakeOrBetId = customIdParts.length > 2 ? customIdParts[2] : null;
        const recommendedStake = stakeOrBetId && !isNaN(parseFloat(stakeOrBetId)) ? parseFloat(stakeOrBetId) : 0;
        const betInput = client.tempBetInputs?.[user.id];

        if (!betInput && action !== 'cancel') {
             return interaction.update({ content: 'Bet details expired. Please use `/newbet` again.', components: [] });
        }

        if (action === 'yesfull') {
             if (recommendedStake <= 0) return interaction.update({ content: 'Error: Cannot place zero stake bet.', components: [] });
             try {
                 // finalizeNewBet now includes commission from betInput
                 const newBet = finalizeNewBet(betInput, recommendedStake);
                 delete client.tempBetInputs[user.id];
                 await interaction.update({ content: `✅ **Bet Placed!** ID: \`${newBet.id}\`, Stake: £${recommendedStake.toFixed(2)}\nBankroll: £${getCurrentBankroll().toFixed(2)}`, components: [] });
             } catch (finalizeError) {
                  console.error(`Error finalizing bet after 'yesfull' button:`, finalizeError);
                  await interaction.update({ content: `❌ **Bet Failed!** ${finalizeError.message}`, components: [] });
             }
        } else if (action === 'nopartial') {
             try {
                 const modal = new ModalBuilder().setCustomId(`partial_modal_${recommendedStake}`).setTitle('Partial Stake');
                 modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('partialStakeValue').setLabel('Actual stake (£)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(`Rec: ${recommendedStake.toFixed(2)}`)));
                 await interaction.showModal(modal);
             } catch (modalError) {
                 console.error("Error showing partial stake modal:", modalError);
                 try { await interaction.followUp({ content: "Sorry, couldn't open the partial stake form.", ephemeral: true }); } catch {}
             }
        } else if (action === 'calc') {
             const explanation = getCalculationExplanation(betInput, recommendedStake);
             await interaction.update({ content: explanation, components: interaction.message.components });
        } else if (action === 'cancel') {
             if (client.tempBetInputs?.[user.id]) delete client.tempBetInputs[user.id];
             await interaction.update({ content: 'Bet creation canceled.', components: [] });
        }
        return;
    }

    // Settle Buttons
    else if (prefix === 'settle') {
         const result = action;
         const betId = customIdParts.length > 2 ? customIdParts[2] : null;
         if(!betId) {
              try { await interaction.update({content: "Error: Settle button missing Bet ID.", components: []}); } catch { /* Ignore */ }
              return;
         }
         try {
             if (result === 'partwin') {
                 const modal = new ModalBuilder().setCustomId(`partialsettle_modal_${betId}`).setTitle(`Partial Win (${betId})`);
                 modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('userReturnValue').setLabel('Total returned (£) (stake+profit)').setStyle(TextInputStyle.Short).setRequired(true)));
                 await interaction.showModal(modal);
                 // Defer update until modal submit? No, update here to remove buttons.
                 // await interaction.update({ content: `Opening modal to settle ${betId} as partial win...`, components: [] });
             } else {
                 // settleBet now handles commission
                 const settledBet = settleBet(betId, result, null);
                 const commissionInfo = settledBet.commission !== undefined ? ` (Comm: ${settledBet.commission}%)` : '';
                 await interaction.update({ content: `✅ Bet **${betId}** settled: **${result.toUpperCase()}**!\nP/L: £${(settledBet.profitLoss ?? 0).toFixed(2)}${commissionInfo}\nBankroll: £${getCurrentBankroll().toFixed(2)}`, components: [] });
             }
         } catch (err) {
              console.error(`Error handling settle button for ${betId}:`, err);
              try { await interaction.update({ content: `❌ Error settling bet ${betId}: ${err.message}`, components: [] }); } catch { /* Ignore */ }
         }
         return;
     }
} // end handleButtonInteraction

// UPDATED: Handle commission in manual entry modal
async function handleModalSubmit(interaction, user) {
    const customIdParts = interaction.customId.split('_');
    const modalType = customIdParts[0];

    // Manual Bet Modal
    if (interaction.customId === 'manual_bet_modal') {
         try {
             const bookmakerRaw = interaction.fields.getTextInputValue('manual_bookmaker').trim();
             const sportRaw = interaction.fields.getTextInputValue('manual_sport').trim();
             const betName = interaction.fields.getTextInputValue('manual_betname').trim();
             const backOddsStr = interaction.fields.getTextInputValue('manual_backodds').trim();
             const fairOddsStr = interaction.fields.getTextInputValue('manual_fairodds').trim();
             // Get optional commission
             const commissionStr = interaction.fields.getTextInputValue('manual_commission')?.trim();

             const bookmaker = resolveAlias(bookmakerRaw, client.bookmakerAliases || {}, ALL_BOOKMAKERS);
             const sport = resolveAlias(sportRaw, client.sportAliases || {}, COMMON_SPORTS);
             const backOdds = parseFloat(backOddsStr);
             const fairOdds = parseFloat(fairOddsStr);

             let commission = null;
             if (commissionStr) {
                 commission = parseFloat(commissionStr);
                 if (isNaN(commission) || commission < 0 || commission > 100) {
                     throw new Error("Invalid commission value. Must be between 0 and 100.");
                 }
             }

             if (isNaN(backOdds) || isNaN(fairOdds) || backOdds <= 1 || fairOdds <= 1) throw new Error(`Invalid odds (>1 required).`);
             if (!bookmaker || !sport || !betName) throw new Error("Bookie, Sport, Name required.");

             const originalString = client.failedStrings?.[user.id] || "N/A";
             const correctedData = { bookmaker, sport, betName, backOdds, fairOdds, ...(commission !== null && { commission }) }; // Include commission if present

             await logFailedParse(originalString, correctedData, user);
             if (client.failedStrings?.[user.id]) delete client.failedStrings[user.id];

             // Pass commission to initNewBet
             const { recommendedStake, finalBetInput } = initNewBet({ bookmaker, sport, betName, backOdds, fairOdds }, commission);

             if (recommendedStake <= 0) return safeReply(interaction, { content: `Manual entry OK, but Kelly stake £0.00 (${finalBetInput.calculationError || 'Low/Neg EV'}). Bet not initiated.` });

             client.tempBetInputs[user.id] = finalBetInput; // Store input with commission

             // Display commission
             let content = `**Manual Entry OK:**\n* Bookie: \`${finalBetInput.bookmaker}\`\n* Sport: \`${finalBetInput.sport}\`\n* Name: \`${finalBetInput.betName}\`\n* Back: \`${finalBetInput.backOdds}\`, Fair: \`${finalBetInput.fairOdds}\``;
             if (finalBetInput.commission !== undefined) {
                 content += `\n* Commission: \`${finalBetInput.commission}%\``;
             }
             content += `\n\n**Kelly Recommends: £${recommendedStake.toFixed(2)}**`;

             const components = [ new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`kelly_yesfull_${recommendedStake}`).setLabel('Yes, full').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`kelly_nopartial_${recommendedStake}`).setLabel('No, partial').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`kelly_calc_${recommendedStake}`).setLabel('Calc').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`kelly_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Danger))
             ];
             await safeReply(interaction, { content, components });
         } catch (error) { await safeReply(interaction, { content: `❌ Error processing manual entry: ${error.message}` }); }
         return;
    }

    // Partial Stake Modal
    else if (modalType === 'partial' && customIdParts[1] === 'modal') {
         try {
             const recommendedStake = parseFloat(customIdParts[2]);
             const partialValStr = interaction.fields.getTextInputValue('partialStakeValue');
             const partialValue = parseFloat(partialValStr);
             if (isNaN(partialValue) || partialValue <= 0) throw new Error('Invalid partial stake (> 0 required).');

             const betInput = client.tempBetInputs?.[user.id]; if (!betInput) throw new Error('Bet details expired.');

             const currentBankroll = getCurrentBankroll(); if (partialValue > currentBankroll) throw new Error(`Insufficient bankroll (£${currentBankroll.toFixed(2)}) for £${partialValue.toFixed(2)} stake.`);

             // finalizeNewBet includes commission from betInput
             const newBet = finalizeNewBet(betInput, partialValue);
             delete client.tempBetInputs[user.id];
             await safeReply(interaction, { content: `✅ **Bet Placed (Partial)!** ID: \`${newBet.id}\`, Stake: £${partialValue.toFixed(2)}\n(Recommended: £${recommendedStake.toFixed(2)})\nBankroll: £${getCurrentBankroll().toFixed(2)}` });
         } catch(error) { await safeReply(interaction, { content: `❌ Error processing partial stake: ${error.message}` }); }
         return;
    }

    // Partial Settle Modal
    else if (modalType === 'partialsettle' && customIdParts[1] === 'modal') {
        try {
             const betId = customIdParts[2];
             const userReturnStr = interaction.fields.getTextInputValue('userReturnValue');
             const userReturn = parseFloat(userReturnStr);
             if (isNaN(userReturn) || userReturn < 0) throw new Error('Invalid partial return amount (>= 0 required).');

             // settleBet now handles commission
             const settledBet = settleBet(betId, 'part-win', userReturn);
             const commissionInfo = settledBet.commission !== undefined ? ` (Comm: ${settledBet.commission}%)` : '';
             // Use settledBet.partialReturn as the actual amount returned post-commission
             const actualReturn = settledBet.partialReturn ?? userReturn; // Fallback just in case
             await safeReply(interaction, { content: `✅ Bet **${betId}** settled: **Partial Win** (Returned: £${actualReturn.toFixed(2)}).\nP/L: £${(settledBet.profitLoss ?? 0).toFixed(2)}${commissionInfo}\nBankroll: £${getCurrentBankroll().toFixed(2)}` });
         } catch (err) { await safeReply(interaction, { content: `❌ Error settling bet ${customIdParts[2]} partially: ${err.message}` }); }
         return;
    }

} // end handleModalSubmit
