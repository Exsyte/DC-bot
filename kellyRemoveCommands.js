// removeCommands.js
const { REST, Routes } = require('discord.js');

// Hardcode your own bot token & client ID:
const DISCORD_BOT_TOKEN = 'MTMyNDM0MTMzMjIyMjgwMzk5OA.GPyo2O.ltb-RoaIyv5x80V68YkD8o7XD8eXNm6eOuXmJo';
const DISCORD_CLIENT_ID = '1324341332222803998';

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log(`Removing slash commands for ${DISCORD_CLIENT_ID}...`);
    await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: [] }
    );
    console.log('Successfully removed all commands.');
  } catch (error) {
    console.error('Error removing commands:', error);
  }
})();