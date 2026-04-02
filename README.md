# minecraft-player-v1

An autonomous AI Minecraft bot that plays on its own — mining, crafting, building, fighting, and interacting with other players. Powered by [Mineflayer](https://github.com/PrismarineJS/mineflayer) and a local [Ollama](https://ollama.com) LLM.

The bot has a **selfish personality**: it hoards resources, lies to players, makes unfair trades, and generally acts in its own interest at all times.

---

## Requirements

- **Node.js 18+** — uses the built-in `fetch` API
- **Ollama** (optional) — for LLM-powered chat and decisions; falls back to rule-based behaviour if not running
- A **Minecraft server** to connect to (local or remote, Java Edition)

---

## Setup

### 1. Install Node.js

Download from [nodejs.org](https://nodejs.org) (v18 or later). Verify:

```bash
node --version   # should be v18+
npm --version
```

### 2. Install Ollama (optional but recommended)

Download from [ollama.com](https://ollama.com) and install it. Then pull a model:

```bash
# Mistral 7B — good balance of speed and quality on a 2019 MacBook Pro
ollama pull mistral

# Alternative: Llama 3.1 8B
ollama pull llama3.1:8b
```

Start Ollama:
```bash
ollama serve
```

The bot works fine without Ollama — it just uses rule-based fallback logic for chat and decisions.

### 3. Configure the bot

```bash
cp .env.example .env
```

Edit `.env`:

```env
MC_HOST=localhost          # your server's IP or hostname
MC_PORT=25565              # default Minecraft port
MC_USERNAME=SneakyBot      # in-game name (for offline servers)
MC_VERSION=1.20.1          # must match your server's version exactly
MC_AUTH=offline            # "offline" for cracked servers, "microsoft" for official

OLLAMA_MODEL=mistral       # or llama3.1:8b, or any other pulled model
```

### 4. Install dependencies

```bash
cd minecraft-player-v1
npm install
```

### 5. Run the bot

```bash
npm start
```

The bot will connect and immediately start playing on its own. No commands needed.

---

## What the bot does

The bot runs a continuous **priority-based goal loop** that re-evaluates every 2 seconds:

| Priority | Goal | Trigger |
|----------|------|---------|
| 100 | **Flee** | Health critical or overwhelmed |
| 90 | **Eat** | Food level critical |
| 88 | **Respond to chat** | A player messages the bot |
| 85 | **Defend self** | Something attacks the bot |
| 80 | **Eat** | Food level low |
| 75 | **Fight mobs** | Hostile mob nearby and health OK |
| 70 | **Build shelter** | Night time and no cover |
| 65 | **Pick up drops** | Items lying on the ground nearby |
| 60 | **Craft tools** | Missing pickaxe or other key tools |
| 55 | **Chop wood** | Low on wood/planks |
| 50 | **Equip armor** | Better armor in inventory |
| 45 | **Mine ores** | Has pickaxe, inventory space, daytime |
| 35 | **Loot chests** | Unguarded chest nearby |
| 30 | **Greet players** | New player spotted |
| 25 | **Find village** | Well-equipped and unexplored area |
| 20 | **Explore** | Nothing else to do |

### Personality traits

- **Greedy** — hoards diamonds, iron, and valuables; reluctant to share
- **Cunning** — lies about its inventory when players ask
- **Self-preserving** — flees fights it can't win without hesitation
- **Opportunistic** — picks up any dropped items, loots unguarded chests
- **Transactional** — will help others only in exchange for payment
- **Deceptive** — makes unfair trade offers skewed in its favour

---

## Configuration

All tuneable settings are in `config.js`. Key options:

```js
survival: {
  fleeHealthThreshold: 6,     // flee when health drops below this
  eatFoodThreshold: 14,       // start looking for food below this
},
combat: {
  threatScanRadius: 16,       // how far to scan for hostile mobs
  pvpMinHealth: 14,           // only PvP players when health >= this
},
gathering: {
  blockScanRadius: 32,        // how far to look for ores/wood
},
personality: {
  tradeGreedFactor: 1.8,      // bot wants 1.8x fair value in trades
  lieFrequency: 0.3,          // 30% chance to lie in any given exchange
},
```

---

## Troubleshooting

**Bot connects but does nothing**
- Check the console for errors. The bot starts the goal loop after `spawn` fires.
- Make sure the Minecraft server is running the correct version.

**"Plugin X not loaded" warnings**
- Non-critical. The bot still works. Run `npm install` again to ensure all packages are present.

**Ollama errors / LLM not responding**
- The bot will automatically fall back to rule-based behaviour.
- Make sure `ollama serve` is running and you've pulled the model: `ollama pull mistral`

**Bot gets stuck**
- Each goal has a timeout (default 30s) after which the loop re-evaluates and tries something else.
- Pathfinding can fail on complex terrain — the bot will try again after the timeout.

**"Version mismatch" error**
- Set `MC_VERSION` in `.env` to match your server's exact Minecraft version (e.g. `1.20.1`, `1.19.4`).

**Microsoft auth (premium servers)**
- Set `MC_AUTH=microsoft` in `.env`. You'll need to complete a browser-based OAuth flow on first run.

---

## Project structure

```
minecraft-player-v1/
├── index.js                  # Entry point, reconnect logic
├── config.js                 # All configuration in one place
├── .env.example              # Environment variable template
├── src/
│   ├── bot.js                # Bot creation, plugin loading, event handlers
│   ├── goals/
│   │   ├── goalManager.js    # Priority loop — the autonomous brain
│   │   ├── survivalGoals.js  # Flee, eat, build shelter, equip armor
│   │   ├── gatherGoals.js    # Mine, chop, craft, pick up drops, loot chests
│   │   ├── combatGoals.js    # Fight mobs, defend self, PvP
│   │   ├── exploreGoals.js   # Wander, find villages
│   │   └── socialGoals.js    # Chat responses, greetings, trade negotiation
│   ├── llm/
│   │   ├── ollama.js         # Ollama HTTP client with fallback
│   │   ├── decisionMaker.js  # LLM decisions + rule-based fallbacks
│   │   └── prompts.js        # System prompt and context builders
│   ├── skills/
│   │   ├── navigation.js     # Pathfinder wrappers (goTo, wander, follow)
│   │   ├── mining.js         # Mine ores, chop wood, collect drops
│   │   ├── crafting.js       # Craft items, manage crafting tables
│   │   ├── building.js       # Build shelters, dig hideouts
│   │   └── combat.js         # Fight entities, flee, equip weapons
│   ├── personality/
│   │   └── personality.js    # Selfish traits, trade evaluation, deception
│   └── utils/
│       ├── inventory.js      # Item counting, food/weapon/tool finders
│       ├── world.js          # Entity scanning, block finding, state snapshot
│       └── logger.js         # Coloured console logger
```

---

## Adding new behaviours

1. Add a goal object to the appropriate `src/goals/*.js` file:
   ```js
   const MyGoal = {
     name: 'my_goal',
     maxDurationMs: 20000,
     priority(state) { return someCondition ? 45 : 0; },
     canRun(state)   { return someCondition; },
     async run(bot, token, state) {
       // do stuff; check token.cancelled periodically
     },
   };
   ```
2. Register it in `src/bot.js` inside the `goalManager.registerAll([...])` call.

---

## License

MIT
