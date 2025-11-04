# Discord Bot for Sports Analysis & Bankroll Management

This is a Node.js-based Discord bot designed to act as an interactive front-end for a sports trading and analysis suite.

It allows users to track bets, calculate optimal bet sizing using the **Kelly Criterion**, and manage a persistent virtual bankroll.

## Key Features

* **Complex Logic:** Implements the Kelly Criterion formula for sophisticated bankroll management.
* **Command Handling:** Provides a full suite of commands for users to interact with their betting data (e.g., `/bet`, `/stats`, `/bankroll`).
* **State Management:** Tracks all bets and bankroll changes by reading and writing to persistent JSON data files.
* **Modular Architecture:** The codebase is separated by concern (e.g., Bet Management, Bankroll Management, Commands, Logic) for maintainability and scalability.

## Technologies Used

* **Runtime:** Node.js
* **Libraries:** Discord.js (or relevant library)
* **Data:** JSON for persistent data storage
