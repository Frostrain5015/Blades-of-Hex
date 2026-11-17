#!/usr/bin/env python3
"""
Dual-Head Policy + Q-Value Scorer (112-dim Multi-Unit Synergy + Style-Conditioned MLP).
Trained jointly on:
  1) Human Behavioral Cloning replays (style-fingerprinted, held-out val match untouched)
  2) Self-Play DAgger winner/specialist trajectories + discounted terminal outcome values V*(s, a)

Outputs runtime JSON weights directly consumed by ai/core/hybridScorer.js:
  schema: "blades-of-hex.policy-value.v2"
"""

import argparse
import json
import math
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

ACTION_TYPES = [
    "move",
    "attack",
    "tacticalCard",
    "recruit",
    "airCommand",
    "drawCard",
    "reinforce",
    "repairShip",
    "chooseSpecialization",
    "activateSkill",
    "buildAirfield",
    "buildFortification",
    "heavyCannonStance",
    "guerrillaConcealment",
    "droneSuicide",
    "endTurn",
]
ACTION_IDX = {k: i for i, k in enumerate(ACTION_TYPES)}

CAPTURER_TYPES = {
    "infantry",
    "cavalry",
    "jp_samurai",
    "us_marine",
    "cpc_guerrilla",
    "kmt_training_brigade",
    "ru_guard",
}
NAVAL_TYPES = {"warship", "destroyer", "submarine", "carrier", "gb_battleship"}
UNIQUE_TYPES = {
    "de_tiger",
    "de_panzer",
    "ru_katyusha",
    "us_marine",
    "gb_battleship",
    "fr_heavy_cannon",
    "jp_samurai",
    "kmt_training_brigade",
    "cpc_guerrilla",
}
RARE_SPECIAL_TYPES = {
    "droneDeploy",
    "droneSuicide",
    "heavyCannonStance",
    "buildFortification",
    "buildAirfield",
    "repairShip",
    "banzaiCharge",
    "guerrillaConcealment",
}
DOCTRINE_ORDER = ["grandmaster", "blitz", "armada", "trickster"]
DOCTRINE_IDX = {d: i for i, d in enumerate(DOCTRINE_ORDER)}


def hex_dist(q1, r1, q2, r2):
    dq = q1 - q2
    dr = r1 - r2
    return (abs(dq) + abs(dq + dr) + abs(dr)) >> 1


def unit_class_flags(utype):
    base = utype or ""
    is_inf = 1.0 if "infantry" in base or base in {"us_marine", "cpc_guerrilla", "kmt_training_brigade", "ru_guard"} else 0.0
    is_cav = 1.0 if "cavalry" in base or base == "jp_samurai" else 0.0
    is_arc = 1.0 if "archer" in base or base in {"ru_katyusha", "fr_heavy_cannon"} else 0.0
    is_naval = 1.0 if base in NAVAL_TYPES else 0.0
    is_cap = 1.0 if base in CAPTURER_TYPES else 0.0
    is_uniq = 1.0 if base in UNIQUE_TYPES else 0.0
    return is_inf, is_cav, is_arc, is_naval, is_cap, is_uniq


def infer_human_match_styles(records):
    """Fingerprint each human (matchId, campKey) into a 4D soft style vector."""
    stats = defaultdict(lambda: {"n": 0, "atk": 0, "card": 0, "sea_air": 0, "ocean": 0})
    for r in records:
        key = (r["matchId"], r.get("campKey", "player1"))
        st = stats[key]
        st["n"] += 1
        atype = (r.get("humanAction") or {}).get("actionType") or (r["legalCandidates"][int(r["humanChosenId"])]["actionType"])
        if atype in {"attack", "banzaiCharge"}:
            st["atk"] += 1
        elif atype in {"tacticalCard", "drawCard"}:
            st["card"] += 1
        elif atype == "airCommand":
            st["sea_air"] += 1
        if r.get("map") == "uncharted-passage":
            st["ocean"] = 1

    out = {}
    for key, st in stats.items():
        n = max(1, st["n"])
        atk_r = st["atk"] / n
        card_r = st["card"] / n
        air_r = st["sea_air"] / n
        v = np.array([
            0.35 + max(0.0, 0.28 - card_r),
            0.25 + atk_r * 1.4,
            0.15 + air_r * 2.5 + (0.35 if st["ocean"] else 0.0),
            0.25 + card_r * 2.0,
        ], dtype=np.float32)
        v = np.maximum(0.05, v)
        out[key] = v / np.sum(v)
    return out


def style_vector_for_record(rec, human_styles):
    doc = rec.get("doctrine")
    if doc in DOCTRINE_IDX:
        v = np.zeros(4, dtype=np.float32)
        v[DOCTRINE_IDX[doc]] = 1.0
        return v
    key = (rec.get("matchId"), rec.get("campKey", "player1"))
    if key in human_styles:
        return human_styles[key]
    return np.array([0.4, 0.25, 0.15, 0.2], dtype=np.float32)


def featurize_record(rec, style_vec):
    obs = rec["observation"]
    cands = rec["legalCandidates"]
    you = obs["you"]
    round_num = float(obs.get("round", 1))
    gold = float(obs.get("gold", 0))
    cards = obs.get("cards") or []
    hand_len = float(len(cards))
    is_ocean = 1.0 if obs.get("map") == "uncharted-passage" else 0.0
    is_culture = 1.0 if obs.get("mode") == "culture" else 0.0

    tile_map = {}
    own_cities = []
    rival_cities = []
    neutral_cities = []
    hostile_ready_airfields = []
    for t in obs["tiles"]:
        if len(t) <= 2:
            continue
        q, r, surf, terr, owner, kind, chp, fort, inst = t
        tile_map[(q, r)] = t
        if kind == "city":
            if owner == you:
                own_cities.append((q, r, t))
            elif owner == "neutral":
                neutral_cities.append((q, r, t))
            else:
                rival_cities.append((q, r, t))
                if inst == "ready":
                    hostile_ready_airfields.append((q, r))
    hostile_cities = rival_cities + neutral_cities

    unit_map = {}
    unit_at = {}
    own_units = []
    rival_units = []
    neutral_units = []
    for u in obs["units"]:
        uid, camp, utype, q, r, hp, max_hp, shield, morale, cmd, atk, rng, mp, embarked = u
        unit_map[uid] = u
        unit_at[(q, r)] = u
        if camp == you:
            own_units.append(u)
        elif camp == "neutral":
            neutral_units.append(u)
        else:
            rival_units.append(u)
    hostile_units = rival_units + neutral_units

    own_hp_sum = sum(float(u[5]) for u in own_units)
    rival_hp_sum = sum(float(u[5]) for u in rival_units)
    hp_adv = own_hp_sum / max(100.0, own_hp_sum + rival_hp_sum)

    legal_map = {l["unitId"]: l for l in (obs.get("legal") or [])}
    n_legal_moves = sum(len(l.get("move") or []) for l in (obs.get("legal") or []))
    n_legal_attacks = sum(len(l.get("attack") or []) for l in (obs.get("legal") or []))
    n_actionable = sum(
        1 for l in (obs.get("legal") or [])
        if l.get("move") or l.get("attack") or l.get("specialization")
    )
    has_pending_spec = 1.0 if any(l.get("specialization") for l in (obs.get("legal") or [])) else 0.0
    own_cmd_injured = 1.0 if any(u[9] and u[5] < u[6] * 0.65 for u in own_units) else 0.0
    own_cmd_critical = 1.0 if any(u[9] and u[5] < u[6] * 0.40 for u in own_units) else 0.0
    has_heal_card = 1.0 if any(c[1] == "heal" for c in cards) else 0.0
    has_off_card = 1.0 if any(c[1] in {"lightning", "poison", "imprison", "airstrike", "orbitalStrike"} for c in cards) else 0.0
    has_deploy_card = 1.0 if any(c[1] == "commanderDeploy" for c in cards) else 0.0
    has_empty_own_city = 1.0 if any((q, r) not in unit_at for q, r, _ in own_cities) else 0.0
    n_own_assault = sum(1 for u in own_units if u[2] in CAPTURER_TYPES)

    def min_dist_units(q, r, ulist):
        best = 20
        for u in ulist:
            d = hex_dist(q, r, u[3], u[4])
            if d < best:
                best = d
        return float(best)

    def min_dist_cities(q, r, clist):
        best = 20
        for cq, cr, _ in clist:
            d = hex_dist(q, r, cq, cr)
            if d < best:
                best = d
        return float(best)

    type_counts = defaultdict(int)
    for c in cands:
        type_counts[c["actionType"]] += 1

    g_feats = np.array([
        min(round_num / 25.0, 1.5),
        min(gold / 30.0, 2.0),
        math.log1p(max(0.0, gold)) / 4.0,
        hand_len / 5.0,
        1.0 if hand_len == 0 else 0.0,
        min(len(own_units) / 20.0, 1.5),
        min(len(rival_units) / 20.0, 1.5),
        hp_adv,
        len(own_cities) / 10.0,
        len(rival_cities) / 10.0,
        len(neutral_cities) / 10.0,
        min(n_actionable / 15.0, 1.5),
        min(n_legal_attacks / 12.0, 1.5),
        min(n_legal_moves / 60.0, 1.5),
        has_pending_spec,
        own_cmd_injured,
        own_cmd_critical,
        is_ocean,
        is_culture,
        has_heal_card,
        has_off_card,
        has_deploy_card,
        has_empty_own_city,
    ], dtype=np.float32)

    n_cand = len(cands)
    n_atype = len(ACTION_TYPES)
    ext_base = len(g_feats) + n_atype + 52  # = 91
    total_dim = ext_base + 21  # = 112
    X = np.zeros((n_cand, total_dim), dtype=np.float32)
    X[:, :len(g_feats)] = g_feats

    own_city_share = len(own_cities) / max(1.0, len(own_cities) + len(rival_cities))
    clock_urgency = min(1.2, max(0.0, round_num - 11.0) / 8.0)
    spend_headroom = min(1.5, max(0.0, gold - 8.0) / 20.0)

    offset = len(g_feats)
    for idx, c in enumerate(cands):
        row = X[idx]
        atype = c["actionType"]
        a_i = ACTION_IDX.get(atype)
        if a_i is not None:
            row[offset + a_i] = 1.0
        f = offset + n_atype

        cnt = max(1, type_counts[atype])
        row[f + 0] = math.log(cnt) / 5.0

        uid = c.get("unitId")
        u = unit_map.get(uid) if uid is not None else None
        if u is not None:
            uq, ur = u[3], u[4]
            uhp, umax = float(u[5]), max(1.0, float(u[6]))
            uhp_ratio = uhp / umax
            u_is_cmd = 1.0 if u[9] else 0.0
            uatk = float(u[10])
            urng = float(u[11])
            ump = float(u[12] or 0.0)
            uemb = 1.0 if u[13] else 0.0
            is_inf, is_cav, is_arc, is_nav, is_cap, is_uniq = unit_class_flags(u[2])
            l_u = legal_map.get(uid) or {}
            u_can_atk_now = 1.0 if (l_u.get("attack") or []) else 0.0
            d_u_rival = min_dist_units(uq, ur, rival_units)
            d_u_hostile = min_dist_units(uq, ur, hostile_units)
            d_u_hcity = min_dist_cities(uq, ur, hostile_cities)
            enemies_near_u = sum(1 for e in hostile_units if hex_dist(uq, ur, e[3], e[4]) <= 2)

            row[f + 1] = uhp_ratio
            row[f + 2] = u_is_cmd
            row[f + 3] = uatk / 80.0
            row[f + 4] = urng / 4.0
            row[f + 5] = min(ump / 5.0, 1.5)
            row[f + 6] = uemb
            row[f + 7] = is_inf
            row[f + 8] = is_cav
            row[f + 9] = is_arc
            row[f + 10] = is_nav
            row[f + 11] = is_cap
            row[f + 12] = is_uniq
            row[f + 13] = u_can_atk_now
            row[f + 14] = d_u_rival / 15.0
            row[f + 15] = d_u_hostile / 15.0
            row[f + 16] = d_u_hcity / 15.0
            row[f + 17] = min(enemies_near_u / 4.0, 1.5)
            if u[9] in {"engineer", "tianyan", "minister", "priest", "astrologer"}:
                row[ext_base + 13] = 1.0
        else:
            uq = ur = 0
            uhp_ratio = 1.0
            u_is_cmd = uatk = urng = is_cap = 0.0
            d_u_rival = d_u_hostile = d_u_hcity = 10.0

        dq = c.get("q")
        dr = c.get("r")
        if dq is not None and dr is not None:
            dt = tile_map.get((dq, dr))
            fort_val = None
            is_city = own_riv = own_neu = 0.0
            if dt is not None:
                _, _, surf, terr, owner, kind, chp, fort_val, inst = dt
                is_city = 1.0 if kind == "city" else 0.0
                is_port = 1.0 if kind == "port" else 0.0
                is_vil = 1.0 if kind == "village" else 0.0
                is_water = 1.0 if "Water" in str(surf) else 0.0
                is_cover = 1.0 if terr in {"forest", "mountain"} else 0.0
                own_own = 1.0 if owner == you else 0.0
                own_riv = 1.0 if owner not in {you, "neutral", None} else 0.0
                own_neu = 1.0 if owner == "neutral" else 0.0
                c_hp_ratio = min(1.0, float(chp or 0) / 250.0) if is_city else 0.0
                has_airf = 1.0 if inst == "ready" else 0.0
                row[f + 18] = is_city
                row[f + 19] = is_port
                row[f + 20] = is_vil
                row[f + 21] = is_water
                row[f + 22] = is_cover
                row[f + 23] = own_own
                row[f + 24] = own_riv
                row[f + 25] = own_neu
                row[f + 26] = c_hp_ratio
                row[f + 27] = has_airf

            d_dest_rival = min_dist_units(dq, dr, rival_units)
            d_dest_hcity = min_dist_cities(dq, dr, hostile_cities)
            enemies_dest_2 = sum(1 for e in hostile_units if hex_dist(dq, dr, e[3], e[4]) <= 2)
            allies_dest_2 = sum(1 for a in own_units if a[0] != uid and hex_dist(dq, dr, a[3], a[4]) <= 2)
            row[f + 28] = d_dest_rival / 15.0
            row[f + 29] = d_dest_hcity / 15.0
            row[f + 30] = min(enemies_dest_2 / 4.0, 1.5)
            row[f + 31] = min(allies_dest_2 / 4.0, 1.5)

            # Area 3B 扩展特征（93..102）
            flank_allies_1 = sum(1 for a in own_units if a[0] != uid and hex_dist(dq, dr, a[3], a[4]) == 1)
            assault_near_2 = sum(1 for a in own_units if a[0] != uid and a[2] in CAPTURER_TYPES and hex_dist(dq, dr, a[3], a[4]) <= 2)
            ranged_near_2 = sum(
                1 for a in own_units
                if a[0] != uid and ("archer" in a[2] or a[2] in {"ru_katyusha", "fr_heavy_cannon"} or a[2] in NAVAL_TYPES)
                and hex_dist(dq, dr, a[3], a[4]) <= 2
            )
            fort_score = 1.0 if fort_val == "trench" else (0.8 if fort_val == "flak" else 0.0)
            crossfire_pressure = min(2.0, max(-1.0, (enemies_dest_2 - flank_allies_1) / 2.0))
            local_sup = min(1.0, ((allies_dest_2 + 1.0) / (enemies_dest_2 + 1.0)) / 3.0)
            adj_own_city = 1.0 if any(hex_dist(dq, dr, cq, cr) <= 1 for cq, cr, _ in own_cities) else 0.0
            in_enemy_air_zone = 1.0 if any(hex_dist(dq, dr, aq, ar) <= 8 for aq, ar in hostile_ready_airfields) else 0.0

            row[ext_base + 2] = min(flank_allies_1 / 3.0, 1.5)
            row[ext_base + 3] = min(assault_near_2 / 4.0, 1.5)
            row[ext_base + 4] = min(ranged_near_2 / 4.0, 1.5)
            row[ext_base + 5] = fort_score
            row[ext_base + 6] = crossfire_pressure
            row[ext_base + 7] = local_sup
            row[ext_base + 10] = adj_own_city
            row[ext_base + 11] = in_enemy_air_zone

            if atype == "move" and u is not None:
                step_d = hex_dist(uq, ur, dq, dr)
                eff_range = max(1.0, urng)
                can_atk_from_dest = 1.0 if any(
                    hex_dist(dq, dr, e[3], e[4]) <= eff_range for e in hostile_units
                ) else 0.0
                steps_open_city = 1.0 if (is_city and (own_riv or own_neu) and (dq, dr) not in unit_at) else 0.0
                row[f + 32] = step_d / 5.0
                row[f + 33] = (d_u_rival - d_dest_rival) / 5.0
                row[f + 34] = (d_u_hcity - d_dest_hcity) / 5.0
                row[f + 35] = can_atk_from_dest
                row[f + 36] = steps_open_city
                row[f + 37] = u_is_cmd * min(enemies_dest_2 / 3.0, 1.0) * (1.5 - uhp_ratio)
                row[ext_base + 8] = 1.0 if any(hex_dist(dq, dr, cq, cr) == 1 for cq, cr, _ in hostile_cities) else 0.0
                row[ext_base + 9] = 1.0 if any(
                    hex_dist(dq, dr, e[3], e[4]) <= eff_range and float(e[5]) < float(e[6]) * 0.70
                    for e in hostile_units
                ) else 0.0

            if atype in {"attack", "banzaiCharge"} and u is not None:
                tu = unit_at.get((dq, dr))
                row[ext_base + 8] = min(1.5, allies_dest_2 / 3.0)
                if tu is not None:
                    thp = max(1.0, float(tu[5] + tu[7]))
                    tmax = max(1.0, float(tu[6]))
                    row[f + 32] = thp / tmax
                    row[f + 33] = 1.0 if tu[9] else 0.0
                    row[f + 34] = 1.0 if tu[1] == "neutral" else 0.0
                    row[f + 35] = 1.0 if tu[1] not in {you, "neutral"} else 0.0
                    row[f + 36] = min(2.0, uatk / thp)
                    row[f + 37] = 1.0 if uatk >= thp * 0.95 else 0.0
                    row[ext_base + 9] = 1.0 if (is_cap > 0.5 and uatk >= thp) else 0.0
                else:
                    row[f + 38] = 1.0

        if atype == "recruit":
            ru = c.get("unitType") or ""
            r_inf, r_cav, r_arc, r_nav, _, r_uniq = unit_class_flags(ru)
            row[f + 39] = r_inf
            row[f + 40] = r_cav
            row[f + 41] = r_arc
            row[f + 42] = r_nav
            row[f + 43] = r_uniq
            row[f + 44] = n_own_assault / 10.0

        if atype == "tacticalCard":
            cid = c.get("cardId") or ""
            tu = unit_at.get((dq, dr)) if (dq is not None and dr is not None) else None
            row[f + 39] = 1.0 if cid == "commanderDeploy" else 0.0
            row[f + 40] = 1.0 if cid == "heal" else 0.0
            row[f + 41] = 1.0 if cid == "shield" else 0.0
            row[f + 42] = 1.0 if cid in {"lightning", "imprison", "poison"} else 0.0
            row[f + 43] = 1.0 if cid in {"forceMarch", "airdrop"} else 0.0
            if tu is not None:
                row[f + 44] = float(tu[5]) / max(1.0, float(tu[6]))
                row[f + 45] = 1.0 if tu[9] else 0.0
                row[f + 46] = 1.0 if tu[1] == you else 0.0
                row[f + 47] = 1.0 if tu[1] == "neutral" else 0.0

        if atype == "airCommand":
            ck = c.get("commandKind") or ""
            row[f + 39] = 1.0 if ck == "bombing" else 0.0
            row[f + 40] = 1.0 if ck in {"strafe", "stukaDiveBomb"} else 0.0
            row[f + 41] = 1.0 if ck == "airdrop" else 0.0
            if dq is not None and dr is not None:
                splash_targets = sum(1 for e in hostile_units if hex_dist(dq, dr, e[3], e[4]) <= 1)
                row[f + 42] = min(splash_targets / 4.0, 1.5)

        if atype == "drawCard":
            row[f + 48] = 1.0 if hand_len == 0 else 0.0
            row[f + 49] = min(gold / 15.0, 2.0)

        if atype == "endTurn":
            row[f + 48] = 1.0 if n_actionable == 0 else 0.0
            row[f + 49] = 1.0 if n_legal_attacks == 0 else 0.0
            row[f + 50] = 1.0 if gold < 8.0 else 0.0
            row[f + 51] = min(n_legal_moves / 30.0, 1.5)

        if atype == "droneDeploy":
            row[ext_base + 0] = 1.0
        if atype == "banzaiCharge":
            row[ext_base + 1] = 1.0
        if atype in RARE_SPECIAL_TYPES:
            row[ext_base + 12] = 1.0

        # Area 4B 4维风格条件向量 + 终局节奏特征（105..111）
        row[ext_base + 14 : ext_base + 18] = style_vec
        row[ext_base + 18] = own_city_share
        row[ext_base + 19] = clock_urgency
        row[ext_base + 20] = spend_headroom

    return X, int(rec["humanChosenId"]), [c["actionType"] for c in cands]


def load_dataset(path):
    records = []
    if not Path(path).exists():
        return records
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def softmax_logits(logits, temp=1.0):
    z = (logits / temp) - np.max(logits / temp)
    e = np.exp(np.clip(z, -40.0, 0.0))
    return e / np.sum(e)


class DualHeadMLPScorer:
    def __init__(self, dim, h1=112, h2=56, l2=3e-4, lr=2.8e-3, seed=42):
        rng = np.random.default_rng(seed)
        self.W1 = rng.normal(0.0, math.sqrt(2.0 / dim), size=(dim, h1)).astype(np.float32)
        self.b1 = np.zeros(h1, dtype=np.float32)
        self.W2 = rng.normal(0.0, math.sqrt(2.0 / h1), size=(h1, h2)).astype(np.float32)
        self.b2 = np.zeros(h2, dtype=np.float32)
        self.W3 = rng.normal(0.0, math.sqrt(2.0 / h2), size=(h2,)).astype(np.float32)
        self.b3 = np.float32(0.0)
        self.Wv = rng.normal(0.0, math.sqrt(1.0 / h2), size=(h2,)).astype(np.float32)
        self.bv = np.float32(0.0)
        self.l2 = l2
        self.lr = lr
        self.params = ["W1", "b1", "W2", "b2", "W3", "b3", "Wv", "bv"]
        self.m = {p: np.zeros_like(getattr(self, p)) for p in self.params}
        self.v = {p: np.zeros_like(getattr(self, p)) for p in self.params}
        self.t = 0
        self.rng = rng

    @staticmethod
    def gelu(x):
        return 0.5 * x * (1.0 + np.tanh(0.7978845608 * (x + 0.044715 * x * x * x)))

    @staticmethod
    def gelu_grad(x):
        c = 0.7978845608
        u = c * (x + 0.044715 * x * x * x)
        th = np.tanh(u)
        sech2 = 1.0 - th * th
        du = c * (1.0 + 3.0 * 0.044715 * x * x)
        return 0.5 * (1.0 + th) + 0.5 * x * sech2 * du

    def forward(self, X, train=False, dropout=0.14):
        z1 = X @ self.W1 + self.b1
        a1 = self.gelu(z1)
        mask1 = None
        if train and dropout > 0:
            mask1 = (self.rng.random(a1.shape) >= dropout).astype(np.float32) / (1.0 - dropout)
            a1 = a1 * mask1
        z2 = a1 @ self.W2 + self.b2
        a2 = self.gelu(z2)
        logits = a2 @ self.W3 + self.b3
        vals = np.tanh(a2 @ self.Wv + self.bv)
        if not train:
            return logits, vals
        return logits, vals, (X, z1, a1, mask1, z2, a2)

    def step(self, batch_items, lr_scale=1.0):
        grads = {p: np.zeros_like(getattr(self, p)) for p in self.params}
        total_pol = 0.0
        total_val = 0.0
        val_n = 0
        for X, y, pw, target_v, vw in batch_items:
            logits, vals, (X_in, z1, a1, mask1, z2, a2) = self.forward(X, train=True)
            d_a2 = np.zeros_like(a2)
            if pw > 0:
                eff_pw = pw
                if target_v is not None:
                    # AWR (Advantage-Weighted Regression): 以当前局面平均价值基线 V(s) 计算优势 A = G_t - V(s)，
                    # 动态放大高优势胜势决策的梯度权重、抑制低效平庸动作。
                    v_baseline = float(np.mean(vals))
                    adv = max(-0.8, min(1.0, float(target_v) - v_baseline))
                    eff_pw = pw * float(np.clip(math.exp(adv / 0.55), 0.25, 2.25))
                probs = softmax_logits(logits)
                total_pol += eff_pw * float(-np.log(max(1e-9, probs[y])))
                d_logits = probs
                d_logits[y] -= 1.0
                d_logits = d_logits * eff_pw
                grads["W3"] += a2.T @ d_logits
                grads["b3"] += np.sum(d_logits)
                d_a2 += np.outer(d_logits, self.W3)

            if vw > 0 and target_v is not None:
                pred_v = float(vals[y])
                err = pred_v - float(target_v)
                total_val += vw * err * err
                val_n += 1
                dv_raw = vw * 0.18 * 2.0 * err * (1.0 - pred_v * pred_v)
                grads["Wv"] += a2[y] * dv_raw
                grads["bv"] += dv_raw
                d_a2[y] += self.Wv * dv_raw

            if pw > 0 or vw > 0:
                d_z2 = d_a2 * self.gelu_grad(z2)
                grads["W2"] += a1.T @ d_z2
                grads["b2"] += np.sum(d_z2, axis=0)
                d_a1 = d_z2 @ self.W2.T
                if mask1 is not None:
                    d_a1 = d_a1 * mask1
                d_z1 = d_a1 * self.gelu_grad(z1)
                grads["W1"] += X_in.T @ d_z1
                grads["b1"] += np.sum(d_z1, axis=0)

        n = max(1, len(batch_items))
        self.t += 1
        cur_lr = self.lr * lr_scale
        for p in self.params:
            w = getattr(self, p)
            g = grads[p] / n
            if p.startswith("W"):
                g = g + self.l2 * w
            self.m[p] = 0.9 * self.m[p] + 0.1 * g
            self.v[p] = 0.999 * self.v[p] + 0.001 * (g * g)
            mh = self.m[p] / (1.0 - 0.9 ** self.t)
            vh = self.v[p] / (1.0 - 0.999 ** self.t)
            setattr(self, p, w - cur_lr * mh / (np.sqrt(vh) + 1e-8))
        return total_pol / n, (total_val / max(1, val_n))

    def refine_value_head(self, value_items, epochs=12, batch_size=64, lr=8e-3, l2=1e-4):
        """Stage 2: 冻结策略主干 (W1, W2, W3)，纯以自对局 TD 回报精调 Q-Value Head (Wv, bv)。"""
        cached = []
        for X_in, y, _, target_v, vw in value_items:
            if vw <= 0 or target_v is None:
                continue
            z1 = X_in @ self.W1 + self.b1
            a1 = self.gelu(z1)
            z2 = a1 @ self.W2 + self.b2
            a2 = self.gelu(z2)
            cached.append((a2[y].copy(), float(target_v), float(vw)))
        if not cached:
            return
        m_w = np.zeros_like(self.Wv)
        v_w = np.zeros_like(self.Wv)
        m_b = np.float32(0.0)
        v_b = np.float32(0.0)
        t = 0
        for ep in range(1, epochs + 1):
            perm = self.rng.permutation(len(cached))
            lr_cur = lr * max(0.2, 0.5 * (1.0 + math.cos(math.pi * (ep - 1) / max(1, epochs))))
            for start in range(0, len(perm), batch_size):
                idxs = perm[start:start + batch_size]
                gw = np.zeros_like(self.Wv)
                gb = np.float32(0.0)
                for k in idxs:
                    feat, tv, vw = cached[k]
                    pv = float(np.tanh(float(feat @ self.Wv + self.bv)))
                    err = pv - tv
                    dv = vw * 2.0 * err * (1.0 - pv * pv)
                    gw += feat * dv
                    gb += dv
                nb = max(1, len(idxs))
                gw = gw / nb + l2 * self.Wv
                gb = gb / nb
                t += 1
                m_w = 0.9 * m_w + 0.1 * gw
                v_w = 0.999 * v_w + 0.001 * (gw * gw)
                m_b = 0.9 * m_b + 0.1 * gb
                v_b = 0.999 * v_b + 0.001 * (gb * gb)
                self.Wv -= lr_cur * (m_w / (1.0 - 0.9 ** t)) / (np.sqrt(v_w / (1.0 - 0.999 ** t)) + 1e-8)
                self.bv -= lr_cur * (m_b / (1.0 - 0.9 ** t)) / (math.sqrt(v_b / (1.0 - 0.999 ** t)) + 1e-8)

    def state_dict(self):
        return {p: getattr(self, p).copy() for p in self.params}

    def load_state_dict(self, sd):
        for p in self.params:
            setattr(self, p, sd[p].copy())


def evaluate_split(items, recs, model, mean, std, temp=1.0):
    ce = 0.0
    top1 = top3 = top5 = type_top1 = 0
    val_mse = 0.0
    val_cnt = 0
    val_sign_ok = 0

    by_type = defaultdict(lambda: {"n": 0, "top1": 0, "top3": 0, "type_ok": 0})
    for (X_raw, y, ctypes, _, target_v, _), rec in zip(items, recs):
        X = np.clip((X_raw - mean) / std, -8.0, 8.0)
        logits, vals = model.forward(X, train=False)
        probs = softmax_logits(logits, temp=temp)
        ce -= float(np.log(max(1e-9, probs[y])))

        if target_v is not None:
            pv = float(vals[y])
            val_mse += (pv - float(target_v)) ** 2
            val_cnt += 1
            if (pv >= 0 and target_v >= 0) or (pv < 0 and target_v < 0):
                val_sign_ok += 1

        order = np.argsort(-probs)
        pred_idx = int(order[0])
        is_t1 = int(pred_idx == y)
        is_t3 = int(y in order[:3])
        is_t5 = int(y in order[:5])
        true_type = ctypes[y]
        pred_type = ctypes[pred_idx]
        is_type_ok = int(pred_type == true_type)

        top1 += is_t1
        top3 += is_t3
        top5 += is_t5
        type_top1 += is_type_ok

        b = by_type[true_type]
        b["n"] += 1
        b["top1"] += is_t1
        b["top3"] += is_t3
        b["type_ok"] += is_type_ok

    n = max(1, len(items))
    return {
        "n": len(items),
        "crossEntropy": round(ce / n, 4),
        "perplexity": round(math.exp(min(20.0, ce / n)), 2),
        "modelTop1Pct": round(100.0 * top1 / n, 2),
        "modelTop3Pct": round(100.0 * top3 / n, 2),
        "modelTop5Pct": round(100.0 * top5 / n, 2),
        "modelActionTypeTop1Pct": round(100.0 * type_top1 / n, 2),
        "valueValMse": round(val_mse / val_cnt, 4) if val_cnt > 0 else None,
        "valueValSignAccPct": round(100.0 * val_sign_ok / val_cnt, 1) if val_cnt > 0 else None,
        "byActionType": {
            k: {
                "n": v["n"],
                "modelTop1Pct": round(100.0 * v["top1"] / v["n"], 1),
                "modelTop3Pct": round(100.0 * v["top3"] / v["n"], 1),
                "modelTypeAccPct": round(100.0 * v["type_ok"] / v["n"], 1),
            }
            for k, v in sorted(by_type.items(), key=lambda kv: -kv[1]["n"])
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="artifacts/datasets/human-behavior.jsonl")
    parser.add_argument("--selfplay", default="artifacts/datasets/selfplay-dagger.jsonl")
    parser.add_argument("--val-match", default="up-20261116194704")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--out-model", default="ai/models/policy-prototype.json")
    parser.add_argument("--out-eval", default="artifacts/datasets/policy-prototype-eval.json")
    args = parser.parse_args()

    t0 = time.time()
    human_records = load_dataset(args.data)
    selfplay_records = load_dataset(args.selfplay) if args.selfplay else []
    human_matches = sorted({r["matchId"] for r in human_records})
    if args.val_match not in human_matches:
        raise ValueError(f"Unknown --val-match {args.val_match}, available: {human_matches}")

    human_styles = infer_human_match_styles(human_records)

    train_items_raw = []
    human_val_items_raw = []
    human_val_recs = []

    for rec in human_records:
        svec = style_vector_for_record(rec, human_styles)
        X, y, ctypes = featurize_record(rec, svec)
        item = (X, y, ctypes, 1.0, None, 0.0)
        if rec["matchId"] == args.val_match:
            human_val_items_raw.append(item)
            human_val_recs.append(rec)
        else:
            train_items_raw.append(item)

    sp_matches = sorted({r["matchId"] for r in selfplay_records})
    sp_val_set = set(sp_matches[-max(1, len(sp_matches) // 6):]) if len(sp_matches) >= 6 else set()
    sp_val_items_raw = []
    sp_val_recs = []
    for rec in selfplay_records:
        svec = style_vector_for_record(rec, human_styles)
        X, y, ctypes = featurize_record(rec, svec)
        pw = float(rec.get("policyWeight", 0.35))
        tv = float(rec["outcomeValue"]) if rec.get("outcomeValue") is not None else None
        vw = float(rec.get("valueWeight", 1.0)) if tv is not None else 0.0
        item = (X, y, ctypes, pw, tv, vw)
        if rec["matchId"] in sp_val_set:
            sp_val_items_raw.append(item)
            sp_val_recs.append(rec)
        else:
            train_items_raw.append(item)

    stage1_raw = [it for it in train_items_raw if it[3] > 0]
    train_X_cat = np.concatenate([it[0] for it in (stage1_raw or train_items_raw)], axis=0)
    mean = np.mean(train_X_cat, axis=0)
    std = np.maximum(1e-3, np.std(train_X_cat, axis=0))

    train_data = [
        (np.clip((X - mean) / std, -8.0, 8.0), y, pw, tv, vw)
        for (X, y, _, pw, tv, vw) in train_items_raw
    ]
    dim = int(train_X_cat.shape[1])

    # Stage 1: 纯正策略梯度样本（人类高质量 BC）更新策略主干，绝不被自对局空样本/分布漂移污染
    stage1_data = [it for it in train_data if it[2] > 0]
    mlp = DualHeadMLPScorer(dim, h1=112, h2=56, l2=3.2e-4, lr=2.8e-3, seed=42)
    best_obj = float("inf")
    best_state = mlp.state_dict()
    best_epoch = 0
    history = []
    rng = np.random.default_rng(42)

    for ep in range(1, args.epochs + 1):
        perm = rng.permutation(len(stage1_data))
        lr_scale = max(0.15, 0.5 * (1.0 + math.cos(math.pi * (ep - 1) / max(1, args.epochs))))
        tr_pol = tr_val = 0.0
        nb = 0
        for start in range(0, len(perm), args.batch_size):
            batch = [stage1_data[k] for k in perm[start:start + args.batch_size]]
            p_loss, v_loss = mlp.step(batch, lr_scale=lr_scale)
            tr_pol += p_loss
            tr_val += v_loss
            nb += 1

        val_metrics = evaluate_split(human_val_items_raw, human_val_recs, mlp, mean, std)
        history.append({
            "epoch": ep,
            "trainPolicyLoss": round(tr_pol / max(1, nb), 4),
            "trainValueLoss": round(tr_val / max(1, nb), 4),
            "valLoss": val_metrics["crossEntropy"],
            "valTop1Pct": val_metrics["modelTop1Pct"],
            "valTop3Pct": val_metrics["modelTop3Pct"],
            "valTypeTop1Pct": val_metrics["modelActionTypeTop1Pct"],
        })
        pol_obj = val_metrics["crossEntropy"] - 0.012 * val_metrics["modelTop1Pct"]
        if ep >= min(5, args.epochs) and pol_obj < best_obj:
            best_obj = pol_obj
            best_state = mlp.state_dict()
            best_epoch = ep

    mlp.load_state_dict(best_state)
    # Stage 2: 冻结最佳策略主干，使用全部自对局 TD 回报精调 Q-Value Head (Wv, bv)
    mlp.refine_value_head(train_data, epochs=16, batch_size=64, lr=8e-3)
    best_state = mlp.state_dict()
    mlp_val = evaluate_split(human_val_items_raw, human_val_recs, mlp, mean, std)
    sp_val = evaluate_split(sp_val_items_raw, sp_val_recs, mlp, mean, std) if sp_val_items_raw else None

    Path(args.out_model).parent.mkdir(parents=True, exist_ok=True)
    model_artifact = {
        "schema": "blades-of-hex.policy-value.v2",
        "trainMatches": [m for m in human_matches if m != args.val_match],
        "selfPlayMatchesCount": len(sp_matches),
        "valMatch": args.val_match,
        "featureDim": int(dim),
        "bestEpoch": best_epoch,
        "normMean": [round(float(x), 6) for x in mean],
        "normStd": [round(float(x), 6) for x in std],
        "weights": {
            k: (round(float(v), 6) if np.ndim(v) == 0 else v.tolist())
            for k, v in best_state.items()
        },
    }
    Path(args.out_model).write_text(json.dumps(model_artifact), encoding="utf-8")

    summary = {
        "elapsedSec": round(time.time() - t0, 2),
        "humanTrainMatchesCount": len(human_matches) - 1,
        "selfPlayMatchesCount": len(sp_matches),
        "trainSamplesTotal": len(train_data),
        "humanValSamples": len(human_val_items_raw),
        "featureDim": int(dim),
        "mlpBestEpoch": best_epoch,
        "humanVal": mlp_val,
        "selfPlayVal": sp_val,
        "history": history,
    }
    Path(args.out_eval).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
