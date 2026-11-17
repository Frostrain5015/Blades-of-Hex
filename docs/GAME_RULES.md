# Blades of Hex - Complete Field Manual & Tactics Guide

Welcome to **Blades of Hex** (`v5.1.0`)! Whether you are commanding your first skirmish battalion or planning an amphibious invasion across contested straits, this chapter-by-chapter field manual covers every core rule, unit table, commander kit, culture doctrine, and practical battlefield tip drawn straight from the live game engine (`rules/`).

---

## Chapters

- [Chapter 1: Turn Structure & Victory Conditions](#chapter-1-turn-structure--victory-conditions)
- [Chapter 2: Economy, Territory & Production](#chapter-2-economy-territory--production)
- [Chapter 3: Terrain, Weather & Morale](#chapter-3-terrain-weather--morale)
- [Chapter 4: Combat Resolution, Ranks & Specializations](#chapter-4-combat-resolution-ranks--specializations)
- [Chapter 5: Unit Roster & Counter Triangle](#chapter-5-unit-roster--counter-triangle)
- [Chapter 6: Naval, Amphibious & River Warfare](#chapter-6-naval-amphibious--river-warfare)
- [Chapter 7: City Sieges, Construction & Air Operations](#chapter-7-city-sieges-construction--air-operations)
- [Chapter 8: Tactical Cards & Fog of War](#chapter-8-tactical-cards--fog-of-war)
- [Chapter 9: Commanders Roster](#chapter-9-commanders-roster)
- [Chapter 10: Historical Cultures](#chapter-10-historical-cultures)
- [Chapter 11: Double-Commander Faction Synergies](#chapter-11-double-commander-faction-synergies)
- [Chapter 12: Standard Map Families](#chapter-12-standard-map-families)

---

## Chapter 1: Turn Structure & Victory Conditions

- **Turn Order**: Active player factions rotate in randomized seat order each match, followed by the **Neutral AI** (`neutral`) faction on maps with neutral garrisons. One complete cycle of all active seats counts as **1 Round**.
- **Action Cadence**: Each unit may move (spending Movement Points up to its Speed) and act (attack, fortify, or activate skills).
- **Elimination (Standard Skirmish / Multiplayer)**:
  - A faction is defeated the moment it controls **0 land districts**. (Holding isolated coastal water ports alone will not keep a faction alive.)
  - In **3-player matches**, an eliminated faction's surviving units immediately transfer to Neutral AI control and its captured ports revert to neutral. The last surviving player wins.
- **Turn Limit Clock**:
  - **2-Player Skirmish**: Evaluated at **Round 19**.
  - **3-Player Skirmish**: Evaluated at **Round 26**.
  - The surviving non-neutral faction controlling the most cities wins. Tied city counts end in a **Draw**.
- **Campaign Mode**: Victory and failure follow each mission's scripted objectives rather than skirmish elimination or round limits.

> **Commander's Tip:** Keep one eye on the turn clock! As Round 19 (or Round 26 in 3-player games) approaches, a decisive city-count lead is all you need - switch to defending your exposed cities rather than throwing units away in reckless deep pushes. And remember: losing your last land district ends your run immediately, even if your navy still sails the seas!

---

## Chapter 2: Economy, Territory & Production

### Gold Income

| Income Source | Gold Per Turn | Notes |
| --- | --- | --- |
| 1st City | `$4` | `firstCityGold` |
| 2nd City | `$3` | `secondCityGold` (`$7` total with 2 cities) |
| Each Additional City | `$2` | `additionalCityGold` (`$9` for 3 cities, `$11` for 4, etc.) |
| Each Village | `$1` | `villageGold` (`villageMinDistance = 3` hexes) |

- **Neutral AI Economy**: Neutral factions total their city and village income and scale it by `NEUTRAL_ECONOMY_RATE = 0.2` (20%, floored once per turn).
- **Recruitment Rules**:
  - **Cities** recruit ground forces (plus Marines under US culture).
  - **Owned Operational Ports** recruit naval ships (Destroyer, Cruiser, Submarine, Carrier, Royal Battleship) and US Marines.
  - A city or port must be unoccupied and not disrupted by an Airstrike to recruit or build.
- **Commander Draft & Reroll**:
  - **Single-Commander Mode**: Pick `1` from `3` candidates.
  - **Double-Commander Mode**: Pick `2` from `5` candidates.
  - Reroll cost: **`$3`**.

> **Commander's Tip:** Villages may only pay `$1` each, but over a 15-round game, 3 early villages generate `$45` of extra funding - enough for multiple cruisers or airfields! Use fast Cavalry on Turns 1-2 to sweep neutral villages while keeping at least `$8` in reserve whenever an exposed front city needs an emergency Infantry garrison.

---

## Chapter 3: Terrain, Weather & Morale

### Terrain and Field Fortifications

| Terrain / Overlay | Defense Bonus | Movement Cost | Tactical Role |
| --- | --- | --- | --- |
| Plains | `0%` | `2` MP | Fast maneuver, open ground |
| Forest | `+5%` (`+15%` extra vs ranged) | `3` MP | Anti-artillery cover |
| Mountain | `+5%` | `6` MP | Natural choke barrier |
| Trench (`trench`) | `+25%` vs melee | - | Built by ground units to stop charges |
| Anti-Air Gun (`flak`) | `+30%` self AA | - | Built on-tile against air strikes |

> Total defense reduction from all sources is capped at **`85%`** (`minimumMultiplier = 0.15`).

### Morale States

| Level | Status | Attack Modifier | Combat Restrictions |
| --- | --- | --- | --- |
| `3` | High Morale | `+20%` | - |
| `2` | Normal | `0%` | - |
| `1` | Low Morale | `-20%` | - |
| `0` | Routed / Confused | `0%` | Cannot move, attack, or counterattack |

- **Flanking & Encirclement**: Threatening enemies on opposite/surrounding hexes apply positional morale penalties (`-1` when flanked, `-2` when surrounded). Positional penalties disappear the moment you break the encirclement.

### Weather Cycle

Matches always begin with **2 rounds of Clear weather** (`warmupRounds = 2`), then rotate through **2 rounds** of special weather followed by **1 round** of Clear weather.

| Weather | Battlefield Impact |
| --- | --- |
| **Clear** | Standard conditions; no modifiers. |
| **Rain** | Units in cities heal `15%` max HP/round; Infantry in cities gain `+10%` defense; Cavalry pay `+1` MP per step. |
| **Fog** | Artillery, ships, and fixed defense buildings lose `-1` range; Cavalry deal `+20%` damage and gain `+15%` charge/step (up from `+10%`). |
| **Wind** | Artillery gain `+1` range and `+20%` damage; Infantry suffer `-15%` defense. |
| **Blood Moon** | Enemies cannot heal; any unit at `<= 50%` HP takes `1/3` of its missing HP as true damage every full round. |

> **Commander's Tip:** Park Infantry in **Forests** (`+20%` total protection against Artillery fire) instead of standing on open Plains under enemy shells! And never underestimate **Flanking** - stepping around an enemy vanguard to drop its morale by `-1` or `-2` cuts its damage output AND lets your follow-up attackers trade safely (or even silence counterattacks completely if it hits `0` Confusion!).

---

## Chapter 4: Combat Resolution, Ranks & Specializations

### Combat Pipeline

- **Counter Multipliers**: Every matchup uses `1.25x` (advantage), `1.0x` (neutral), or `0.75x` (disadvantage). Advantage boosts upper damage variance and adds **`+40%` advantage crit bonus**, while disadvantage applies a **`-40%` float penalty**.
- **Infantry Urban Trait**: Infantry regenerate `10%` max HP per round inside cities and deal `+15%` bonus damage in city/urban combat.
- **Cavalry Momentum Charge**: Gains `+10%` damage per hex moved before attacking (`+15%` in Fog), up to `3` stacks (`maxChargeSteps = 3`).
- **Counterattacks**: Defenders within range strike back unless Confused (`morale = 0`) or freshly disembarked on land.

### Experience Ranks & Branch Specializations

- **XP Thresholds**: `[5, 15, 25, 35]` XP for Ranks 1 through 4.
- **Rank-Up Heal**: Every promotion restores **`25%`** of lost HP immediately.
- **Rank 1**: Unlocks a permanent 2-branch **Specialization**.
- **Rank 2**: Grants **`+15` Max HP** and **`+10` Attack** (structures are rank-locked).
- **Rank 4**: Grants **`+25%` Crit Bonus** and **`+15%` Max HP regeneration** every round.

| Base Unit | Specialization Option A | Specialization Option B |
| --- | --- | --- |
| **Infantry** | **Garrison Infantry** (`200` HP, `40` ATK, `10%` DEF, `4` SPD): `+10%`/`+20%` city regen; `15%`/`25%` first-hit damage reduction | **Assault Infantry** (`180` HP, `48` ATK, `5%` DEF, `6` SPD): `+20%`/`+35%` vs fortifications; heals `10%`/`20%` on kill |
| **Cavalry** | **Light Cavalry** (`150` HP, `55` ATK, `5%` DEF, `9` SPD): `10%`/`15%` charge/step (max 3); `+1` skirmish vision | **Heavy Cavalry** (`170` HP, `50` ATK, `10%` DEF, `5` SPD): `-25%`/`-40%` counter damage taken; `10%`/`15%` ranged pierce |
| **Artillery** | **Field Gun** (`100` HP, `60` ATK, `0%` DEF, `3` SPD): `8%`/`12%` armor pierce (doubled on terrain or Wind) | **Anti-Air Artillery** (`110` HP, `45` ATK, `5%` DEF, `4` SPD): `35%`/`50%` AA aura within `2` hexes |
| **Destroyer** | **Anti-Air Destroyer** (`140` HP, `40` ATK, `5%` DEF, `6` SPD): `35%`/`50%` AA aura within `2` hexes | **Anti-Sub Destroyer** (`150` HP, `40` ATK, `5%` DEF, `7` SPD): Reveals subs in `2` hexes; `+30%`/`+50%` vs subs |
| **Cruiser** | **Fleet Cruiser** (`200` HP, `55` ATK, `10%` DEF, `4` SPD): `+25%`/`+40%` vs ships; `25%`/`40%` chance for extra `50%` salvo | **Support Cruiser** (`180` HP, `60` ATK, `5%` DEF, `5` SPD, `3` RNG): `+50%` vs land; `25%`/`40%` chance for `30%` shore splash |

> **Commander's Tip:** Use the **Rank-Up Heal** (`25%` lost HP) tactically! If a veteran unit at 4/5 XP is bruised, finishing off a weak target pushes it to Rank 1 and gives it both an instant heal and a Specialization spike. Also match your Artillery specialization to the threat: pick **Anti-Air Artillery** as soon as the opponent invests in Airfields or Carriers!

---

## Chapter 5: Unit Roster & Counter Triangle

### Standard Units

| Unit | HP | ATK | DEF | SPD | RNG | Cost | Domain | Key Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Infantry** | `180` | `40` | `0%` | `4` | `1` | `$8` | Land | Captures cities/villages, shields artillery |
| **Cavalry** | `150` | `50` | `0%` | `8` | `1` | `$10` | Land | High-speed flanker, charges artillery |
| **Artillery** | `90` | `55` | `0%` | `3` | `2` | `$12` | Land | Ranged fire support & city wall breaker |
| **Bunker** | `200` | `40` | `5%` | `0` | `2` | `$10` | Land | Static choke anchor (rank-locked) |
| **Shore Battery** | `150` | `50` | `0%` | `0` | `2` | `$10` | Land | Anti-ship coastal gun (`+30%` vs ships) |
| **Tianyan Drone** | `75` | `30` | `0%` | `8` | `2` | `$5` | Land | Mobile recon / self-destruct skirmisher |
| **Destroyer** | `140` | `40` | `0%` | `6` | `1` | `$10` | Naval | Fast escort & submarine detector (`2` hexes) |
| **Cruiser** | `180` | `55` | `0%` | `4` | `2` | `$15` | Naval | Line warship & coastal bombardment |
| **Submarine** | `100` | `50` | `0%` | `8` | `1` | `$8` | Naval | Stealth ambusher against capital ships |
| **Carrier** | `250` | `45` | `8%` | `3` | `5` | `$20` | Naval | Long-range air strike platform |

### Counter Triangle (`1.25x` Advantage / `0.75x` Disadvantage)

- **Land**: **Infantry** > **Cavalry** > **Artillery** > **Infantry**. **Bunkers** counter Infantry & Cavalry (`1.25x`) but crumble to Artillery (`0.75x`).
- **Sea**: **Destroyer** > **Submarine** > **Cruiser** > **Destroyer**. Submarines also hit Carriers & Royal Battleships for `1.25x`.
- **Coast**: **Shore Batteries** deal `1.25x` advantage against every naval vessel class!

> **Commander's Tip:** Artillery (`90` HP) will vanish in one or two hits if left exposed to Cavalry charges! Always keep a screen of Infantry or Bunkers one hex ahead of your Artillery so Cavalry cannot reach your guns with a full 3-step charge.

---

## Chapter 6: Naval, Amphibious & River Warfare

### Cross-Domain Rules (`rules/naval.js`)

- **Ship vs Land**: `-50%` damage penalty (note: Cruisers and Battleships receive `+50%` Cannon Siege Bonus against city structural HP, restoring full baseline siege power).
- **Land vs Ship**: `-50%` damage penalty.
- **Shore Battery**: `+30%` damage vs ships, `-60%` vs land units, sharing a `2`-round cooldown with nearby batteries on construction.

### Transport & Embarkation Rules

When regular ground units (`speed > 0`, excluding Drones) move onto water, they board **Transport Ships**:
- **Speed cap**: **`4`** MP.
- **Combat drop**: Base Attack drops to **`20`**, Range locks to **`1`**.
- **Defense penalty**: **`-25%`** in shallow water and **`-50%`** in **deep water**!
- **Beach Embark Drain**: Stepping onto water from an open beach **drains all remaining movement** for the turn; embarking directly from a friendly **Port** waives the drain.
- **Landing Lock**: Units that disembark onto land cannot attack or counterattack during that transition turn.
- US **Marines** (`amphibious`) are the sole ground unit exempt from water stat drops and the `-50%` naval penalty.

### Submarines & Ports

- **Stealth**: Submarines cannot be targeted directly unless within `2` hexes of a friendly detector (`Destroyer`, `Royal Battleship`, or `Anti-Sub Destroyer`), or temporarily exposed for `2` rounds after firing from, capturing, or departing a port.
- **Ports**: Capturing a port locks it with **`1` round** of port guard (`portGuardRounds = 1`). Ships docked at friendly operational ports can repair HP.

### River Crossings (`rules/movement.js`)

- **Bridge**: `+0` extra movement cost.
- **Ford**: `+2` extra movement cost.
- **Direct Crossing (No Bridge/Ford)**: Immediately drains all remaining Movement Points upon crossing.
- **Flooded River Segment** (such as active River Valley floodgates): Completely impassable.

> **Commander's Tip:** Ground troops in **Transport State** are sitting ducks at sea (`20` ATK and up to **`-50%` defense** in deep water)! **Never send unescorted land armies across contested oceans.** Always sail **Destroyers** (to clear hidden Submarines!) or **Cruisers** ahead to screen your transports, embark through an owned **Port** whenever possible so you don't waste a turn frozen at the shoreline, and remember that units stepping ashore cannot strike until the next turn!

---

## Chapter 7: City Sieges, Construction & Air Operations

### City Structure HP & Captures (`rules/citySiege.js`)

- Every city has a shared structural HP pool: **`250` HP** at radius `0`, **`+200`** per outer urban ring (`450` at radius `1`, `650` at radius `2`), regenerating `10%` max HP every round.
- Garrisons gain up to **`+20%` defense** scaled linearly by remaining city HP ratio (a half-HP city only grants `+10%`).
- **Breaking & Entering**: An empty enemy or neutral city with `HP > 0` blocks unit movement onto it; attacking the tile directly damages its structural HP. Artillery, French Heavy Cannons, Katyushas, Cruisers, Royal Battleships, and Shore Batteries deal **`+50%` Cannon Siege Bonus** against city HP. Once city HP hits `0`, any ground assault unit can step in to claim the city and its district.

### Construction & Engineering (`rules/construction.js`)

| Construction | Normal Cost | Engineer Cost | Range | Build Time | Role |
| --- | --- | --- | --- | --- | --- |
| **Trench** | `$2` | `$1` | `0` | Instant | `+25%` melee defense on tile |
| **Anti-Air Gun** | `$2` | `$1` | `0` | Instant | `+30%` air damage reduction on tile |
| **Bunker** | `$10` | `$7` (instant!) | `1` | `1` turn | Durable `200` HP turret (min distance rules apply) |
| **Shore Battery** | `$10` | `$10` | `0` | Instant | Coastal anti-ship gun (`2`-round cooldown) |
| **Airfield** | `$10` | `$7` (garrisoned) | `0` | `1` turn | Unlocks air operations inside a friendly city |
| **Field Repair** | `$3` | `$3` | `1` | Instant | Engineer active: restores `50%` max HP to adjacent structure (`2`-round CD) |

### Airfield Commands & Anti-Air Coverage

Cities equipped with an operational **Airfield** project air power up to **`8` hexes** (grounded in Fog if an Air Force Colonel is mounted):

| Command | Cost | Cooldown | Range | Effect |
| --- | --- | --- | --- | --- |
| **Strafe** | `$4` | `2` | `8` | High single-target strike; adds `20%` of target's missing HP to attack (up to `+15`). |
| **Bombing** | `$5` | `2` | `8` | Target + adjacent `50%` splash; ignores `25%` DEF against strongpoints/fortresses. |
| **Airdrop** | `$10` | `3` | `8` | Drops an Infantry onto any empty land hex or breached (`0` HP) unoccupied city to capture it instantly! |
| **Recon** | `$4` | `2` | `8` | Clears Fog of War (`1`-`2` hex radius for `1`-`2` turns). |
| **Stuka Dive Bomb** | `$2` | `0` | `8` | **Germany exclusive**: `0.45x` single-target strike that inflicts **Fire Sea** (`5%` max HP/turn for `2` rounds). |

- **Anti-Air Bubble**: AA units (`Anti-Air Artillery`, `Anti-Air Destroyer`, `Royal Battleship`) protect friendly units within **`2` hexes**, stacking additively with on-tile **Flak** up to **`85%`** damage reduction (`ANTI_AIR_TOTAL_REDUCTION_CAP = 0.85`).

> **Commander's Tip:** Watch out for **Airfield Lethal Range**! **Strafe** converts missing HP into bonus ATK (up to `+15`), making it a ruthless finisher against bruised front-line commanders. Keep low-HP commanders inside a friendly **2-hex Anti-Air umbrella** or behind a Flak trench instead of resting them alone in range `8`! And never leave a `0`-HP city unguarded if the enemy owns an Airfield - an **`$10` Airdrop** can steal it out of thin air!

---

## Chapter 8: Tactical Cards & Fog of War

- **Card Economy**: Hand limit **`3`**, Draw cost **`$4`**, max **`2` draws** and **`2` plays** per turn.
- **20-Card Deck Pool**: `4x` Heal, `3x` Lightning, `2x` Bunker, `3x` Shield, `4x` Landmine, `2x` Imprison, `1x` Force March, `1x` Poison.

| Card | Target | Effect |
| --- | --- | --- |
| **Heal** | Friendly unit | Restores HP to an injured unit. |
| **Lightning** | Enemy unit | Direct strike damage (hits harder in Rain). |
| **Bunker** | Own empty district | Deploys a `200` HP / `40` ATK / `2` RNG Bunker. |
| **Shield** | Friendly unit | Grants `60` permanent Shield (absorbs hits before HP). |
| **Landmine** | Own empty hex | Plants a hidden Landmine (or Naval Mine on water). |
| **Imprison** | Enemy unit | Roots the target in place for its next turn. |
| **Force March** | Friendly unit | Immediately refunds `+2` Movement Points. |
| **Poison** | Enemy unit | `15%` max HP true damage at turn start (`3` turns), spreading to adjacent units! |
| **Orbital Strike** | Any visible hex | *Eagle Synergy card*: `3`-beam suppression + guaranteed-crit detonation (`110` center / `55` splash), ignoring AA & commander buffs. |

- **Fog of War Sight Ranges**:
  - **Cities**: `1` hex (`cityVisionRange = 1`).
  - **Units**: Infantry `1`; Cavalry `2` (`+1` with Light Cavalry); Artillery, Bunker, Shore Battery, Drone, Destroyer, Submarine `2`; Cruiser, Carrier, Royal Battleship `3`.

> **Commander's Tip:** Don't hoard all `3` card slots if you have lethal Poison or Heal targets waiting - **Poison** spreads to adjacent units at turn start, so either use it on tightly packed enemy formations OR pull your own poisoned troops **away from friendly clusters** so the toxin doesn't jump across your own army! Save **Force March** for turning a slow Infantry or Artillery into a surprise city capture.

---

## Chapter 9: Commanders Roster

Deploy commanders onto existing units (via `Deploy Commander` action) to add percentage HP/ATK bonuses, flat Speed, and signature active/passive skills.

| Commander | Deploy Stat Bonus | Signature Skills & Role |
| --- | --- | --- |
| **Advisor** | `+35%` HP, `+1` SPD | **[P] Psychological Attack**: Equal chance on hit for none, `-1` morale (`2`T), Confusion (`2`T), or **Defection** (Confusion if target is a commander). |
| **Astrologer** | `+30%` HP, `+20%` ATK | **[P] Night Watch**: `3`-hex aura treats weather as Clear. **[A] Star Shift** (CD `5`): Lock chosen weather for `2` rounds; penalties affect enemies only (doubled inside Night Watch). |
| **Berserker** | `+25%` HP | **[P] Blood Fury**: `+1%` ATK & DEF per `2%` max HP lost (max `+40%`). **[A] Crying Blood**: Spend `30%` current HP for `+30%` dmg, `+50%` crit, and `40%` adjacent splash on next strike. |
| **Centurion** | `+40%` ATK, `+1` SPD | **[P] Veteran**: `+100%` XP gain. **[P] Pursuit**: `30%` chance on attack (`100%` on kill, once/turn) to regain `+3` MP. |
| **Air Force Colonel** | `+30%` HP, `+30%` ATK, `+1` SPD | **[P] Air Superiority**: In airfield city/carrier, `+20%` air dmg, `+2` air range, `15%` AA pierce (grounded in Fog). **[P] Ace**: `+5%` air dmg per strike (max `6`). Adds `$3` Dive Strafe, `$4` Carpet Bomb, `$4` Airlift. |
| **Diplomat** | `+30%` HP, `+25%` ATK | **[P] Coalition**: Hand limit `+1`, card plays/turn `+1`. **[P] Counter-Plot**: In enemy/neutral land, `50%` chance to mirror enemy card plays. |
| **Engineer** | `+30%` HP, `+25%` ATK | **[P] Sapper Command**: Fortification discounts (`$1` Trench/Flak, `$7` instant Bunker, airfield discount in city). **[A] Field Repair** (CD `2`, `$3`): Heal adjacent building `50%` max HP. |
| **Fallen Angel** | `+35%` HP | **[P] Purification**: At Normal morale, White form heals `30%` lost HP/turn. **[P] Corruption**: At High/Low morale, Black form deals `+75%` dmg & `+60%` crit, losing `20%` current HP/turn. |
| **Iron Guard** | `+30%` HP | **[P] Aegis**: `120` Shield, regens `40`/turn. **[P] Guard Aura**: Self & adjacent allies gain `+10%` DEF and transfer damage to Iron Guard's Shield. |
| **Magician** | `+20%` HP | **[P] Thousand Faces**: `+25%` dmg vs countered types; `-15%` taken when countered. **[P] Metamorphosis**: Copies slain enemy's type & gains `+5%` dmg / `+10%` crit (max `6`). |
| **Martyr** | `+30%` HP | **[P] Martyrdom**: At `<= 1` HP survives (`cannot attack`, `cannot embark`), exploding at next turn start for ATK-based true dmg in `2` hexes. **[P] Elegy**: `+5%` dmg per friendly death (max `8`). |
| **Minister** | `+40%` HP | **[P] Garrison Farming**: While in a friendly city, generates `+$1 x Round` extra gold per turn (up to `$12`/turn). |
| **Necromancer** | `+25%` HP, `+20%` ATK | **[P] Soul Tether**: Dead allies leave Wraith tiles (`3`T) dealing `40%` missing HP + `20` true dmg/turn. **[P] Reanimate**: Raises up to `2` Spirit Thralls (`40%` HP / `70%` ATK). |
| **Paladin** | `+25%` HP, `+30%` ATK | **[P] Aura of Valor**: Self & adjacent allies deal `+12%` dmg and are immune to morale drop/Confusion. **[P] Oath**: Gains `1` stack/turn (`+5%` DEF, max `3`). **[A] Smite** (CD `1`): `25-40` or `65-85` true dmg. |
| **Priest** | `+30%` HP | **[P] Holy Lay**: Auto-heals adjacent allies `10%` & 2-hex allies `5%`/round. **[A] Prayer** (Dur `3`, CD `5`): Spend `50%` current HP for `2`-hex Healing Aura (`+35%` now, `+20%`/turn, saves lethal hit at `>=20%` HP). |
| **Staller** | `+30%` HP, `+20%` ATK | **[P] Stasis Field**: Enemies within `2` hexes pay `+2` MP/step; allies within `2` hexes gain `+25%` defense vs ranged. |
| **Tianyan** | `+30%` HP, `+15%` ATK, `+1` SPD | **[P] Observation**: `+1` Fog vision; `5`-hex drone radius. **[A] Deploy Drone** (`$5`, `1`/turn, max `2`): Spawns `75` HP / `30` ATK Drone. **[A] Self-Destruct**: Drone slams target in `3` hexes. |
| **Vampire** | `+20%` HP, `+40%` ATK | **[P] Bloodlust**: Heals `30%-60%` of attack damage dealt; `50%` of overheal becomes Shield (up to `60`). |

> **Commander's Tip:** Keep your **Minister** parked safely in a rear city rather than marching into crossfire - by Round 10, that single commander pays an extra `$10` every turn! Meanwhile, pair **Vampire** or **Centurion** with fast **Cavalry** for hit-and-run sustain, and put **Iron Guard** right beside your fragile Artillery or wounded heroes so its `120`-point refreshing shield soaks burst damage!

---

## Chapter 10: Historical Cultures

In **Historical Cultures** mode, each faction represents one of 8 iconic doctrines combining a Tier 1 signature unit (or air command) with a Tier 2 nation-wide passive:

| Culture | Tier 1 (Signature Unit / Strike) | Tier 2 (Faction Passive) |
| --- | --- | --- |
| **United States** | **Marine** (`180` HP, `54` ATK, `5%` DEF, `8` SPD, `$11`): Amphibious (`city` + `port` recruit), ignores `-50%` naval penalty, `+20%` vs coastal cities/ports/ships/batteries, reinforces in ports. | **Industrial Seapower**: `+1` naval MP; `-$1` cost (min `$1`) on recruitment, construction, airfields, reinforcement, ship repair, air commands, and card draws. |
| **United Kingdom** | **Royal Battleship** (`230` HP, `64` ATK, `10%` DEF, `4` SPD, `2` RNG, `$17`): Detects stealth (`2` hexes); `35%` (`50%` Rank 3) AA aura + `12%` naval dodge aura within `2` hexes. | **Never Surrender**: Stacks every `2` rounds for `+2.5%` ATK & DEF per stack (caps at `+10%` ATK, `+15%` DEF). |
| **France** | **Heavy Cannon** (`115` HP, `85` ATK, `0%` DEF, `2` SPD, `5` RNG, `$15`): Mobile/Deployed stances; `35%` splash, ignores naval penalty; deployed stance auto-fires at turn start. | **Indomitable Liberty**: On friendly crit taken or unit death, allies within `1` hex gain `+1` morale and `30` temp Shield (`2`-round CD). |
| **Soviet Union** | **Katyusha** (`100` HP, `48` ATK, `0%` DEF, `4` SPD, `2` RNG, `$13`): `3`-salvo barrage (`35%` splash) with `20%`/`10%` morale-drop chance/salvo. | **Iron Guard of Winter**: Artillery costs `-$1`; full immunity to negative weather effects. |
| **Republic of China** | **Central Training Brigade** (`210` HP, `42` ATK, `5%` DEF, `4` SPD, `$9`): With `>= 2` brigades on land, shares HP & healing; `+50%` terrain/city/fort DEF bonus; `+15%` damage aura. | **Every Inch of Land**: `+30%` max city HP; `-$1` fortifications; `-33%` city reinforcement cost. |
| **Chinese Soviet Area** | **Guerrilla Column** (`165` HP, `42` ATK, `5%` DEF, `5` SPD, `$8`): Ignores terrain & weather MP penalties; activates active Stealth (`2` MP) to infiltrate blind spots. | **Fish-Water Solidarity**: All units ignore terrain MP penalties; `-50%` village reinforcement cost; cities/villages reveal `6` hexes (**Underground Intelligence**). |
| **Germany** | **Stuka Dive Bomb** (`$2`, `0` CD): Global `0.45x` strike inflicting **Fire Sea** (`5%` max HP DoT for `2` rounds). | **Scorched Earth Airstrikes**: `-30%` Airfield cost; Stuka Dive Bomb and Bombing center hits inflict **Fire Sea**. |
| **Japan** | **Imperial Samurai** (`200` HP, `46` ATK, `5%` DEF, `5` SPD, `$9`): Cannot receive heals except city/village reinforcement; active **Banzai Charge** assassinates weakened targets. | **Eternal Martial Fortune**: `+20%` XP gain across all units; kills restore `20%` of missing HP. |

> **Commander's Tip:** Playing *against* a culture? Adapt to their spike! Catch **French Heavy Cannons** before they finish deploying, spread troops outside splash clusters against **Soviet Katyushas** and **German Fire Sea**, hunt down **Central Training Brigades** to break their shared-HP duo, and watch out for **Japanese Samurai** Banzai chains when your units dip below half health!

---

## Chapter 11: Double-Commander Faction Synergies

In **Faction Synergy** mode (Double Commanders enabled), drafting 2 commanders from the same faction unlocks a team-wide synergy (replacing the fallback **Fellow Robe** bonus):

| Synergy | Member Commanders | How It Triggers & Pays Off |
| --- | --- | --- |
| **Same Oath** (*Aurelia Kingdom*) | `ironGuard`, `minister`, `advisor`, `centurion`, `berserker` | Once per match, when one Aurelian commander takes lethal damage, the partner pays `20%` current HP to rescue them at `40%` max HP and grants both **Iris Protection** (`+30%` ATK, `+20%` DEF for `2` rounds). |
| **Oracle** (*Celestine*) | `priest`, `martyr`, `paladin`, `fallenAngel` | Requires `>= 2` distinct identities (`priest` & `martyr` share `sacredVessel`). Every full round smites the highest-ATK unit for `10%`/`30%`/`50%` max HP true damage (scales every `4` rounds) and grants the lowest-DEF unit an equal Shield. |
| **Orbital Support Protocol** (*Eagle Task Force*) | `colonel`, `engineer`, `tianyan` | Air & strongpoint damage (`300` threshold) triggers `+$10` **Orbital Supply** at turn start; enemy damage taken (`400` threshold) awards an **Orbital Strike** tactical card! |
| **Blood Tide & Blood Moon** (*Noctis Republic*) | `vampire`, `necromancer`, `magician` | Friendly crits charge Blood Tide (`125` threshold) to summon **Blood Moon** for `2` rounds (anti-heal on enemies + `1/3` missing HP bleed on `<= 50%` HP units). |
| **Sun-Moon Balance** (*Tianheng*) | `astrologer`, `staller`, `diplomat` | Recovers unused end-of-turn resources (`100` threshold) to fire **Sun-Moon Balance**: `40` Shield for all allies, high morale, `+30%` crit rate (`2` rounds), and `1`-round full-map reveal! |
| **Fellow Robe** (*Fallback*) | Any 2+ mixed-faction commanders | When living commanders come from different factions with no special synergy active, all living commanders gain **`+10%` Defense**. |

> **Commander's Tip:** For **Celestine**, pairing `priest` + `martyr` alone will **not** activate Oracle because both belong to the `sacredVessel` group - make sure at least one partner is `paladin` or `fallenAngel`! For **Noctis**, **Vampire** + **Fallen Angel** (or **Magician** with advantage crits) accelerates Blood Tide dramatically.

---

## Chapter 12: Standard Map Families

| Map ID | Display Name | Theater & Strategic Focus |
| --- | --- | --- |
| `crown-ring` | **Crown Archipelago** | Balanced combined-arms arena with a contested central continent, outer islands, and naval straits. |
| `uncharted-passage` | **Uncharted Passage** | Ocean-heavy island-hopping map centered around a strategic port district whose control transfers a prize **Carrier**. |
| `river-valley` | **River Valley** | Land theater split by alternating **Floodgates** that seal flooded river segments each cycle, rewarding control of bridges and fords. |
