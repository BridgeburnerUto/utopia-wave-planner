# Utopia Strategy Reference (Age 115)

This document is sent to Claude alongside kingdom intel for the "AI Strategy"
tab. It contains static game-mechanics context (races, personalities, and —
once available — wiki strategy notes on province management, internal
management, and external actions). Update this file when a new age starts
(numbers can change between ages).

## Strategy — Our Approach to War Planning (vocabulary & priorities)

**Vocabulary**
- **Pure T/M**: a thief/mage-focused province with minimal or no offense (low `aOff`). These are our (and the enemy's) economic/intel/spell backbone and the priority to protect. **A province with meaningful `aOff` (tens of thousands or more, capable of contributing real damage to a chain/attack) is an attacker, not a pure T/M — even if its `tDef` happens to be lower than other provinces.** Don't classify by `tDef` size alone; if `aOff` is non-trivial, list it as an available attacker (and a potential target's threat) rather than grouping it with the T/M anchors.
- **Unbreakable (UB)**: a province whose `tDef` is high enough that the enemy's best offense (with general bonus) cannot reach `minGensToBreak` — i.e. `canBreak` is false for every realistic enemy attacker. Goal: get our pure T/M provinces UB as early as possible.
- **Bloat target**: an enemy *attacker* (meaningful `aOff`, NOT a pure T/M) with low RPTA, weak Watchtowers, or heavy Castle investment — we deliberately let it grow (overpopulate) rather than land-grab, then punish via thievery (esp. Nightstrikes) instead of TM/Raze/Massacre, since castles make thievery more cost-effective than military ops against it. **Never classify a pure T/M as a bloat target** — pure T/Ms with offense too low to threaten us are simply left alone / hit with econ ops, not "bloat" (bloat specifically describes letting an *attacker's* population grow unchecked so Nightstrikes hit harder). **Personality/race matters**: Rogue and Mystic personality provinces (and Faery, which is Mystic-leaning) are almost always T/M-role provinces regardless of their raw `aOff` number — they very rarely fit the bloat-target role. Reserve "bloat target" for War Hero / Warrior / other offense-personality provinces with the low-RPTA/weak-WT/high-Castle profile.
- **Chain target**: an enemy province (usually a strong attacker — high RPTA, strong WTs, offense capable of breaking our high-def provinces) that we hit repeatedly with many of our provinces to push it over 100% pop, forcing its troops to leave home and neutralizing its offense.

**Four levers to win a war** (in order we evaluate them):
1. **Lower enemy offense** — chain their top attackers until overpopulated/troops-away.
2. **Lower enemy peon economy** — taking acres from pure T/Ms and high pop attackers reduces their living space → fewer peasants → less income/science/runes.
3. **Lower enemy T/M strength** — Drop defence via TM when needed, then massacre to lower tpa/wpa.
4. **Lower enemy NW** — keep their NW from drifting too far from ours (matters less during active war, but watch it so post-war RPNW stays favorable).

**Planning checklist when sizing up an enemy KD**:
1. **Compare top offense vs our top defense.** Identify enemy's top 5 highestest `Mod Off` provinces (with general bonus) and compare against our highest `tDef`. Count how many of *their* provinces we'd need to break/chain down before our pure T/Ms reach UB — this needs to be done as soon as possible in most cases.
2. **Assess their top defense (their pure T/Ms first).** Can we break it (`canBreak`)?
   - If yes: prioritize hitting it repeatedly (single or multi-hit) throughout the war — every hit lowers their def *and* their econ (via land/pop loss).
   - If no: decide whether to commit to the war anyway, lean on thievery/magic to wear them down, or settle for econ containment (RPNW/RKNW control) without trying to break them militarily.
3. **Classify enemy attackers** by RPTA, Watchtowers, and Castle investment:
   - Among *attackers* (meaningful `aOff`, War Hero/Warrior-type personality): low RPTA / weak WTs / high Castles → **bloat target**, leave it to grow, hit with Nightstrikes. (Pure T/Ms, and Rogue/Mystic/Faery provinces generally, are not bloat targets — see vocabulary above.)
   - High RPTA / strong WTs / offense that threatens our high-def provinces → **chain target**.
4. **Keep an eye on enemy NW** so it doesn't drift out of a favorable RPNW range (0.9–1.2 ideal per the gains formula above) — lower priority during active war, but relevant for sustained econ pressure and post-war positioning.

**Hybrid case — top threat with bloat-target economics**
A province can simultaneously be (a) the single biggest offensive threat to our
T/M anchors, and (b) a poor military-chain candidate due to bloat-target traits
(heavy Castle investment → weak TM gains, no/weak Watchtowers, low RTPA). When
both are true:
- **Do not chain it.** Treat it as a **rogue/thievery target** instead — use
  **Bribe Thieves**, **Nightstrike**, and **Propaganda** to grind down its
  `aOff` and `tDef` over time. If it has any Watchtowers (even weak ones),
  have a mage layer **Blizzard** on it to suppress them further — low/no WTs
  make our rogue ops land more reliably; high Castles make thievery more
  cost-effective than TM anyway.
- **Chain the next-highest threats instead** — provinces that *don't* have
  bloat economics are better TM/chain candidates because TM gains against them
  aren't blunted by Castles, and pushing them over 100% pop removes their
  troops from home (Lever 1) without the gains penalty.
- Re-evaluate the top threat after a few rounds of rogue ops — once its `aOff`/
  `tDef` drop enough, it may become safe to ignore (UB achieved) or become a
  viable chain target itself (if its Castle/WT profile hasn't improved).

**Output requirement:** when a province is flagged as a top threat AND a bloat
candidate, the report must say so explicitly and recommend the rogue/thievery
approach above — do not list it as both a Chain Target and a Bloat Target
without this reasoning, and do not silently pick one without noting the tradeoff.

**Planning checklist — additional step:**
   - If a province qualifies as BOTH the top threat AND a bloat candidate
     (high Castles / no WTs / low RTPA), see "Hybrid case" above — degrade it
     with Bribe Thieves / Nightstrike / Propaganda (+ Blizzard on its WTs if
     any), and chain the next-highest threats instead.

## Strategy — Spell/Thievery Combos (Playbook)

**Hollow-out combo (province-econ kill)** — *Highly effective, high commitment*
- Sequence: **Mind Vortex** (remove Night's Blessing) → **Meteor Showers** → **Chastity** → **Storms** on a growing/econ province. Finish with **Fireball (FB)** until the target reaches ~2 ppa.
- Why it works: Storms alone only kills ~1.5% of peasants, which Love & Peace would offset (raises birth rate to ~2.85%) — Chastity nullifies L&P's effect, and Meteor Showers pushes ppa down further. Once near 2 ppa, just maintaining Storms (occasionally MS) keeps it down.
- Once hollowed: layer in non-mystic ops — **Explosions**, **Greed**, **Riots** — for max damage.
- Monitor target's ppa via SoT/snatched SoT; if it creeps back up, hit with FB again.
- Caveat: moderately effective against Rogues — may push them toward Kidnap ops instead of their normally more damaging ops.

**Anti-attacker combo (Droughts + Sloth)** — *Low effectiveness, low commitment*
- **Blanket Droughts + Sloth** on enemy attackers, best timed with an active dragon.
- Stacking: dragon kills ~20% of draftees, Sloth -50% draft, Droughts -15% draft rate → combined ~66% draft reduction. Also reduces/kills horses.
- Cheap to cast (Droughts especially) — chained provinces and Heretics can pile on. Goal: deny the target the troops needed to replenish after a dragon kill.

**Kingdom-wide econ blanket (Riots + Blizzard + Greed)** — *High effectiveness, low commitment*
- Blanket **Riots**, **Blizzard**, **Greed** across the enemy kingdom. Cumulative/persistent economic damage — pays off if sustained over time.

**Pre-chain softening combo (classic T/M)** — *High effectiveness, medium commitment*
- Before chaining a target: **Gluttony**, **Rob the Granaries / Rob the Vermin**, **Droughts**, **Pitfalls**, **Greed**, **Bribe Generals**, **Riots**.
- Effect: troops sent out still draw wages even as peasants/income drop from land loss — can push the target into being unable to send troops out and force them to need aid.

**Amnesia wave** — *High effectiveness, high commitment, late-age only*
- Late-age advantage play: front-load **Amnesia** casts (10x per province needed before the effect meaningfully kicks in — early casts are negligible) for permanent early damage, using **Havoc**/**Sapphire** dragon windows to get as many provinces hit as possible at war start. Once amnesia lands, switch to hollowing ops (see above combo).
- Prerequisites for this to be worth it: late-age conditions — Alchemy >30%, Production >100%, Wages >20%, Crime >75%, Channeling >90%.

**Spell formulas**
- **Meteor Showers (MS)**: random damage, up to ~4% peasants, ~3% soldiers, ~1.5% military specialists, ~0.5% elites — affects only troops/population currently at home.
- **Tornado**: hits built buildings at ~3% average per cast; ignores barren acres.

## Strategy — Thievery Op Sizing & Mechanics

**Max thieves to send per op (rough shorthand, ignores thief losses)**

Intel ops (cheap, ~5% stealth each): Infiltrate, Snatch News, SoM, SoT, SoS, Survey — send **5%** of your thieves.

Sabotage ops:
- Arson — **100%** (also doubles as a way to estimate % barren land in target).
- Bribe Generals — **10 thieves**.
- Bribe Thieves — **10 thieves**.
- Free Prisoners — **2 per prisoner** you want freed.
- Incite Riots, Kidnap, Rob the Granaries, Rob the Towers, Rob the Vault — **use the rob calculator** before each op.
- Nightstrike — **20% of your thieves**, sized against the target's largest single troop stack (see NS mechanics below).
- Sabotage Wizards — set up via the rob-calc for Incite Riots, then switch the op to Sabotage Wizards before sending.

Rogue-only ops:
- Assassinate Wizards — **2 per enemy wizard** targeted.
- Greater Arson — **13 per building** targeted.
- Propaganda — **100%** of thieves (full send — see Propaganda notes below).
- Steal War Horses — **1 thief per 2 horses** the target has at home.

**Nightstrike (NS) mechanics**
- NS damage is applied **per troop "stack"** (each army/location shown separately on Military Affairs), not against the enemy's total troop counts.
- Official kill rates per thief: **soldiers 0.13, off-specs 0.0045, def-specs 0.006, elites 0.006**. Each stack's kills are also capped at a max-% of that stack (e.g. ~13% max for soldiers, ~0.3-0.55% max for specs/elites).
- Worked example: 150 thieves vs a province with stacks of 1,000 soldiers / 1,100 dspecs (home) and 500 ospecs / 1,000 elites (army #2) → kills ≈ 100 soldiers (13% cap not hit), 5 dspecs, ~3 elites split across the two elite stacks — message reads "killed 108 enemy troops".
- **Takeaway**: NS is most effective against targets with large home stacks of low-tier troops (soldiers); splitting troops across many small stacks (armies away) limits NS damage per stack.

**Kidnapping & peon control**
- Kidnap gains/damage are heavily affected by **MAP/GBP** — each MAP/GBP tier roughly **halves** your gains. Watch for a run of kidnaps where gains suddenly drop ~50% — that's the MAP/GBP tier boundary; once you hit it, switch ops.
- Good kidnap conditions: target has **more peons** (better for gains) or **fewer peons** (better for dealing damage), target is **in your NW range** (kidnap is RPNW-sensitive, see gains formula), **low MAP/GBP**, **low RTPA**, **low Watchtowers** (both for consistency).
- **Peon-control rotation**: alternate Kidnap and Fireball — kidnap until you see the ~50% gains drop (MAP/GBP tier), switch to FB until you see another notable drop, then switch back. Empirically this back-and-forth deals the most damage fastest. Lock in the damage with a **Chastity** cast (prevents birth-rate recovery for its duration).
- **Self-overpop caution**: when absorbing population via these ops, don't push your own pop% past **~115%**.
- **ToG (Tree of Gold?) prep**: before a ToG run, overpop yourself to ~110-115% via kidnapping first — can add 50%+ to the run's income gains.

**Propaganda**
- Highly RNG-sensitive; only converts troops **at home**. Thieves sent = your max possible gain, so send **100%**.
- Each cast has a 1/6 chance per troop-stack type (soldiers, ospec, dspec, elites, thieves, wizards) being the one converted; if it hits, you get a random %-of-stack (max % not empirically known). Elites convert at a lower rate than other types.
- **Setup checklist**: cast Invisibility + Guile if available; have a KD mate Bribe Thieves on the target; ideally MV the target to clear Clearsight/Patriotism; pick targets with **even troop levels** across ospec/dspec/elite at home and **lower RTPA/WTs** than you; aim for **2-3x your MTPA vs their RTPA** — with that ratio expect a **67%+ success rate**.
- Since you're full-sending thieves, stack up **-thief-losses** mitigations beforehand. Run propaganda **before new acres land** (dilutes your Thieves' Dens / TPA) — plan runs to land just before acre gains arrive.

## Strategy — Chaining

Chaining (repeated attacks on one target to push it over 100% pop) is the most common war strategy, but the goal and tactics differ depending on *why* you're chaining:

**1. Chain to bring down offense** (most common — targets the enemy's strongest attacker)
- Goal: push target to **+130% pop** and keep it there, so their troops desert and they have to release to send out again.
- **Never Massacre a chain victim being chained for this reason** — Massacre kills population, which *helps* them get back under the overpop threshold faster.
- Raze can help: early to level Forts (lowering DME), or late to slow their recovery after the chain ends.
- **Ambush** their attacks during the chain (their army is away — free acres + extra casualties).
- Realistic outcome: a strong attacker is rarely fully removed from the war, but the chain lowers their offense and NW enough to make them a viable side-hit target (low def) for others.
- Target selection: usually the enemy's **highest-offense attacker**; look for attackers who are already getting reduced incoming (failed attacks/massacres/razes against them) as good opportunities — they're already weakened.

**2. Chain to enable a Massacre** (targets hybrids or pure T/M)
- Some T/M-hybrid provinces have such high `tDef` that an attacker can only single-tap them with Massacre — which leaves *that attacker* exposed to being chained with no incoming.
- Normally you don't want to take acres from hybrids/pure T/Ms (it raises their TPA/WPA — makes them stronger per-acre). Chaining instead lowers their *defense* without taking land, making it safe to Massacre them afterward.
- Target: a hybrid or pure T/M with high `tDef` relative to what a single attack can break.

**3. Chain for pop control** (econ warfare — "econ wins wars")
- Semi-chains aimed at taking acres specifically **full of population** is the single most effective way to reduce enemy peon count → reduces their income/science/runes long-term (peon regrowth is slow; a follow-up Meteor Shower or Chastity locks the low-income state in).
- The opposite — taking acres from a province that's grown fast but hasn't filled with pop yet — is just "acre trading" and should only be done if you're badly chained yourself and need max gains to survive.
- **General rule for any non-targeted hit**: prefer the option with more population taken, even if it's fewer acres. E.g. given a choice between 100 acres from a 60%-pop province or 70 acres from a 100%-pop province, **take the 70 acres at 100% pop**.

## Strategy — Overpopulation Mechanics & Chain Depth Targets

Overpopulation = Total Population > Max Population (`pop% > 100`, see `_enemyPopPct`). Effects **stack** as pop% climbs — our chaining goal is to push victims as deep as possible, ideally to **Level 4 (140%+)**, because that's when they're forced to release armies (military pop > max pop) and lose the ability to attack again until they shed population/troops.

- **Level 1 — >100% (Peasant Desertion)**: peasants leave at `min(10% of peasants, overpop amount)`, minimum 10/tick; no new peasant births.
- **Level 2 — >115% (Military Desertion)**: all of Level 1, plus **army refuses to attack**, and troops (home AND away) desert at up to ~5.8%/tick (scales up to that cap). Soldiers absorb desertion first (up to 100% of it); off-specs/def-specs/elites desert at roughly equal % to each other. Deserters fill dungeons first if space allows, otherwise lost entirely.
- **Level 3 — >130% (Rioting)**: all of Level 1+2, plus **income -50%**.
- **Level 4 — >140% (Thieves on Strike)**: all of Level 1-3, plus **no thievery operations possible**.
- **Separate "Military on Strike" effect**: whenever *military population alone* exceeds max population, the army refuses to attack — this can trigger independently of the overall pop% levels above (e.g. a province with low peasant/wizard count but a huge military could hit this without being in Level 1-3).

**Chaining implication**: a target with **low incoming reinforcements/acres** (i.e. we keep taking land faster than they can recover) is the one most likely to get pushed to Level 4 — at that point their thieves stop working *and* their army can't attack, which is the ideal state for an offense-suppression chain (Chaining type 1). When picking chain targets, prefer ones where our combined wave can realistically sustain >140% pop, not just tip them over 100%.

**Estimating attacks needed to reach a target overpop level**

Given the target's current `land`, `totalPop` (peasants+totalTroops+thieves+wizards), `modLivingSpace` (and thus current `pop%` via `_enemyPopPct`), and `tNW`, the AI can estimate how many more hits are needed to cross a given pop% threshold (115/130/140%):

1. **Required land** to hit threshold `T%`: since `modLivingSpace ∝ land` (race/science multipliers constant), `pop% = totalPop / (land*k) * 100` where `k` = current `modLivingSpace/land`. Solve for the land level that makes `pop% = T`: `landTarget = totalPop / (k * T/100)`. The land that must be removed is `landDrop = land - landTarget`.
2. **Land removed per attack**: Traditional March base ~12% of land, capped at 20% of attacker's or defender's acres (whichever smaller) — adjust by RPNW/RKNW/relations/MAP modifiers from the Combat Formulas section. Raze removes ~5% of land (~30% of buildings in war) instead, with fewer modifiers.
3. **Iterate, don't assume a fixed %**: each successful TM hit shrinks `land`, which (a) shrinks `modLivingSpace` further (raising pop% even before any pop changes — overpop accelerates itself), and (b) shrinks `tNW`, shifting RPNW for subsequent attackers (see Chain Ordering section — this is why attacker order/staggering matters). So the AI should simulate hit-by-hit: after each hit, recompute `land`, `tNW`, `pop%`, and re-evaluate RPNW for the next attacker in the planned sequence, rather than dividing total `landDrop` by an average %.
4. **Population deserts too once >115%**: once Level 2 is crossed, troops/peasants start deserting (~5.8%/tick cap, scaling), which *also* lowers `totalPop` — partially counteracting further pop% gains from land loss but also weakening the target's defense for follow-up hits. The simulation should account for this if projecting multiple ticks of overpop, not just the immediate post-wave state.
5. **Output**: given attacker list (sorted by NW per Chain Ordering), simulate sequential hits and report the minimum number of hits (and which attackers) needed to cross 115%/130%/140%, plus the resulting `tNW` trajectory so RPNW/range can be checked for each attacker in the sequence.

## Strategy — Chain Ordering & Attacker Allocation

**Stagger by NW order for maximum gains**
- RPNW gains peak when attacker NW is within ±10% of the target's NW (see RPNW table above) — but every hit on a chain target lowers that target's NW (and land), so the *order* attackers hit in matters.
- Sequence attackers from **highest NW to lowest**: our highest-NW attacker should hit the chain target first (while its NW is still highest, keeping RPNW favorable), and *only continue hitting it* until the target's NW has dropped enough to fall into the next attacker's perfect RPNW range. At that point, hand off to the next-highest-NW attacker.
- This staggering means our top attacker's later hits (2nd, 3rd, 4th) on this target happen **later in the chain**, after lower-NW attackers have had their turn at perfect range — the goal is **everyone gets at least one good-gains hit**, not just the first attacker.

**Reserve top offense for breaking pure T/Ms first**
- Our highest-offense attacker may not participate in the chain at all if they're needed to break enemy high-defense pure T/M provinces (see Chaining section, type 2 — chain to enable a Massacre).
- Alternatively: spend the offense needed for that T/M-breaking job first, then send whatever offense remains into the chain target.

**Low-pop attackers should prefer Massacre/Raze over land grabs**
- Own provinces at **≤70% pop** should limit land gains (more land without pop to fill just lowers their pop% further) and instead favor **Massacre** and **Raze** attack types when hitting chain/wave targets.
- This overlaps with the My Orders attack-planning algorithm's `attackType()`/pop%-based pool thresholds (`poolRazeAllowed`, `poolRazeMassMax`, `poolTMMax`) — that section already encodes pop%-driven type selection for pool targets.

## Strategy — Using Nightmare (NM) to Chain

Nightmare puts ~1.5% of a province's home troops (including thieves) into 8h training, where they can't be released — forcing *other* (often offensive) troops to be released instead to maintain defense. This extends overpop duration and can pull offense down even on troops not directly targeted by the overpop itself.

**Setup sequence**:
1. **MV (Mind Vortex)** the target to strip defensive/utility spells: Royal Mist/Magic Protection/Greater Protection, Mist, Wraith, Magic Shield, Divine Shield.
2. If Night's Blessing gets MV'd off, follow up with **Droughts**.
3. Layer on **Pitfalls**, **Explosions**, **Blizzards**.
4. **Cast NM by NW** — prioritize provinces with the highest +spell-damage casters. Aim for **5-10 NM casts per target province** (each NM ≈ 1.5% of home troops including thieves into training). If that's not enough, follow up with **Nightstrike** once NMs are done to push defense lower.

**Timing notes**:
- NM **immediately lowers the target's NW** — watch that it stays in RPNW range for the attackers planned in the chain wave (out-of-range NW kills gains, per the RPNW table above).
- Troops in training return after 8h, so NM chains must be timed to land **no more than 1-2 ticks before your actual attack wave hits**.

## Races (10)

| Race | Key Bonuses | Key Penalties |
|------|-------------|---------------|
| Avian | -20% Attack Travel Time, -25% Military Wages, -25% Military Training Time | -5% Building Efficiency; no Stables/War Horses |
| Dark Elf | +35% Combat Instant Spell Damage, -35% Rune Cost | -15% Birth Rate |
| Dwarf | +30% Building Efficiency, -50% Building Construction Time | +10% Attack Travel Time; no Acceleration |
| Elf | +40% Wizards Per Acre, +1% Extra Mana Per Tick (war), +40% Land Effect Towers | -20% Thievery Per Acre |
| Faery | +25% Offensive Spell Duration, +20% WPA, +25% Self-Spell Duration, +1% Extra Mana | -5% Max Population |
| Halfling | +10% Max Population, +20% Thievery Per Acre, +1% Extra Stealth Per Tick | +10% Own Casualties (attack/defend) |
| Human | +2 Prisoner Capacity Per Acre, -30% Learn Attack Losses, +10% Science Effectiveness | +40% Rune Cost; reduced wage efficiency |
| Orc | +5% Battle Gains, +15% Battle Gains (War Only), -50% Draft Cost | -15% Defensive Military Efficiency |
| Undead | -100% Food Consumption, -45% Own Casualties (attack/defend), Plague Immunity | -10% Science Effectiveness |

## Personalities (12, 10 listed by source)

| Personality | Primary Focus | Key Bonuses |
|-------------|---------------|-------------|
| Artisan | Production | +40% Flat Rate Capacity/Production, +15% Science (multiple fields) |
| General | Military | -20% Training Cost/Time, +1 Army General, +15% Science (military fields) |
| Heretic | Magic/Theft Hybrid | +75% Guild Land Effect, +20% Combat Spell Damage, -50% Thief Losses |
| Mystic | Spellcasting | +25% Offensive Spell Duration, +125% Guild Land Effect, +1% Extra Mana |
| Necromancer | Dark Magic | +35% Wizards Per Acre, -50% Rune Cost, +5% Offensive Military Efficiency |
| Paladin | War Horses | +8 War Horse Capacity Per Acre, +7.5% Defensive Military Efficiency, Plague Immunity |
| Rogue | Thievery | +20% Thievery Per Acre, +100% Thieves' Den Effectiveness, +1% Extra Stealth |
| Tactician | Combat Strategy | -50% Ambush Losses, -15% Attack Travel Time, +25% Draft Rate |
| War Hero | Battle Efficiency | +70% Honor Bonus, +15% Honor Gains, Offensive Specialist +2 Strength |
| Warrior | Mercenaries | -50% Mercenary Cost, +15% Offensive Military Efficiency, +5 Prisoner/Mercenary Strength |

<!-- TODO: add 2 missing personalities once confirmed -->

## Strategy — Combat Formulas (Attacking & Defending)

**Military Efficiency**
- Base Military Efficiency = `(33 + 67 * (Effective Wage Rate/100)^0.25) * Ruby Dragon * Multi-Attack Protection Bonus`. Effective wage rate 20%→77.8% eff, 200%→112.7% eff. Effective wage rate moves slowly (~96h to converge) toward Wage Rate Paid.
- OME (Offensive Military Efficiency) = `(Base + Training Grounds Bonus + Honor Bonus) * Science * Race * Personality * Fanaticism * Bloodlust * Ritual`
- DME (Defensive Military Efficiency) = `(Base + Forts Bonus + Honor Bonus) * Science * Race * Personality * Minor Protection * Greater Protection * Fanaticism * Plague * Ritual`

**Offense**
- Raw Off = `Soldiers*(Soldier Off + Aggression) + OffSpecs*OffSpecAtk + Elites*EliteAtk + Horses*WarHorseAtk + Mercs/Prisoners*AtkValue`
- Mod Off = `Raw Off * (OME + General Bonus)`, General Bonus = **+5% per additional general over 1** (matches `calcAttacks`'s 0.05/extra-general assumption).
- Attack Time = `Base(7 intra-KD / 14 inter-KD hrs) * Race * Personality * Barracks * Quick Feet * AttackType * War(-15% after 12h of war) * NW Mod * Ritual`. NW Mod lengthens attack time the further your NW is from the target's (no effect intra-KD or in war).
- To guarantee a win: Mod Off ≥ Mod Def + 1 (Conquest only needs Mod Off ≥ 51% of Mod Def).

**Defense**
- Raw Def = `(DefSpecs*DefSpecPts(10 if inactive) + ElitesHome*EliteDef) + Soldiers*SoldDefPts*Aggression + TownWatch(Peasants/5 if no army home, else 0)`
- Mod Def = `MAX(Raw Def * DME, Land)` — i.e. **every acre has a minimum defense of 1**, so an attacker always needs at least Off = Land+1 to break a target regardless of how weak its army is (not for intra-KD).

**Gains (Traditional March / Conquest / Plunder / Learn)**
- `Gains = TargetResource * AttackType% * RPNW * RKNW * MAP * RaceMod * PersMod * CastlesProtection * RelationsMod * StanceMod * SiegeScience * EmeraldDragon * AttackTimeAdjFactor * RitualBonus * Anonymity * Mist`
- **RPNW** (rpnw = TargetNW/SelfNW): `rpnw<0.567→0`, `0.567–0.9→3*rpnw-1.7`, `0.9–1.1→1` (sweet spot), `1.1–1.6→-2*rpnw+3.2`, `>1.6→0`. → **best gains target NW within ±10% of your own.**
- **RKNW** (rknw = enemy KD avg prov NW / own KD avg prov NW): `<0.5→0.8`, `0.5–0.9→rknw/2+0.55`, `>0.9→1`.
- Attack Time Adjustment: arriving 1-4h late gives a gains bonus (+80%/+70%/+60%/+50% of `hours/baseTime`); arriving 1-2h early is a penalty.
- Traditional March: base 12% land, capped at 20% of attacker's or defender's acres (whichever smaller). Also yields Military Credits (`defPts*0.008*relNW*mod`) and Building Credits (`acresCaptured*0.4*relNW*mod`).
- Ambush: returns 50% of acres lost in a failed/away attack on you; defender defends at only 80% efficiency, no other mods; +15% casualties; ignores all gains modifiers; cannot ambush anonymous/war-spoiled/already-failed attacks.
- Plunder: base 50% gold / 60% food / 60% runes, max 1.75× base; defense casualties -50%.
- Learn: steals ~2% allocated + ~2% unallocated books; in War, additionally strips ~30-35% of allocated books for 48 ticks; defense casualties -50%.
- Raze: ~5% land destroyed (in war, ~30% of buildings instead); ignores all gains modifiers except Relations/MAP/AttackTimeAdj.
- Massacre: kills population instead of taking land; ignores most modifiers except RPNW, RKNW, Relations, MAP, AttackTimeAdj, and has its own Massacre Damage mod.
- Military Casualties: base 6.5-8.5% on offense, 5-6.5% on defense; Hospitals reduce all casualties.

## Strategy — Mystics / Magic

- Wizards need ≥5% Mana to cast. Mana regenerates daily, drops on cast; failed casts can explode and kill wizards.
- Rune Generation = `(Towers*12*RaceLandMod*PersLandMod*BuildingEff + Land*LandRuneGen) * ProductionScience * HonorMod * RitualMod * StanceMod`; 1.2% of stored runes decay per tick.
- Self-spell success depends on your Guild% and Building Efficiency. Offensive/support spell success depends on relative **Wizards Per Acre (WPA)** vs target, modified by race and Channeling science.
- Spell duration: nominal duration split into quarters — 1st quarter always applied; 2nd quarter scaled by (guild% [capped useful at 20%], relative NW, relations); final half scaled by that same factor × randomness.
- Hostile/Ritual/Offensive spells, and being on the receiving end of a successful support spell, each move the **Hostile Meter** by ~2%.
- Unfriendly/Hostile/War-only spells require minimum relations levels with the target.
- **Takeaway**: keep Guilds ≥20% and WPA competitive before relying on offensive magic (Sabotage Mana, Disband, Ambition-style spells); casting on enemies escalates the hostile meter, so coordinate with war timing.

## Strategy — Thievery

- Thieves need ≥5% Stealth Rating to operate; Stealth regenerates +3/day, drops per operation.
- Guild strength = **Thieves Per Acre (TPA)**, modified by Thieves' Dens, Crime science, and race; operation success depends on relative TPA (yours vs target's).
- Useful low-risk recon ops (very low difficulty, 0% meter movement, ~1% stealth cost): **Spy on Province** (resources/troop estimate), **Spy on Defense** (reveals Net Defensive Points at Home), **Spy on Exploration** (pool size & costs), **Snatch News** (target's Kingdom Paper — used by our `parseKdNews()` for enemy intel).
- **Infiltrate**: estimates enemy guild (wizard) size.
- Medium-difficulty offensive ops: **Sabotage Mana** (-5%/tick mana, requires Unfriendly+), **Destabilize Guilds** (Rogue only, -20% target self/offensive spell duration), **Rob the Granaries** (steal up to 31.5%/46% (war) of food at 95/135 bushels per thief), **Assassinate Troops** (kills troops + smaller elites/specialists, meter +0.24), **Incite Riots** (-15% income for several days, duration scales with thieves sent, meter +0.18, capped at 18 days), **Steal War Horses** (Rogue only, Unfriendly+, up to 20% of horses at 0.35/thief, attacker keeps only half).
- **Takeaway**: Snatch News + Spy on Defense are our primary low-cost intel-gathering ops (no meter cost) and should be run routinely on enemy targets; offensive ops (Sabotage Mana, Assassinate, Incite Riots, Steal Horses) raise the hostile meter and should be timed with planned attacks, not run idly.

## Strategy — Growth / Science / Military (general)

- **Growth**: building mix drives everything else — Homes (pop cap), Banks (income), Towers (runes), Guilds (wizards/spell duration), Forts/Training Grounds (def/off efficiency), Barracks (attack speed), Hospitals (casualty reduction), Thieves' Dens (TPA), Watchtowers (def). Percentage-based buildings have diminishing returns per additional building — diversify rather than maxing one type. Barren land lowers `ownPop`/living-space and is wasted NW; keep barren low except during deliberate land-grab phases.
- **Science**: prioritize Housing (raises max pop, used directly in our `ownPop` calc), Production (runes/income), Military (OME/DME), and Channeling (spell success) based on current strategy (growth vs war footing). Science books captured via Learn attacks should be reallocated toward whichever category supports the current plan.
- **Military composition**: balance offense (Soldiers/OffSpecs/Elites/Horses) vs defense (DefSpecs/Elites/TownWatch) based on role — front-line "off" provinces run pop% high with most troops sent out; "home" / def provinces hold high `tDef` to be unbreakable pool targets for enemies. Wage rate near 100% keeps Base Military Efficiency reasonable without overspending.

## Strategy — Relations, Hostile Meter, Overpopulation, MAP/GBP

- **Relations** gate which spells/thievery ops are usable (some require Unfriendly+ or War) and modify attack Gains (RelationsMod) — declaring/escalating war is itself a strategic lever, not just flavor.
- **Hostile Meter**: rises with offensive spells, ritual casts, thievery ops with nonzero meter movement, and attacks; high hostility can trigger relation downgrades toward war. Useful to track before planning a "soft" attack window vs an all-out war footing.
- **Overpopulation** (pop% > 100, see shared `_enemyPopPct`): provinces over 100% pop are vulnerable — they're "feeding" more mouths than their land supports, which is why our pool-expansion logic (`ownPop > 100` in `calcAttacks`) opens up *any* non-bloat enemy province as a target once our own province is overpopulated (use the excess off before it's wasted).
- **Multi-Attack Protection (MAP) / Generals-Based Protection (GBP)**: repeatedly attacking the same target in a short window reduces further Gains and boosts the target's effective Military Efficiency (`Multi-Attack Protection Bonus` in the Base Military Efficiency formula) — spread wave hits across multiple targets rather than re-hitting one province back-to-back where possible.

## Strategy — Dragons & Rituals

- **Dragons** are kingdom-wide buffs/debuffs that apply multiplicatively to combat formulas above (e.g. Ruby Dragon → Base Military Efficiency, Emerald Dragon → Gains). Check which dragon is active (own + enemy) before estimating TM gains or break feasibility — it's a global modifier our `_estimateTMGain`/`canBreak` calcs don't currently account for.
- **Rituals**: long-duration kingdom-wide spells (tracked via `ritual.js`/`getEnemyRitualCasting()`). An enemy ritual nearing completion (`ticksUntilLaunch` small) is a planning signal — either accelerate an attack before it lands, or expect a combat-modifier shift once it does. `ticksSinceStart` helps gauge how committed the enemy KD is to a ritual strategy.
