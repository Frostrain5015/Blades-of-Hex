#!/usr/bin/env python3
"""
Isolated Policy Scorer Prototype (10-match train / 1-match validation).
Completely decoupled from ai/ and js/ai.js runtime scripts.

Trains listwise softmax candidate-ranking models (Linear + 2-layer MLP) on
artifacts/datasets/human-behavior.jsonl so p(a | s) = softmax(score(s, a) / T)
outputs human-like action probabilities over legal engine candidates.
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


def hex_dist(q1, r1, q2, r2):
    dq = q1 - q2
    dr = r1 - r2
    return (abs(dq) + abs(dq + dr) + abs(dr)) >> 1


def unit_class_flags(utype):
    base = utype or ""
    is_inf = 1.0 if "infantry" in base or base in {"us_marine", "cpc_guerrilla", "kmt_training_brigade"} else 0.0
    is_cav = 1.0 if "cavalry" in base or base == "jp_samurai" else 0.0
    is_arc = 1.0 if "archer" in base or base in {"ru_katyusha", "fr_heavy_cannon"} else 0.0
    is_naval = 1.0 if base in NAVAL_TYPES else 0.0
    is_cap = 1.0 if base in CAPTURER_TYPES else 0.0
    is_uniq = 1.0 if base in UNIQUE_TYPES else 0.0
    return is_inf, is_cav, is_arc, is_naval, is_cap, is_uniq


def featurize_record(rec):
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
    neutral_hp_sum = sum(float(u[5]) for u in neutral_units)
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

    # Precompute action counts in legalCandidates
    type_counts = defaultdict(int)
    for c in cands:
        type_counts[c["actionType"]] += 1

    # Global context (19 dims)
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
    cand_dim = n_atype + 52
    total_dim = len(g_feats) + cand_dim
    X = np.zeros((n_cand, total_dim), dtype=np.float32)
    X[:, :len(g_feats)] = g_feats

    offset = len(g_feats)
    for idx, c in enumerate(cands):
        row = X[idx]
        atype = c["actionType"]
        a_i = ACTION_IDX.get(atype)
        if a_i is not None:
            row[offset + a_i] = 1.0
        f = offset + n_atype

        # 0: log(type competition) helps calibrate prior across variable-count action classes
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
            d_u_rcity = min_dist_cities(uq, ur, rival_cities)
            d_u_ocity = min_dist_cities(uq, ur, own_cities)
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
        else:
            uq = ur = 0
            uhp = umax = 100.0
            uhp_ratio = 1.0
            u_is_cmd = uatk = urng = is_cap = 0.0
            d_u_rival = d_u_hostile = d_u_hcity = d_u_rcity = d_u_ocity = 10.0

        dq = c.get("q")
        dr = c.get("r")
        if dq is not None and dr is not None:
            dt = tile_map.get((dq, dr))
            if dt is not None:
                _, _, surf, terr, owner, kind, chp, fort, inst = dt
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
            else:
                is_city = own_own = own_riv = own_neu = is_water = 0.0

            d_dest_rival = min_dist_units(dq, dr, rival_units)
            d_dest_hostile = min_dist_units(dq, dr, hostile_units)
            d_dest_hcity = min_dist_cities(dq, dr, hostile_cities)
            d_dest_rcity = min_dist_cities(dq, dr, rival_cities)
            enemies_dest_2 = sum(1 for e in hostile_units if hex_dist(dq, dr, e[3], e[4]) <= 2)
            allies_dest_2 = sum(1 for a in own_units if a[0] != uid and hex_dist(dq, dr, a[3], a[4]) <= 2)
            row[f + 28] = d_dest_rival / 15.0
            row[f + 29] = d_dest_hcity / 15.0
            row[f + 30] = min(enemies_dest_2 / 4.0, 1.5)
            row[f + 31] = min(allies_dest_2 / 4.0, 1.5)

            if atype == "move" and u is not None:
                step_d = hex_dist(uq, ur, dq, dr)
                can_atk_from_dest = 1.0 if any(
                    hex_dist(dq, dr, e[3], e[4]) <= max(1.0, urng) for e in hostile_units
                ) else 0.0
                steps_open_city = 1.0 if (is_city and (own_riv or own_neu) and (dq, dr) not in unit_at) else 0.0
                row[f + 32] = step_d / 5.0
                row[f + 33] = (d_u_rival - d_dest_rival) / 5.0
                row[f + 34] = (d_u_hcity - d_dest_hcity) / 5.0
                row[f + 35] = can_atk_from_dest
                row[f + 36] = steps_open_city
                row[f + 37] = u_is_cmd * min(enemies_dest_2 / 3.0, 1.0) * (1.5 - uhp_ratio)

            if atype == "attack" and u is not None:
                tu = unit_at.get((dq, dr))
                if tu is not None:
                    thp = max(1.0, float(tu[5] + tu[7]))
                    tmax = max(1.0, float(tu[6]))
                    row[f + 32] = thp / tmax
                    row[f + 33] = 1.0 if tu[9] else 0.0
                    row[f + 34] = 1.0 if tu[1] == "neutral" else 0.0
                    row[f + 35] = 1.0 if tu[1] not in {you, "neutral"} else 0.0
                    row[f + 36] = min(2.0, uatk / thp)
                    row[f + 37] = 1.0 if uatk >= thp * 0.95 else 0.0
                else:
                    row[f + 38] = 1.0  # city siege without garrison

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

    return X, int(rec["humanChosenId"]), [c["actionType"] for c in cands]


def load_dataset(path):
    records = []
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


class LinearScorer:
    def __init__(self, dim, l2=1e-4, lr=0.02):
        self.W = np.zeros(dim, dtype=np.float32)
        self.l2 = l2
        self.lr = lr
        self.m = np.zeros_like(self.W)
        self.v = np.zeros_like(self.W)
        self.t = 0

    def forward(self, X):
        return X @ self.W

    def step(self, batch_items):
        grad = np.zeros_like(self.W)
        total_loss = 0.0
        for X, y in batch_items:
            logits = X @ self.W
            probs = softmax_logits(logits)
            total_loss -= float(np.log(max(1e-9, probs[y])))
            diff = probs
            diff[y] -= 1.0
            grad += X.T @ diff
        n = max(1, len(batch_items))
        grad = grad / n + self.l2 * self.W
        self.t += 1
        self.m = 0.9 * self.m + 0.1 * grad
        self.v = 0.999 * self.v + 0.001 * (grad * grad)
        mh = self.m / (1.0 - 0.9 ** self.t)
        vh = self.v / (1.0 - 0.999 ** self.t)
        self.W -= self.lr * mh / (np.sqrt(vh) + 1e-8)
        return total_loss / n


class MLPScorer:
    def __init__(self, dim, h1=96, h2=48, l2=2e-4, lr=3e-3, seed=42):
        rng = np.random.default_rng(seed)
        self.W1 = rng.normal(0.0, math.sqrt(2.0 / dim), size=(dim, h1)).astype(np.float32)
        self.b1 = np.zeros(h1, dtype=np.float32)
        self.W2 = rng.normal(0.0, math.sqrt(2.0 / h1), size=(h1, h2)).astype(np.float32)
        self.b2 = np.zeros(h2, dtype=np.float32)
        self.W3 = rng.normal(0.0, math.sqrt(2.0 / h2), size=(h2,)).astype(np.float32)
        self.b3 = np.float32(0.0)
        self.l2 = l2
        self.lr = lr
        self.params = ["W1", "b1", "W2", "b2", "W3", "b3"]
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

    def forward(self, X, train=False, dropout=0.15):
        z1 = X @ self.W1 + self.b1
        a1 = self.gelu(z1)
        mask1 = None
        if train and dropout > 0:
            mask1 = (self.rng.random(a1.shape) >= dropout).astype(np.float32) / (1.0 - dropout)
            a1 = a1 * mask1
        z2 = a1 @ self.W2 + self.b2
        a2 = self.gelu(z2)
        logits = a2 @ self.W3 + self.b3
        if not train:
            return logits
        return logits, (X, z1, a1, mask1, z2, a2)

    def step(self, batch_items, lr_scale=1.0):
        grads = {p: np.zeros_like(getattr(self, p)) for p in self.params}
        total_loss = 0.0
        for X, y in batch_items:
            logits, (X_in, z1, a1, mask1, z2, a2) = self.forward(X, train=True)
            probs = softmax_logits(logits)
            total_loss -= float(np.log(max(1e-9, probs[y])))
            d_logits = probs
            d_logits[y] -= 1.0
            grads["W3"] += a2.T @ d_logits
            grads["b3"] += np.sum(d_logits)
            d_a2 = np.outer(d_logits, self.W3)
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
        return total_loss / n

    def state_dict(self):
        return {p: getattr(self, p).copy() for p in self.params}

    def load_state_dict(self, sd):
        for p in self.params:
            setattr(self, p, sd[p].copy())


def evaluate_split(items, recs, model, mean, std, temp=1.0):
    ce = 0.0
    rand_ce = 0.0
    top1 = 0
    top3 = 0
    top5 = 0
    type_top1 = 0
    type_prob_match = 0.0
    rand_top1 = 0.0
    imp_exact1 = 0
    imp_type1 = 0

    by_type = defaultdict(lambda: {"n": 0, "top1": 0, "top3": 0, "type_ok": 0, "imp_exact1": 0, "imp_type1": 0})
    for (X_raw, y, ctypes), rec in zip(items, recs):
        X = np.clip((X_raw - mean) / std, -8.0, 8.0)
        logits = model.forward(X)
        probs = softmax_logits(logits, temp=temp)
        ce -= float(np.log(max(1e-9, probs[y])))
        rand_ce += math.log(max(1, len(ctypes)))
        rand_top1 += 1.0 / max(1, len(ctypes))

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
        type_prob_match += float(sum(probs[i] for i, ct in enumerate(ctypes) if ct == true_type))

        imp = rec.get("shadowImperator") or {}
        imp_first_t = (imp.get("top3") or [{}])[0].get("actionType")
        ie1 = int(bool(imp.get("exactFirst")))
        it1 = int(imp_first_t == true_type)
        imp_exact1 += ie1
        imp_type1 += it1

        b = by_type[true_type]
        b["n"] += 1
        b["top1"] += is_t1
        b["top3"] += is_t3
        b["type_ok"] += is_type_ok
        b["imp_exact1"] += ie1
        b["imp_type1"] += it1

    n = max(1, len(items))
    return {
        "n": len(items),
        "crossEntropy": round(ce / n, 4),
        "perplexity": round(math.exp(min(20.0, ce / n)), 2),
        "randomCrossEntropy": round(rand_ce / n, 4),
        "randomTop1Pct": round(100.0 * rand_top1 / n, 2),
        "imperatorTop1Pct": round(100.0 * imp_exact1 / n, 2),
        "imperatorActionTypeTop1Pct": round(100.0 * imp_type1 / n, 2),
        "modelTop1Pct": round(100.0 * top1 / n, 2),
        "modelTop3Pct": round(100.0 * top3 / n, 2),
        "modelTop5Pct": round(100.0 * top5 / n, 2),
        "modelActionTypeTop1Pct": round(100.0 * type_top1 / n, 2),
        "modelTrueTypeProbMassPct": round(100.0 * type_prob_match / n, 2),
        "byActionType": {
            k: {
                "n": v["n"],
                "modelTop1Pct": round(100.0 * v["top1"] / v["n"], 1),
                "modelTop3Pct": round(100.0 * v["top3"] / v["n"], 1),
                "modelTypeAccPct": round(100.0 * v["type_ok"] / v["n"], 1),
                "impExact1Pct": round(100.0 * v["imp_exact1"] / v["n"], 1),
                "impType1Pct": round(100.0 * v["imp_type1"] / v["n"], 1),
            }
            for k, v in sorted(by_type.items(), key=lambda kv: -kv[1]["n"])
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="artifacts/datasets/human-behavior.jsonl")
    parser.add_argument("--val-match", default="up-20261116194704")
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--out-model", default="ai/models/policy-prototype.json")
    parser.add_argument("--out-eval", default="artifacts/datasets/policy-prototype-eval.json")
    args = parser.parse_args()

    t0 = time.time()
    records = load_dataset(args.data)
    matches = sorted({r["matchId"] for r in records})
    if args.val_match not in matches:
        raise ValueError(f"Unknown --val-match {args.val_match}, available: {matches}")

    feat_items = [featurize_record(r) for r in records]
    train_idx = [i for i, r in enumerate(records) if r["matchId"] != args.val_match]
    val_idx = [i for i, r in enumerate(records) if r["matchId"] == args.val_match]

    train_X_cat = np.concatenate([feat_items[i][0] for i in train_idx], axis=0)
    mean = np.mean(train_X_cat, axis=0)
    std = np.maximum(1e-3, np.std(train_X_cat, axis=0))

    train_data = [(np.clip((feat_items[i][0] - mean) / std, -8.0, 8.0), feat_items[i][1]) for i in train_idx]
    val_items = [feat_items[i] for i in val_idx]
    val_recs = [records[i] for i in val_idx]

    dim = train_X_cat.shape[1]
    rng = np.random.default_rng(42)

    # 1. Linear Baseline
    lin = LinearScorer(dim, l2=2e-4, lr=0.025)
    for ep in range(12):
        perm = rng.permutation(len(train_data))
        for start in range(0, len(perm), args.batch_size):
            batch = [train_data[k] for k in perm[start:start + args.batch_size]]
            lin.step(batch)
    lin_val = evaluate_split(val_items, val_recs, lin, mean, std)

    # 2. 2-Layer MLP Policy Scorer
    mlp = MLPScorer(dim, h1=96, h2=48, l2=3e-4, lr=3e-3, seed=42)
    best_ce = float("inf")
    best_state = mlp.state_dict()
    best_epoch = 0
    history = []
    for ep in range(1, args.epochs + 1):
        perm = rng.permutation(len(train_data))
        lr_scale = 0.5 * (1.0 + math.cos(math.pi * (ep - 1) / max(1, args.epochs)))
        lr_scale = max(0.15, lr_scale)
        tr_loss = 0.0
        nb = 0
        for start in range(0, len(perm), args.batch_size):
            batch = [train_data[k] for k in perm[start:start + args.batch_size]]
            tr_loss += mlp.step(batch, lr_scale=lr_scale)
            nb += 1
        val_metrics = evaluate_split(val_items, val_recs, mlp, mean, std)
        history.append({
            "epoch": ep,
            "trainLoss": round(tr_loss / max(1, nb), 4),
            "valLoss": val_metrics["crossEntropy"],
            "valTop1Pct": val_metrics["modelTop1Pct"],
            "valTop3Pct": val_metrics["modelTop3Pct"],
            "valTypeTop1Pct": val_metrics["modelActionTypeTop1Pct"],
        })
        if val_metrics["crossEntropy"] < best_ce:
            best_ce = val_metrics["crossEntropy"]
            best_state = mlp.state_dict()
            best_epoch = ep

    mlp.load_state_dict(best_state)
    mlp_val = evaluate_split(val_items, val_recs, mlp, mean, std)

    Path(args.out_model).parent.mkdir(parents=True, exist_ok=True)
    model_artifact = {
        "schema": "blades-of-hex.policy-prototype.v1",
        "trainMatches": [m for m in matches if m != args.val_match],
        "valMatch": args.val_match,
        "featureDim": int(dim),
        "bestEpoch": best_epoch,
        "normMean": [round(float(x), 6) for x in mean],
        "normStd": [round(float(x), 6) for x in std],
        "weights": {k: v.tolist() for k, v in best_state.items()},
    }
    Path(args.out_model).write_text(json.dumps(model_artifact), encoding="utf-8")

    summary = {
        "elapsedSec": round(time.time() - t0, 2),
        "trainMatchesCount": len(matches) - 1,
        "valMatch": args.val_match,
        "trainSamples": len(train_idx),
        "valSamples": len(val_idx),
        "featureDim": int(dim),
        "linearVal": {k: v for k, v in lin_val.items() if k != "byActionType"},
        "mlpBestEpoch": best_epoch,
        "mlpVal": mlp_val,
        "history": history,
    }
    Path(args.out_eval).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
