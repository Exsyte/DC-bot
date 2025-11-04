/************************************************************
 * kellyCommands.js
 *
 * Command definitions, simplified removing is2pc, etc.
 * Updated to include optional commission.
 ************************************************************/
const { SlashCommandBuilder } = require('discord.js');

// --- Core Commands ---
const kellyCommand = new SlashCommandBuilder()
  .setName('kelly')
  .setDescription('Starts a Kelly Betting private thread session');

const newBetCommand = new SlashCommandBuilder()
  .setName('newbet')
  .setDescription('Create a new Kelly Bet using a single input string.')
  .addStringOption(opt =>
    opt
      .setName('betstring')
      .setDescription('Paste the full bet details (e.g., Bookie - Sport - Name - BackOdds / FairOdds)') // Updated description
      .setRequired(true)
  )
  // ADDED: Optional commission option
  .addNumberOption(opt =>
    opt
      .setName('commission')
      .setDescription('Optional commission percentage (e.g., 5 for 5%). Applies to winnings.')
      .setRequired(false)
      .setMinValue(0) // Commission cannot be negative
      .setMaxValue(100) // Commission cannot exceed 100%
  );


const editBetCommand = new SlashCommandBuilder()
  .setName('editbet')
  .setDescription('Edit a pending bet')
  .addStringOption(opt =>
    opt
      .setName('betid')
      .setDescription('The 5-char Bet ID (e.g. ABC12)')
      .setRequired(true)
      .setAutocomplete(true) // Autocomplete for pending bet IDs
  )
  .addStringOption(opt =>
    opt
      .setName('field')
      .setDescription('Which field to edit? (e.g., bookmaker, backOdds, commission)') // UPDATED description
      .setRequired(true)
      .setAutocomplete(true) // Autocomplete needs update in kellyIndex.js to include 'commission'
  )
  .addStringOption(opt =>
    opt
      .setName('value')
      .setDescription('New value for the field')
      .setRequired(true)
  );

const settleBetCommand = new SlashCommandBuilder()
  .setName('settlebet')
  .setDescription('Settle a pending bet')
  .addStringOption(opt =>
    opt
      .setName('betid')
      .setDescription('The Bet ID (5 chars, e.g. ABC12)')
      .setRequired(true)
      .setAutocomplete(true) // Autocomplete for pending bet IDs
  )
  .addStringOption(opt =>
    opt
      .setName('result')
      .setDescription('Result of the bet')
      .setRequired(true)
      .addChoices(
        { name: 'Win', value: 'win' },
        { name: 'Loss', value: 'loss' },
        { name: 'Push/Void', value: 'push' },
        { name: 'Partial Win', value: 'part-win' }
      )
  )
  .addNumberOption(opt =>
    opt
      .setName('userreturn')
      .setDescription('If partial-win, specify total amount returned (stake+profit)')
      .setRequired(false)
  );

const pendingBetsCommand = new SlashCommandBuilder()
  .setName('pendingbets')
  .setDescription('List all unsettled bets, with optional filters')
  .addStringOption(opt =>
    opt
      .setName('bookmaker')
      .setDescription('Filter by Bookmaker (optional, autocomplete)')
      .setRequired(false)
      .setAutocomplete(true) // Autocomplete for bookmakers
  )
  .addStringOption(opt =>
    opt
      .setName('sport')
      .setDescription('Filter by Sport (optional, autocomplete)') // Changed to autocomplete
      .setRequired(false)
      .setAutocomplete(true) // Use autocomplete for sports
  );

const statsCommand = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show stats with optional filters (Removed 2pc filter)')
  .addStringOption(opt =>
    opt
      .setName('time')
      .setDescription('Filter by time range')
      .setRequired(false)
      .addChoices(
          { name: 'Today', value: 'today' },
          { name: 'Yesterday', value: 'yesterday' },
          { name: 'Last 7 Days', value: '7days' },
          { name: 'Last 30 Days', value: 'lastmonth' }
       )
  )
  .addStringOption(opt =>
       opt.setName('sport')
          .setDescription('Filter by sport (autocomplete)')
          .setRequired(false)
          .setAutocomplete(true)) // Autocomplete for sport
  .addStringOption(opt =>
       opt.setName('bookmaker')
          .setDescription('Filter by bookmaker (autocomplete)')
          .setRequired(false)
          .setAutocomplete(true)) // Autocomplete for bookmaker
  .addBooleanOption(opt =>
      opt.setName('showdetails')
         .setDescription('List matching settled bets below summary?')
         .setRequired(false));

const unsettleBetCommand = new SlashCommandBuilder()
  .setName('unsettlebet')
  .setDescription('Revert a previously settled bet to pending status')
  .addStringOption(opt =>
    opt
      .setName('betid')
      .setDescription('The Bet ID (5 chars, e.g. ABC12)')
      .setRequired(true)
      .setAutocomplete(true) // Autocomplete for settled bet IDs
  );

// --- Alias Commands ---
const addAliasCommand = new SlashCommandBuilder()
    .setName('add_alias')
    .setDescription('Teach the bot a new bookmaker alias (e.g., PP = Paddy Power)')
    .addStringOption(opt =>
        opt.setName('alias')
           .setDescription('The shorthand/abbreviation (e.g., PP, WH, BFSB)')
           .setRequired(true))
    .addStringOption(opt =>
        opt.setName('full_name')
           .setDescription('The full, correct bookmaker name (e.g., Paddy Power, William Hill)')
           .setRequired(true));

const addSportAliasCommand = new SlashCommandBuilder()
    .setName('add_sport_alias')
    .setDescription('Teach the bot a new sport alias (e.g., fball = Football)')
    .addStringOption(opt =>
        opt.setName('alias')
           .setDescription('The shorthand/abbreviation for the sport (e.g., fball, nfl)')
           .setRequired(true))
    .addStringOption(opt =>
        opt.setName('full_name')
           .setDescription('The full, correct sport name (e.g., Football, NFL)')
           .setRequired(true));
// --- End Alias Commands ---

// --- Command Export List ---
const kellyCommands = [
  kellyCommand.toJSON(),
  newBetCommand.toJSON(),
  editBetCommand.toJSON(),
  settleBetCommand.toJSON(),
  pendingBetsCommand.toJSON(),
  statsCommand.toJSON(),
  unsettleBetCommand.toJSON(),
  addAliasCommand.toJSON(),
  addSportAliasCommand.toJSON()
];

module.exports = {
  kellyCommands
};