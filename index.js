const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const TOKEN = 'MTMxNzU0MDQ0OTg2MjQxODUzMg.GfG-kt.uVcUw7XQXkWn0OgP8UkdYfJkcPfATs0mMcj51U'; // Insert your token
const ALLOWED_CHANNEL_ID = '1317521318148702218'; // Allowed channel ID

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

const sessions = {};

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Helper Functions
function getAllPlayers(teams) {
    const players = [];
    for (const [teamName, playerArr] of Object.entries(teams)) {
        for (const p of playerArr) {
            players.push({ team: teamName, name: p.name, book_odds: p.book_odds, bb_odds: p.bb_odds });
        }
    }
    return players;
}

function combinations(arr, k) {
    const result = [];
    function backtrack(start, combo) {
        if (combo.length === k) {
            result.push([...combo]);
            return;
        }
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            backtrack(i + 1, combo);
            combo.pop();
        }
    }
    backtrack(0, []);
    return result;
}

function filterDistinctTeams(combos) {
    return combos.filter(combo => {
        const teams = combo.map(p => p.team);
        return new Set(teams).size === combo.length;
    });
}

function combinationBookOdds(combo) {
    return combo.reduce((acc, player) => acc * player.book_odds, 1);
}

function generateCombinations(teams, type) {
    const players = getAllPlayers(teams);

    let comboSize;
    let distinctTeamsRequired = false;

    switch (type) {
        case 'doubles':
            comboSize = 2;
            // distinctTeamsRequired = false for doubles
            break;
        case 'trixie':
            comboSize = 3;
            distinctTeamsRequired = true;
            break;
        case 'lucky15':
            comboSize = 4;
            distinctTeamsRequired = true;
            break;
        case 'canadian':
            comboSize = 5;
            distinctTeamsRequired = true;
            break;
        case 'heinz':
            comboSize = 6;
            distinctTeamsRequired = true;
            break;
        default:
            return [];
    }

    const teamCount = Object.keys(teams).length;
    if (distinctTeamsRequired && teamCount < comboSize) {
        return [];
    }

    let allCombos = combinations(players, comboSize);

    if (distinctTeamsRequired) {
        allCombos = filterDistinctTeams(allCombos);
    }

    const result = allCombos.map(combo => {
        const combined_odds = combinationBookOdds(combo);
        return {
            combo: combo.map(p => p.name),
            combined_odds: combined_odds
        };
    });

    result.sort((a, b) => b.combined_odds - a.combined_odds);

    return result;
}

// Send long messages by splitting at line boundaries if needed
async function sendLongMessage(channel, content) {
    const lines = content.split('\n');
    let currentMessage = '';
    for (const line of lines) {
        if ((currentMessage.length + line.length + 1) > 2000) {
            if (currentMessage.length > 0) {
                await channel.send(currentMessage);
            }
            currentMessage = line;
        } else {
            if (currentMessage.length > 0) {
                currentMessage += '\n' + line;
            } else {
                currentMessage = line;
            }
        }
    }

    if (currentMessage.length > 0) {
        await channel.send(currentMessage);
    }
}

async function showCombinationCategory(thread, teams, category) {
    const combos = generateCombinations(teams, category);
    if (combos.length === 0) {
        await thread.send(`No ${category} combinations available.`);
    } else {
        let response = `**${category.charAt(0).toUpperCase() + category.slice(1)} Combinations (Ordered by Combined Book Odds):**\n`;
        for (let i = 0; i < combos.length; i++) {
            const c = combos[i];
            const comboStr = c.combo.join(' & ');
            response += `${i+1}. ${comboStr} | Combined Odds: ${c.combined_odds.toFixed(2)}\n`;
        }
        await sendLongMessage(thread, response);
    }
}

function parsePlayerLine(line) {
    line = line.trim();
    const regex = /^(.*?)\s+(\d+(?:\.\d+)?)[\s]*[-/][\s]*(\d+(?:\.\d+)?)$/;
    const match = line.match(regex);

    if (!match) {
        return { error: true }; // Just indicate error, we'll skip the line
    }

    const playerName = match[1].trim();
    const bookOdds = parseFloat(match[2]);
    const bbOdds = parseFloat(match[3]);

    if (isNaN(bookOdds) || isNaN(bbOdds) || !playerName) {
        return { error: true };
    }

    return {
        player: { name: playerName, book_odds: bookOdds, bb_odds: bbOdds },
        error: false
    };
}

function parseBlock(blockText) {
    // blockText: first line team name, subsequent lines players
    const lines = blockText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
        return { teams: {}, error: "Not enough lines. First line is team name, then players." };
    }

    const teamName = lines[0].trim();
    if (!teamName) {
        return { teams: {}, error: "Team name line is empty." };
    }

    const teams = {};
    teams[teamName] = [];

    for (let i = 1; i < lines.length; i++) {
        const result = parsePlayerLine(lines[i]);
        // If error, we skip this line
        if (!result.error) {
            teams[teamName].push(result.player);
        }
    }

    // If no players were added due to skipping lines, that's still okay.
    // We do not return an error; we just have a team with no players.

    return { teams, error: null };
}

async function promptCombinationType(thread) {
    await thread.send("Which combinations would you like to see? (doubles/trixie/lucky15/canadian/heinz or 'done' to exit)");
}

// Bot Interaction Logic
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const content = message.content.trim().toLowerCase();

    if (content === '!start') {
        if (message.channel.id !== ALLOWED_CHANNEL_ID) {
            return; // ignore if not in allowed channel
        }

        try {
            const thread = await message.channel.threads.create({
                name: `Betting Session - ${message.author.username}`,
                type: ChannelType.PrivateThread,
                autoArchiveDuration: 60
            });

            sessions[thread.id] = {
                step: 'awaiting_block',
                teams: {},
                userId: userId
            };

            await thread.send(
                `${message.author}, please enter the first block of data.\n` +
                "First line = team name, subsequent lines = players.\n" +
                "Players: any text until first number, then '-' or '/', then another number.\n" +
                "Invalid lines are ignored.\n" +
                "Example:\n" +
                "Liverpool FC\n" +
                "TAA something 4.5 - 4.09\n" +
                "Cuenca 4.5 / 4.23\n" +
                "When you're done entering blocks, type 'finish'"
            );
        } catch (err) {
            console.error("Failed to create thread:", err);
            await message.channel.send("I couldn't create a private thread. Please check my permissions and try again.");
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.channel.type === ChannelType.PrivateThread && sessions[message.channel.id]) {
        const session = sessions[message.channel.id];

        if (message.author.id !== session.userId) {
            await message.channel.send("Only the user who started this session can input data.");
            return;
        }

        const lowerContent = message.content.trim().toLowerCase();

        switch (session.step) {
            case 'awaiting_block': {
                if (lowerContent === 'finish') {
                    // No teams yet?
                    if (Object.keys(session.teams).length === 0) {
                        await message.channel.send("No teams entered. Please enter a block of data or 'finish' to show combinations.");
                    } else {
                        // Move to combo selection
                        session.step = 'combo_menu';
                        await promptCombinationType(message.channel);
                    }
                } else {
                    // Parse this message as a block
                    const { teams, error } = parseBlock(message.content);
                    if (error) {
                        await message.channel.send(error + "\nPlease enter another block or type 'finish' if done.");
                    } else {
                        // Merge parsed teams (even if no valid players were found, team is added anyway)
                        for (const [tName, pArr] of Object.entries(teams)) {
                            session.teams[tName] = pArr;
                        }
                        await message.channel.send("Block added. Enter another block or type 'finish' when you're done.");
                    }
                }
                break;
            }

            case 'combo_menu':
                if (['doubles', 'trixie', 'lucky15', 'canadian', 'heinz'].includes(lowerContent)) {
                    await showCombinationCategory(message.channel, session.teams, lowerContent);
                    await promptCombinationType(message.channel);
                } else if (lowerContent === 'done') {
                    await message.channel.send("Session ended. Thank you!");
                    delete sessions[message.channel.id];
                } else {
                    await message.channel.send("Invalid choice. Valid options: doubles/trixie/lucky15/canadian/heinz or 'done'");
                }
                break;

            default:
                await message.channel.send("Something went wrong. Please type '!start' in the allowed channel to begin again.");
                delete sessions[message.channel.id];
        }
    }
});

client.login(TOKEN);
