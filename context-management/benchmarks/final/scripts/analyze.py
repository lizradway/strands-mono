#!/usr/bin/env python3
"""
Analyze ContextBench benchmark results.
Usage: python scripts/analyze.py
"""

import json
import math
import re
from pathlib import Path
from functools import reduce

DATA_DIR = Path(__file__).parent.parent / "data"


def parse_progress_file(path):
    results = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            line = re.sub(r"^.*[✓✗]\s*", "", line)
            config = line.split(":")[0]
            tok = re.search(r"tokens=(\d+)K", line)
            cov = re.search(r"coverage=(\d+)%", line)
            prec = re.search(r"precision=([\d.]+)%", line)
            cyc = re.search(r"cycles=(\d+)", line)
            if tok and cov:
                results.append({
                    "config": config,
                    "tokens": int(tok.group(1)) * 1000,
                    "coverage": float(cov.group(1)) / 100,
                    "precision": float(prec.group(1)) / 100 if prec else 0,
                    "cycles": int(cyc.group(1)) if cyc else 0,
                })
    return results


def parse_json_results(path):
    with open(path) as f:
        data = json.load(f)
    results = []
    for r in data.get("results", []):
        if r.get("error"):
            continue
        results.append({
            "config": r["config"],
            "tokens": r["metrics"]["inputTokens"] + r["metrics"]["outputTokens"],
            "coverage": r["evaluation"]["fileCoverage"],
            "precision": r["evaluation"]["filePrecision"],
            "cycles": r["metrics"]["cycleCount"],
        })
    return results


def binomial_p(wins, n):
    total = 0
    for k in range(wins, n + 1):
        coeff = reduce(lambda a, b: a * b, range(n - k + 1, n + 1), 1) // reduce(lambda a, b: a * b, range(1, k + 1), 1)
        total += coeff * (0.5 ** n)
    return total


def sign_test(a, b, lower_is_better=True):
    wins = sum(1 for x, y in zip(a, b) if (x < y if lower_is_better else x > y))
    losses = sum(1 for x, y in zip(a, b) if (x > y if lower_is_better else x < y))
    n = wins + losses
    if n == 0:
        return {"wins": 0, "losses": 0, "ties": len(a), "p": 1.0}
    p = binomial_p(max(wins, losses), n)
    return {"wins": wins, "losses": losses, "ties": len(a) - n, "p": p}


def main():
    all_results = []
    for f in sorted(DATA_DIR.glob("*progress*.txt")):
        print(f"Loading {f.name}...")
        all_results.extend(parse_progress_file(f))
    for f in sorted(DATA_DIR.glob("*.json")):
        print(f"Loading {f.name}...")
        all_results.extend(parse_json_results(f))

    by_config = {}
    for r in all_results:
        c = r["config"]
        if c not in by_config:
            by_config[c] = []
        by_config[c].append(r)

    print(f"\n{len(all_results)} total results, {len(by_config)} configs\n")
    print(f"{'Config':<40} {'N':<4} {'Tokens':<10} {'Coverage':<10} {'Cycles'}")
    print("-" * 75)
    for c in sorted(by_config, key=lambda c: sum(r["tokens"] for r in by_config[c]) / len(by_config[c])):
        runs = by_config[c]
        print(f"{c:<40} {len(runs):<4} {sum(r['tokens'] for r in runs)//len(runs)//1000}K{'':<6} {sum(r['coverage'] for r in runs)/len(runs)*100:.0f}%{'':<6} {sum(r['cycles'] for r in runs)//len(runs)}")

    if "control" in by_config:
        control = by_config["control"]
        print(f"\n\nSIGN TESTS vs control ({len(control)} tasks)")
        print("=" * 75)
        print(f"{'Config':<40} {'Tok wins':<12} {'p(tok)':<10} {'Cov wins':<12} {'p(cov)'}")
        print("-" * 75)
        for c, runs in sorted(by_config.items()):
            if c == "control":
                continue
            n = min(len(runs), len(control))
            t = sign_test([r["tokens"] for r in runs[:n]], [r["tokens"] for r in control[:n]], lower_is_better=True)
            v = sign_test([r["coverage"] for r in runs[:n]], [r["coverage"] for r in control[:n]], lower_is_better=False)
            ts = "✓" if t["p"] < 0.05 else ""
            vs = "✓" if v["p"] < 0.05 else ""
            print(f"{c:<40} {t['wins']}/{n} {ts:<6} {t['p']:.4f}    {v['wins']}/{v['wins']+v['losses']} {vs:<6} {v['p']:.4f}")

        print(f"\n\nTAR vs control")
        print("=" * 75)
        ctrl_avg = sum(r["tokens"] for r in control) / len(control)
        print(f"{'Config':<40} {'Mean':<8} {'Median':<8} {'Trim10%':<8} {'95% CI (trim)'}")
        print("-" * 75)
        for c, runs in sorted(by_config.items()):
            if c == "control":
                continue
            n = min(len(runs), len(control))
            tars = [r["coverage"] * (ctrl_avg / r["tokens"]) for r in runs[:n]]
            mean = sum(tars) / len(tars)
            median = sorted(tars)[len(tars) // 2]
            trimmed = sorted(tars)[max(1, len(tars)//10):-max(1, len(tars)//10)]
            if trimmed:
                tm = sum(trimmed) / len(trimmed)
                tv = sum((t - tm)**2 for t in trimmed) / (len(trimmed)-1) if len(trimmed) > 1 else 0
                tse = math.sqrt(tv / len(trimmed))
            else:
                tm, tse = mean, 0
            sig = "✓" if tm - 1.96*tse > 1.0 else ""
            print(f"{c:<40} {mean:<8.2f} {median:<8.2f} {tm:<8.2f} [{tm-1.96*tse:.2f}, {tm+1.96*tse:.2f}] {sig}")


if __name__ == "__main__":
    main()
