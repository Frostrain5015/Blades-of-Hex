# Blades of Hex Design Document
Version: 1.0  
Authors: Pan Hanyu (Game Mechanics Design, Frontend Development, Testing), Bu Rongyi (Design Document Writing)  
Last Modified Date: 2026-01-08

## 1. Document Overview
### 1.1 Document Purpose
This document details the design ideas, technical implementation, core rules, and expansion directions of this web-based game. It provides a unified design basis and reference standard for the game's development, maintenance, and iteration, while facilitating developers and testers to understand the core game logic.

### 1.2 Scope of Application
This document applies to all relevant personnel involved in the development, testing, and optimization of this turn-based strategy game, and can also serve as a design reference for subsequent functional expansions.

## 2. Overall Design Ideas
### 2.1 Core Positioning
Blades of Hex (Chinese transliteration: "Haikeshi Zhi Jian") is a web-based hexagonal grid turn-based strategy game. Centered on the confrontation between two major factions—"Red Army" and "Blue Army"—it combines two core strategic dimensions: "unit counter system" and "economic management" to create a lightweight, easy-to-learn yet strategically in-depth casual strategy experience.

### 2.2 Design Principles
1. **Lightweight**: Implemented based on pure frontend technology, no backend dependencies required. It can run directly in a browser, lowering the user threshold.
2. **Strategic Depth**: Strengthen strategic choices and weaken pure numerical crushing through the design of unit counter relationships, terrain (city) bonuses, and movement/attack rules.
3. **Clear Visual Feedback**: Use visual elements such as color gradients, damage/healing text, and highlight prompts (movable/attackable ranges, counter relationships) to allow players to clearly perceive changes in the game state.
4. **Intuitive Interaction**: Core operations (selecting units, moving, attacking, recruiting) can be completed with mouse clicks/hovers, conforming to casual game operation habits.

### 2.3 Core Interaction Logic
1. **Turn Cycle**: Player Operations (Move/Attack/Recruit) → End Turn → Switch Turns → Cycle until one faction meets the victory conditions and the game ends.
2. **Unit Operations**: Select own actionable unit → Display movable/attackable ranges → Execute move/attack → Mark unit as "Actuated".
3. **Economy and Recruitment**: Select own city tile to recruit units, consume corresponding gold coins. Newly recruited units cannot act in the current turn.
4. **Battle Settlement**: Attacker calculates damage → Target takes damage → Target triggers counterattack (if conditions are met) → Update unit health/survival status → Log battle information.

## 3. Technology Stack Description
### 3.1 Core Technology Stack
The game page adopts a layered design approach, with each layer performing its own duties and cooperating synergistically:
- **Structure Layer**: Builds the basic framework of the page based on HTML5, fully covering the structural construction of core elements such as canvas, UI components, and pop-ups.
- **Style Layer**: Completes the style definition of the entire page relying on CSS3, while implementing animation effects such as color gradients and pop-up transitions, and adapting to responsive layouts.
- **Logic Layer**: Uses JavaScript ES6+ to build the core game logic system, including the definition of unit and tile classes, calculation of battle values, management of turn processes, and handling of various interactive events.
- **Rendering Layer**: Specializes in the visual rendering of hexagonal maps and game units through Canvas 2D technology, and also realizes the rendering of battle effects such as damage text and range highlighting.

### 3.2 Reasons for Technology Selection
1. **Pure Frontend Implementation**: No reliance on backend servers, greatly reducing deployment and maintenance costs, perfectly aligning with the "lightweight" product positioning of casual games.
2. **Canvas 2D Rendering**: Compared with DOM rendering, it is more suitable for high-frequency rendering scenarios such as hexagonal grids and dynamic effects (e.g., damage text, color gradients) with better performance.
3. **Native JS + CSS**: Developed using native technology stack without additional framework dependencies, effectively reducing package size, improving page loading speed, and reducing technology stack complexity to facilitate subsequent iteration and maintenance.

## 4. Core Game Rules
### 4.1 Basic Rules
#### 4.1.1 Faction Rules
The game includes 3 factions: Red Army (Player 1), Blue Army (Player 2), and Neutral Faction. The initial turn belongs to the Red Army, and both sides take turns to operate. Each turn can perform operations such as "move units, attack enemies, recruit troops, end turn". Neutral faction units have no active operation rights and only trigger counterattacks when attacked. Neutral cities belong to the corresponding faction after being occupied.

#### 4.1.2 Map Rules
The map is built based on a hexagonal grid with a grid side length of 30px, divided into 5 administrative regions:
- Region 1 (Left): Red Army's initial administrative region;
- Region 2 (Right): Blue Army's initial administrative region;
- Region 0 (Middle): Core neutral administrative region;
- Region 3 (Upper): Upper neutral administrative region;
- Region 4 (Lower): Lower neutral administrative region;

The map contains 5 city tiles (Red Army City, Blue Army City, Middle Neutral City, Upper Neutral City, Lower Neutral City). City tiles have exclusive visual markers (★) and attribute bonuses. When the faction of a tile changes, a color gradient animation is triggered (1.5-second gradient duration) to intuitively reflect the change in tile ownership.

### 4.2 Operation Rules
#### 4.2.1 Unit Selection and Interaction
When the mouse hovers over a tile, the tile displays a semi-transparent highlight + yellow border to prompt the current hover target; click on an own "actionable" unit, the tile displays a yellow semi-transparent fill + bold yellow border, and simultaneously shows the unit's movable range (cyan highlight) and attackable range (red highlight).

#### 4.2.2 Movement Rules
The unit's movement range is determined by the unit's "speed" attribute (Infantry: 2 grids/turn, Cavalry: 3 grids/turn, Artillery: 1 grid/turn); click on an empty tile within the movable range to move the unit to that tile. Cavalry is marked as "Moved this turn" after moving (triggers damage bonus); units can still perform attack operations after moving (marked as "Actuated" after attacking, cannot move/attack again).

#### 4.2.3 Attack Rules
The unit's attack range is determined by the unit's "range" attribute (Infantry/Cavalry: 1 grid, Artillery: 2 grids); only enemy units within the attackable range can be attacked. Before the attack, a "Counter/Be Countered" prompt is displayed (green "Counter ↑", red "Be Countered ↓"); the attacker is marked as "Actuated" after the attack, and cannot perform movement/attack operations again.

#### 4.2.4 Recruitment Rules
Units can only be recruited on own city tiles. Before recruitment, select an own city tile (displays yellow semi-transparent highlight); recruitment consumes corresponding gold coins (Infantry: 30g, Cavalry: 40g, Artillery: 35g). Recruitment is not possible if gold coins are insufficient.

Newly recruited units are generated on the selected city tile and cannot act in the current turn.

#### 4.2.5 End Turn
Click the "End Turn" button to end the current faction's turn and switch to the opponent's faction. When switching turns, reset the "actionable" status, "counterattack times", and "moved this turn marker" of all own units; update the UI button color (matching the current faction's main color) after switching turns and record the log.

### 4.3 Battle Rules
#### 4.3.1 Damage Calculation Logic
Basic Damage Formula: Final Damage = Base Attack Power × Unit Counter Coefficient × Critical Strike Multiplier × Unit Trait Multiplier;

- Base Attack Power: Infantry 35, Cavalry 45, Artillery 60;
- Base Health: Infantry 120, Cavalry 100, Artillery 75;
- Unit Counter Coefficients:

| Attacker/Defender | Infantry | Cavalry | Artillery |
| --- | --- | --- | --- |
| Infantry | 1 | 0.75 | 1.25 |
| Cavalry | 1.25 | 1 | 0.75 |
| Artillery | 0.75 | 1.25 | 1 |

- Critical Strike Multiplier: Default 150% (180% for counterattacks). Critical strike rate adjusts with counter relationships:
  - Countering target: 40% critical strike rate;
  - Countered by target: 5% critical strike rate;
  - No counter relationship: 20% critical strike rate;

- Unit Trait Multipliers:
  - Cavalry [Hunting]: +10% damage dealt in the current turn after moving; additional +10% damage when on non-own administrative region tiles (additive);
  - Infantry [Fortitude]: -33% damage taken when on city tiles; counterattack critical strike rate increased to 66%; restores 20% maximum health at the end of each turn;
  - Artillery [Fragile]: +30% damage taken when attacked in melee by Infantry/Cavalry; targets cannot counterattack when attacked;

#### 4.3.2 Counterattack Rules
Counterattacks can only be triggered during melee attacks. Each unit can counterattack at most once per turn;

\[Base Counterattack Damage = Attack Power × 75\% × Unit Counter Coefficient\]

#### 4.3.3 Elimination and Survival
A unit is judged as eliminated when its health ≤ 0 and is removed from the tile.

Units can restore health through healing mechanisms (only passive healing mechanism is available in the current version: when any faction's Infantry unit is on a city tile, it restores 20% of maximum health in total per turn). Health cannot exceed its upper limit.

### 4.4 Economic Rules
#### 4.4.1 Initial Gold and Earnings
- Initial gold for both Red Army and Blue Army is 25;
- At the end of each turn, the player controlling cities receives a fixed economic reward of 15 gold coins × number of cities, which is used for the cycle of recruiting - battling - occupying more cities;
- Occupying a neutral city gives a one-time reward of 15 gold coins;
- When either Red or Blue Army occupies one of the opponent's cities, it automatically plunders 【50% × (1/opponent's original number of controlled cities) × opponent's original gold balance】 from the opponent.

#### 4.4.2 Gold Consumption
Recruiting units consumes corresponding gold coins. The recruitment button is disabled when gold coins are insufficient.

### 4.5 Victory Conditions
Core Victory Condition: Occupy all enemy cities; after the victory is triggered, a full-screen victory pop-up (gradient animation) is displayed, marking the winning faction and disabling all operations.

## 5. Game Objectives
### 5.1 Core Objective
Players achieve faction victory by reasonably planning "unit movement, unit recruitment, and attack strategies", utilizing unit counter relationships and terrain bonuses to occupy all enemy cities.

### 5.2 Phased Objectives
1. **Early Stage (Turns 1-3)**: Familiarize with unit attributes and movement/attack rules, complete the deployment of initial units, occupy surrounding neutral tiles, and accumulate gold coins;
2. **Mid Stage (Turns 4-10)**: Recruit targeted units (countering the enemy's main force), compete for neutral cities (obtain attribute/economic bonuses), and consume the enemy's effective strength;
3. **Late Stage (Turns 10+)**: Concentrate superior forces to break through the enemy's defense line, attack the enemy's core cities, and meet the victory conditions.

## 6. Future Development Directions
### 6.1 Functional Expansion
- Add "Resource Collection" tiles: New gold mine/supply tiles in the map, obtaining additional gold coins/unit healing after occupation;
- Add "Unit Upgrade" function: Improve unit attack power/health (requires consuming corresponding gold coins);
- Add "General" system: Assign generals to designated units. Units with generals gain attribute boosts and other special effects. A rich list of generals will bring greater strategic operation space to the game and improve gameplay richness;
- Add "Player vs AI" mode: Develop AI logic to support single players against the computer, increasing playability;
- Add "2-Player Online" mode: Realize cross-browser real-time 2-player battles based on WebSocket;
- Add "Levels": Design levels of different difficulties (e.g., defense levels, assault levels), each with exclusive victory conditions and rewards;
- Add "Special Units": Such as Medics (attack power 0 but can heal friendly units);
- Add more terrains: Special terrains such as Swamp (movement speed -1) and Highland (artillery damage +20%);
- Add "Weather" system: Randomly affect in-turn rules such as Rainy Day (artillery range -1) and Sunny Day (cavalry movement speed +1);

### 6.2 Experience Optimization
#### 6.2.1 Visual Experience
- Optimize the drawing precision of units/tiles and add unit illustrations (replacing text identifiers);
- Add battle effects (e.g., attack animations, unit death effects);

#### 6.2.2 Interactive Experience
- Add operation guidance (newbie guide pop-ups) to lower the threshold for new players;
- Optimize the log system: Support log filtering (battle-only/economy-only), log copying/clearing;
- Add "Undo Operation" function to reduce the cost of misoperations;

#### 6.2.3 Feedback Experience
- Add sound effects/background music (attack sounds, gold coin acquisition sounds, victory sound effects);
- Optimize the display effect of damage/healing text (e.g., enlarged critical strike text, color gradients);
- Add "Battle Report Statistics": Display data such as kills, gold coin acquisition, and tile occupation at the end of each turn;

### 6.3 Performance Optimization
#### 6.3.1 Rendering Optimization
- Implement Canvas "Dirty Rectangle Refresh": Only refresh changed areas (e.g., tiles where units move/attack) to reduce full-screen redraws; optimize the drawing logic of hexagonal grids to reduce repeated calculations (e.g., pre-cache tile coordinates); perform layered rendering of a large number of units/effects to improve drawing efficiency;

#### 6.3.2 Logic Optimization
- Optimize the calculation logic of "movable/attackable ranges" to reduce the number of loop traversals; cache game states to avoid repeated queries (e.g., pre-store all city tiles and own unit lists); implement object pool management for units/tiles to reduce performance loss from frequent object creation/destruction;

### 6.4 System Expansion
#### 6.4.1 Data Storage
- Use localStorage to store player battle records (number of victories, kills, cleared levels); support game progress saving/loading to avoid progress loss after page refresh;

#### 6.4.2 Configuration Transformation
- Extract unit attributes, map parameters, and rule coefficients (e.g., critical strike rate, damage multiplier) into independent configuration files (JSON) for balance adjustment; support custom rules (e.g., modify unit counter coefficients, recruitment costs) to improve game playability;

## 7. Declaration
The design specifications of the hexagonal grid coordinate system (axial coordinate) and the core rules of the turn-based strategy game in this work refer to works such as *European War* and *World Conqueror*.

This work uses artificial intelligence to assist in design, but does not use any third-party libraries, frameworks, or templates.
