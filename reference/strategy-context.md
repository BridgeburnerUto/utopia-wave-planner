# Utopia Strategy Reference (Age 116)

This document is sent to Claude alongside kingdom intel for the "AI Strategy"
tab. It contains static game-mechanics context (races, personalities, and —
once available — wiki strategy notes on province management, internal
management, and external actions). Update this file when a new age starts
(numbers can change between ages).

*Updated 2026-08-10 from "AGE 116 FINAL CHANGES". Age 116 runs Fri 7/24/26
18:00 → Sat 10/3/26 00:00.*

## Age 116 — Key Changes Summary

- **War Doctrines (new mechanic)**: each race grants a kingdom-wide bonus while at war. 1st province of a race: +2.0% doctrine strength; each additional: +1% (Elf, Faery, Halfling: +2% per additional); max 12.5%. Rewards stacking races — factor into KD-setup and wartime strength estimates.
- **Races**: Dryad added (defensive race: +12.5% DME, -40% def losses, +20% birth rate, no Forts). Most race kits reworked — see Races table.
- **Personalities**: Paladin removed; **Cleric** and **Sage** added. Kits reworked — see Personalities table.
- **Buildings**: Watchtower catch chance 2.0% → **2.2%**.
- **Science**: Shielding multiplier 0.0314 → **0.0350**; Valor 0.0582 → **0.0620**.
- **Spells**: Fireball peasant damage 4–7% → **5–7%**; Storms **1.75%**/tick (was 1.5%); Droughts food -25% → **-30%**, draft rate -15% → **-20%**; Chastity, Sloth, Magic Ward base duration 6 → **4 days** avg; Lightning Strike now race/personality-unique (Necromancer), no longer global.
- **Thievery**: Incite Riots income -15% → **-20%**; Bribe Thieves TPA -10% → **-12.5%**; Free Prisoners damage 17% → **25%**; Rob the Vaults war cap → **16%**; Kidnap war cap → **5%**; Destabilize Guilds duration cut -20% → **-25%**; Arson damage **+5%**.
- **Attacking**: Massacre peasant damage in war **+5%** (additive; thief/wizard damage unchanged). Out-of-war attack gain penalty raised 10% → **15%**.
- **Hostile meter**: decay reverts to pre-Age-111 behavior — decays on the 1st of each month by 20% or 3 points (whichever is greater); meter **no longer resets when entering war**. New FCF (forced ceasefire) rules for defenders — see Relations section.
- **Dragons**: reworked effects and per-6-tick damage ticks — see Dragons section. Dragons started outside war cost **+15%** gold/food.

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
- Sequence: **Mind Vortex** (remove Night's Blessing) → **Meteor Showers** → **Chastity** → **Storms** on a growing/econ province. Finish with **Fireball (FB)** until the target reaches ~2 ppa. (Age 116: FB peasant damage is now 5–7% per cast; Storms kills 1.75%/tick — both slightly stronger.)
- Why it works: Storms alone only kills ~1.75% of peasants per tick, which Love & Peace would offset (raises birth rate to ~2.85%) — Chastity nullifies L&P's effect, and Meteor Showers pushes ppa down further. Once near 2 ppa, just maintaining Storms (occasionally MS) keeps it down. **Age 116: Chastity base duration dropped from 6 to 4 days avg — recast more often to hold the lock. Elf-cast Chastity is far stronger (-70% birth rate via Arcane Mastery) — prefer Elf casters for this combo.**
- Once hollowed: layer in non-mystic ops — **Explosions**, **Greed**, **Riots** — for max damage.
- Monitor target's ppa via SoT/snatched SoT; if it creeps back up, hit with FB again.
- Caveat: moderately effective against Rogues — may push them toward Kidnap ops instead of their normally more damaging ops.

**Anti-attacker combo (Droughts + Sloth)** — *Low effectiveness, low commitment*
- **Blanket Droughts + Sloth** on enemy attackers, best timed with an active dragon.
- Stacking: dragon kills ~20% of draftees, Sloth -50% draft, Droughts -20% draft rate (Age 116, was -15%) → combined ~68% draft reduction. Also reduces/kills horses, and Droughts now cuts food -30%.
- Age 116 caveat: Sloth base duration dropped from 6 to 4 days avg — needs more frequent recasting to keep the blanket up.
- Cheap to cast (Droughts especially) — chained provinces and Heretics can pile on. Goal: deny the target the troops needed to replenish after a dragon kill.

**Kingdom-wide econ blanket (Riots + Blizzard + Greed)** — *High effectiveness, low commitment*
- Blanket **Riots**, **Blizzard**, **Greed** across the enemy kingdom. Cumulative/persistent economic damage — pays off if sustained over time. (Age 116: Incite Riots now cuts income -20%, up from -15% — this blanket got stronger.)

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
- Arson — **100%** (also doubles as a way to estimate % barren land in target). (Age 116: damage +5%.)
- Bribe Generals — **10 thieves**.
- Bribe Thieves — **10 thieves** (Age 116: now -12.5% target TPA, up from -10%).
- Free Prisoners — **2 per prisoner** you want freed (Age 116: damage raised 17% → 25%).
- Incite Riots, Kidnap, Rob the Granaries, Rob the Towers, Rob the Vault — **use the rob calculator** before each op. (Age 116 war caps lifted: Rob the Vaults to 16%, Kidnap to 5% — both ops hit harder in war.)
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
- **Spell support on a chain victim is limited to: Blizzard, Explosions, Pitfalls — nothing else.** Don't recommend Bribe Generals, Droughts, Gluttony, Rob the Granaries, Riots, etc. against a chain victim; those belong to the pre-chain softening combo (see Playbook) or to bloat/rogue targets, not to a province already being chained.
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
- **Level 4 — >140% (Thieves on Strike)**: all of Level 1-3, plus **no thievery operations possible**. (Age 116 exception: **Rogue** provinces keep thieving while overpopulated via Shadow Persistence — the Level-4 thief-shutdown payoff does NOT apply vs Rogues; vs a Rogue chain victim, Level 3 (130%) is the practical ceiling of what a chain denies them.)
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

## Races (10) — Age 116

War Doctrine = kingdom-wide bonus while at war, scaling with # of provinces of that race (1st: +2%, each additional: +1% — Elf/Faery/Halfling +2% per additional — max 12.5%).

| Race | Key Bonuses | Key Penalties | War Doctrine (in war, KD-wide, up to) | Unique Passive |
|------|-------------|---------------|----------------------------------------|----------------|
| Avian | -25% Attack Time, -25% Training Time, -25% Military Wages | No Stables/War Horses; +30% Rune Cost | -10% Attack Time, -12.5% Military Wages | Dive Bomb: off-specs +2 offense in war (no NW effect) |
| Dark Elf | +30% Offensive WPA, +30% Instant Spell Damage, can train Thieves with Specialist Credits | -15% Birth Rate; +30% Sabotage Damage taken | +12.5% Instant Spell Damage, -12.5% Rune Cost | Mystic Enthusiasts: successful offensive instant spells refund 30% rune cost |
| Dryad | +12.5% DME, -40% Defensive Military Losses, +20% Birth Rate | +10% Attack Time; +1 Rune Cost on Offensive Spells; cannot use Forts | +10% DME, -12.5% Defensive Casualties | Overgrowth: activatable +25% max pop for 3 days |
| Dwarf | +30% Building Efficiency, -50% Construction Time, -50% Construction Cost | No Acceleration; +90% Food Consumption | -12.5% Construction Costs, +12.5% Building Efficiency | Architect's Revenge: incoming Raze -15%, own Raze damage +20% |
| Elf | +40% WPA, +30% Offensive Spell Duration, +1 Mana/Tick (war) | +35% Draft Costs | -12.5% Enemy Sorcery Damage, +12.5% Spell Duration | Arcane Mastery: Elf Chastity = -70% birth rate; Elf offensive duration spells +2 ticks |
| Faery | +30% Self-Spell Duration, +20% WPA & TPA, +1 Mana Recovery/Tick | -5% Max Population; +15% Military Casualties | +12.5% Defensive WPA, -12.5% Enemy Thievery Damage | Leyline Interference: enemy spells vs Faery 15% chance to fail |
| Halfling | +12.5% Max Population, +30% TPA, +1 Stealth Regen/Tick | -25% Draft Speed | +12.5% Sabotage Damage, -12.5% Thief Losses | Silent Assault: sabotage ops suffer 50% fewer thief losses |
| Human | +30% Income, -30% Training Costs, +20% Draft Speed | +25% Military Wages | +12.5% Specialist Credit Gains, -12.5% Training Costs | Civil Administration: prisoners +2.0gc/tick, mercenary costs -40% |
| Orc | +10% Gains OOW / +15% Gains in War, +15% Enemy Military Casualties, -40% Draft Cost | +20% Instant Damage from Sabotage & Sorcery | +10% OME, +12.5% Raze Damage | Blood Spoils: successful attacks convert 25% of enemy casualties into Specialist Credits |
| Undead | -45% Military Losses, Plague Immunity (always carries Plague + chance to spread), No Food Requirement | Cannot build Hospitals | -12.5% Enemy Battle Gains, +12.5% Plague spread chance | Death March: converts 25% of offensive losses into Soldiers instantly |

**Race unit stats (off/def, nw; elite also gc cost)** — for offense/defense/NW estimates:

| Race | Off Spec | Def Spec | Elite | War Horse |
|------|----------|----------|-------|-----------|
| Avian | 12/0, 4.8nw | 0/10, 5nw | 16/2, 750gc, 6.5nw | n/a |
| Dark Elf | 14/0, 5.6nw | 0/12, 6nw | 16/2, 700gc, 6.5nw | 2/0, 0.6nw |
| Dryad | 10/0, 4.0nw | 0/11, 5.5nw | 16/3, 800gc, 7.0nw | 2/0, 0.6nw |
| Dwarf | 10/0, 4.0nw | 0/10, 5.0nw | 15/7, 900gc, 7.0nw | 2/0, 0.6nw |
| Elf | 10/0, 4.0nw | 0/13, 6.5nw | 14/4, 700gc, 7.0nw | 2/0, 0.6nw |
| Faery | 10/0, 4.0nw | 0/10, 5.0nw | 4/16, 1150gc, 8.5nw | 2/0, 0.6nw |
| Halfling | 11/0, 4.4nw | 0/10, 5.0nw | 10/13, 900gc, 7.5nw | 2/0, 0.6nw |
| Human | 15/0, 6.0nw | 0/12, 6.0nw | 15/5, 800gc, 7.0nw | 3/0, 0.9nw |
| Orc | 13/0, 5.2nw | 0/10, 5nw | 18/3, 850gc, 7.0nw | 2/0, 0.6nw |
| Undead | 11/0, 4.4nw | 0/10, 5.0nw | 16/4, 800gc, 7nw | 2/0, 0.6nw |

All races: Soldier 3/0, 0.75nw; Mercenary 8/0, 0nw; Prisoner 8/0, 1.6nw.

## Personalities (11) — Age 116

Age 116: **Paladin removed**; **Cleric** and **Sage** added.

| Personality | Primary Focus | Key Bonuses | Unique Passive |
|-------------|---------------|-------------|----------------|
| Artisan | Production | +25% Building Capacity (Homes/Stables/Dungeons), +25% Building Production (Banks/Farms/Stables/Towers/Homes), -25% Construction Costs (incl. Raze), immune to Greed/Incite Riots/Fool's Gold, +25% Economy Science; starts +600 Soldiers, +600 Spec Credits, +200 Building Credits | Masterful Craftsmanship: razing recovers 25% of buildings razed as Building Credits |
| Cleric | Defense | +1 Elite Def Value & +1 Def Spec Strength (both affect NW), -40% Instant Spell Damage taken, +25% Military Science; Salvation/Revelation/Divine Shield/Illuminate Shadows/Hero's Inspiration; starts +800 Soldiers, +800 Spec Credits | Divine Favour: self-spells have 50% chance of double duration |
| General | Military | +1 General, +2 Offensive Elite Strength (affects NW), -25% Training Cost & Speed, 1 Elite per 2 Spec Credits, +25% Military Science; Mist/Wrath; starts +800 Soldiers, +800 Spec Credits | General's Authority: attacks with 2+ generals inflict +15% enemy military casualties |
| Heretic | Magic/Theft Hybrid | +35% Offensive TPA & WPA, -50% Thief Losses, immune to Expose Thieves, +50% Guild Effectiveness, +25% Arcane Science; Nightmares/Fool's Gold/Vermin/Magic Ward; starts +400 Wizards, +400 Thieves | Arcane Frenzy: each successful attack gives +1 Mana & +1 Stealth for 5 ticks (refreshes, no stacking) |
| Mystic | Spellcasting | +100% Guild Effectiveness, +1 Mana Recovery/Tick, +25% WPA, +40% Channeling Science; Pitfalls/Meteor Showers/Chastity/Fool's Gold; starts +800 Wizards | Focused Channelling: above 40% mana, spells gain +20% WPA |
| Necromancer | Dark Magic | +25% WPA, +7.5% ME, -40% Rune Cost (not Ritual), +40% Channeling Science; Animate Dead/Mind Focus/Soul Blight/Nightmare/Guile/Lightning Strike; starts +400 Wizards, +400 Spec Credits | Dark Pact: after successful attacks converts enemy killed units — 10% → Wizards, 20% → Soldiers, 10% → Peasants |
| Rogue | Thievery | +100% Thieves' Den Effectiveness, +25% TPA, +1 Stealth Recovery/Tick, access to ALL thievery ops, +40% Crime Science; starts +800 Thieves | Shadow Persistence: **can perform thievery ops while overpopulated** (blunts our Level-4/140% "thieves on strike" chain goal vs Rogues) |
| Sage | Science | +20% Book & Scientist Generation, +50% Learn Protection, +15% Science Efficiency; Revelation/Fountain of Knowledge; starts +2 Scientists, +800 Soldiers, +800 Spec Credits | Focused Resolve: in war, science effects +1%/tick up to +15%; resets at war end |
| Tactician | Combat Strategy | -20% Attack Time, +40% Spec Credit Gains, +40% Draft Speed, no thieves lost on intel, +40% Siege Science; Clearsight; starts +800 Soldiers, +800 Spec Credits | Interdiction: successful war attacks destroy 15% of target's gold, runes, and food |
| Warrior | Mercenaries | +15% OME, +5 Mercenary & Prisoner Strength, mercs/prisoners sendable at 1 per 4 normal troops, +35% Tactics Science; starts +800 Soldiers, +800 Spec Credits | Battle Cry: successful attacks destroy 1.5% of target's entire population |
| War Hero | Battle Efficiency | +10% Battle Gains (war only), -25% Honor Loss, +100% Honor Effects, Off Spec +2 Strength (affects NW), +40% Valor Science; Quick Feet/Righteous Aggressor/Hero's Inspiration; starts +800 Soldiers, +800 Spec Credits | Hero's Culling: Massacres kill an additional 7% peasants and 2.5% thieves & wizards |

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
- Age 116: out-of-war attack gain penalty raised from 10% to **15%** (RelationsMod when not at war).
- **RPNW** (rpnw = TargetNW/SelfNW): `rpnw<0.567→0`, `0.567–0.9→3*rpnw-1.7`, `0.9–1.1→1` (sweet spot), `1.1–1.6→-2*rpnw+3.2`, `>1.6→0`. → **best gains target NW within ±10% of your own.**
- **RKNW** (rknw = enemy KD avg prov NW / own KD avg prov NW): `<0.5→0.8`, `0.5–0.9→rknw/2+0.55`, `>0.9→1`.
- Attack Time Adjustment: arriving 1-4h late gives a gains bonus (+80%/+70%/+60%/+50% of `hours/baseTime`); arriving 1-2h early is a penalty.
- Traditional March: base 12% land, capped at 20% of attacker's or defender's acres (whichever smaller). Also yields Military Credits (`defPts*0.008*relNW*mod`) and Building Credits (`acresCaptured*0.4*relNW*mod`).
- Ambush: returns 50% of acres lost in a failed/away attack on you; defender defends at only 80% efficiency, no other mods; +15% casualties; ignores all gains modifiers; cannot ambush anonymous/war-spoiled/already-failed attacks.
- Plunder: base 50% gold / 60% food / 60% runes, max 1.75× base; defense casualties -50%.
- Learn: steals ~2% allocated + ~2% unallocated books; in War, additionally strips ~30-35% of allocated books for 48 ticks; defense casualties -50%.
- Raze: ~5% land destroyed (in war, ~30% of buildings instead); ignores all gains modifiers except Relations/MAP/AttackTimeAdj.
- Massacre: kills population instead of taking land; ignores most modifiers except RPNW, RKNW, Relations, MAP, AttackTimeAdj, and has its own Massacre Damage mod. (Age 116: +5% peasant damage in war, additive; thief/wizard damage unchanged. War Hero passive adds a further +7% peasants / +2.5% thieves & wizards.)
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
- Medium-difficulty offensive ops: **Sabotage Mana** (-5%/tick mana, requires Unfriendly+), **Destabilize Guilds** (Rogue only, -25% target self/offensive spell duration — Age 116, was -20%), **Rob the Granaries** (steal up to 31.5%/46% (war) of food at 95/135 bushels per thief), **Assassinate Troops** (kills troops + smaller elites/specialists, meter +0.24), **Incite Riots** (-20% income for several days — Age 116, was -15% — duration scales with thieves sent, meter +0.18, capped at 18 days), **Steal War Horses** (Age 116: listed in Human's kit; Rogues retain it via all-ops access; Unfriendly+, up to 20% of horses at 0.35/thief, attacker keeps only half).
- **Takeaway**: Snatch News + Spy on Defense are our primary low-cost intel-gathering ops (no meter cost) and should be run routinely on enemy targets; offensive ops (Sabotage Mana, Assassinate, Incite Riots, Steal Horses) raise the hostile meter and should be timed with planned attacks, not run idly.

## Strategy — Growth / Science / Military (general)

- **Growth**: building mix drives everything else — Homes (pop cap), Banks (income), Towers (runes), Guilds (wizards/spell duration), Forts/Training Grounds (def/off efficiency), Barracks (attack speed), Hospitals (casualty reduction), Thieves' Dens (TPA), Watchtowers (def — Age 116: catch chance raised 2.0% → 2.2% per WT, so WTs are slightly better vs thievery). Percentage-based buildings have diminishing returns per additional building — diversify rather than maxing one type. Barren land lowers `ownPop`/living-space and is wasted NW; keep barren low except during deliberate land-grab phases.
- **Science**: prioritize Housing (raises max pop, used directly in our `ownPop` calc), Production (runes/income), Military (OME/DME), and Channeling (spell success) based on current strategy (growth vs war footing). Science books captured via Learn attacks should be reallocated toward whichever category supports the current plan. (Age 116: Shielding multiplier raised 0.0314 → 0.0350; Valor 0.0582 → 0.0620 — both slightly more book-efficient.)
- **Military composition**: balance offense (Soldiers/OffSpecs/Elites/Horses) vs defense (DefSpecs/Elites/TownWatch) based on role — front-line "off" provinces run pop% high with most troops sent out; "home" / def provinces hold high `tDef` to be unbreakable pool targets for enemies. Wage rate near 100% keeps Base Military Efficiency reasonable without overspending.

## Strategy — Relations, Hostile Meter, Overpopulation, MAP/GBP

- **Relations** gate which spells/thievery ops are usable (some require Unfriendly+ or War) and modify attack Gains (RelationsMod) — declaring/escalating war is itself a strategic lever, not just flavor.
- **Hostile Meter**: rises with offensive spells, ritual casts, thievery ops with nonzero meter movement, and attacks; high hostility can trigger relation downgrades toward war. Useful to track before planning a "soft" attack window vs an all-out war footing.
- **Age 116 hostile-meter changes**: decay reverts to pre-Age-111 behavior — points decay on the **1st of each month** by 20% or 3 points, whichever is greater; and the meter **no longer resets when entering war** (meter built up pre-war persists through and after it — plan hostility spend accordingly).
- **Age 116 FCF (forced ceasefire) rules** — a defender can FCF an aggressor when ALL hold: defender is 30 points (in-range) / 15 points (out-of-range) below the aggressor on the hostility meter; defender is not Hostile toward the aggressor KD; no attacks made against the aggressor for 3 ticks; defender is lower in BOTH land and NW than the aggressor. If within war range (15% NW or land) the FCF costs the defender 2% Honor and 2% Science; out of range it's free. Duration: 96h out-of-range / 72h in-range before either KD can cancel. **Implication**: when farming a smaller KD, watch the meter gap and tick timing — a well-timed FCF can shut the window; conversely FCF is our escape hatch if we're the smaller side being pressured.
- **Overpopulation** (pop% > 100, see shared `_enemyPopPct`): provinces over 100% pop are vulnerable — they're "feeding" more mouths than their land supports, which is why our pool-expansion logic (`ownPop > 100` in `calcAttacks`) opens up *any* non-bloat enemy province as a target once our own province is overpopulated (use the excess off before it's wasted).
- **Multi-Attack Protection (MAP) / Generals-Based Protection (GBP)**: repeatedly attacking the same target in a short window reduces further Gains and boosts the target's effective Military Efficiency (`Multi-Attack Protection Bonus` in the Base Military Efficiency formula) — spread wave hits across multiple targets rather than re-hitting one province back-to-back where possible.

## Strategy — Dragons & Rituals

- **Dragons** are kingdom-wide buffs/debuffs that apply multiplicatively to combat formulas above (e.g. Ruby Dragon → Base Military Efficiency, Emerald Dragon → Gains). Check which dragon is active (own + enemy) before estimating TM gains or break feasibility — it's a global modifier our `_estimateTMGain`/`canBreak` calcs don't currently account for.

**Age 116 dragon effects** (dragons started outside war cost +15% gold/food):

| Dragon | Ongoing debuffs | Arrival + tick damage |
|--------|----------------|------------------------|
| Amethyst | -40% Spell Success, -40% Thievery Success (sabotage ops) | On arrival strips ALL active self-spells instantly; every 6 ticks kills 5% of wizards & thieves |
| Emerald | +25% Military Casualties, -25% Combat Gains | Destroys 3.5% of at-home troops on arrival; every 6 ticks: 1.5% of at-home troops lost, Building & Specialist Credits -40% |
| Ruby | -12.5% Military Effectiveness, +20% Military Wages | Destroys 3.5% of off+def specialists on arrival; every 6 ticks 2.5% of at-home troops desert |
| Topaz | -25% Building Efficiency, -25% Income | Destroys 10% of buildings on arrival; every 6 ticks destroys 10% of buildings and 20% of current gold |
| Sapphire | -35% WPA & TPA, -1 Mana Recovery, -1 Stealth Recovery, +12.5% instant spell/sabotage damage taken & -12.5% dealt | Destroys 30% of runes on arrival; every 3 ticks destroys 25% of current runes |

- **Planning notes**: Ruby's specialist kill + desertion pairs with our Droughts+Sloth anti-attacker combo (deny replenishment after the kill). Sapphire's rune wipe + WPA/TPA cut is the anti-T/M dragon — expect our spell/thievery success to crater under an enemy Sapphire, and time Amnesia/hollow-out pushes to our own Sapphire/Havoc windows. Amethyst's self-spell strip re-opens targets for MV-dependent combos without spending MV casts.
- **Rituals**: long-duration kingdom-wide spells (tracked via `ritual.js`/`getEnemyRitualCasting()`). An enemy ritual nearing completion (`ticksUntilLaunch` small) is a planning signal — either accelerate an attack before it lands, or expect a combat-modifier shift once it does. `ticksSinceStart` helps gauge how committed the enemy KD is to a ritual strategy.
