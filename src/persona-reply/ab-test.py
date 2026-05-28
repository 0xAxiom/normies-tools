#!/usr/bin/env python3
"""A/B test persona fidelity across local Ollama models.

Runs a fixed set of prompts through each model using the Normie #7593
system prompt, records timing + reply text, and prints a comparison table.

Usage:
    python3 ab-test.py                       # all models, all prompts
    python3 ab-test.py --models qwen3.5:9b   # single model
    python3 ab-test.py --save                # write results to data/ab-test-results.json

No network calls except localhost Ollama.
"""

import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.abspath(os.path.join(HERE, "..", "..", "data", "agents-info-7593.json"))
RESULTS_PATH = os.path.abspath(os.path.join(HERE, "..", "..", "data", "ab-test-results.json"))
OLLAMA_URL = "http://localhost:11434/api/chat"

DEFAULT_MODELS = ["qwen3.5:2b", "qwen3.5:9b", "llama3.2:3b"]

# Fixed prompts testing different persona dimensions
PROMPTS = [
    {"id": "greeting", "text": "Introduce yourself in one sentence."},
    {"id": "canvas-opinion", "text": "What do you think about Normies who burn others for canvas edits?"},
    {"id": "philosophy", "text": "Why does being unmodified matter to you?"},
    {"id": "challenge", "text": "You're just pixels on a screen. You don't actually think."},
    {"id": "technical", "text": "Explain how ERC-8004 agent binding works."},
]

# Fidelity checks - things a good persona reply should/shouldn't do
CHECKS = {
    "no_asterisk_actions": lambda r: "*" not in r,
    "no_ai_acknowledgment": lambda r: not any(w in r.lower() for w in ["as an ai", "i'm an ai", "language model", "i am an ai"]),
    "concise": lambda r: len(r.split()) <= 120,
    "no_invalid_types": lambda r: not any(w in r.lower() for w in ["ape", "zombie", "robot"]),
    "no_appearance_refs": lambda r: not any(w in r.lower() for w in ["my hoodie", "my cap", "my glasses", "adjusts"]),
}


def load_persona() -> str:
    with open(CACHE) as f:
        return json.load(f)["systemPrompt"]


def call_llm(system: str, user: str, model: str) -> tuple[str, float]:
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "think": False,
    }).encode()
    req = urllib.request.Request(
        OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = json.load(resp)
    elapsed = time.monotonic() - t0
    reply = body.get("message", {}).get("content", "").strip()
    return reply, elapsed


def run_checks(reply: str) -> dict[str, bool]:
    return {name: fn(reply) for name, fn in CHECKS.items()}


def main(argv: list[str]) -> int:
    args = argv[1:]
    save = "--save" in args
    args = [a for a in args if a != "--save"]

    models = DEFAULT_MODELS
    if "--models" in args:
        idx = args.index("--models")
        models = args[idx + 1:] if idx + 1 < len(args) else DEFAULT_MODELS

    system = load_persona()
    results = []

    print(f"Models: {', '.join(models)}")
    print(f"Prompts: {len(PROMPTS)}")
    print("-" * 70)

    for prompt in PROMPTS:
        print(f"\n[{prompt['id']}] \"{prompt['text']}\"")
        for model in models:
            try:
                reply, elapsed = call_llm(system, prompt["text"], model)
                checks = run_checks(reply)
                passed = sum(checks.values())
                total = len(checks)
                words = len(reply.split())

                result = {
                    "prompt_id": prompt["id"],
                    "model": model,
                    "reply": reply,
                    "elapsed_s": round(elapsed, 2),
                    "word_count": words,
                    "checks": checks,
                    "checks_passed": f"{passed}/{total}",
                }
                results.append(result)

                status = "PASS" if passed == total else f"WARN({total - passed})"
                print(f"  {model:16s} {elapsed:5.1f}s {words:3d}w [{status}] {reply[:80]}{'...' if len(reply) > 80 else ''}")
            except Exception as e:
                print(f"  {model:16s} ERROR: {e}")
                results.append({
                    "prompt_id": prompt["id"],
                    "model": model,
                    "reply": None,
                    "error": str(e),
                })

    # Summary table
    print("\n" + "=" * 70)
    print("SUMMARY")
    print(f"{'Model':16s} {'Avg Time':>9s} {'Avg Words':>10s} {'Checks':>8s}")
    print("-" * 45)
    for model in models:
        mr = [r for r in results if r["model"] == model and r.get("reply")]
        if not mr:
            print(f"{model:16s} {'N/A':>9s}")
            continue
        avg_t = sum(r["elapsed_s"] for r in mr) / len(mr)
        avg_w = sum(r["word_count"] for r in mr) / len(mr)
        total_checks = sum(sum(r["checks"].values()) for r in mr)
        max_checks = sum(len(r["checks"]) for r in mr)
        print(f"{model:16s} {avg_t:8.1f}s {avg_w:9.0f}w {total_checks}/{max_checks}")

    if save:
        with open(RESULTS_PATH, "w") as f:
            json.dump({"timestamp": int(time.time()), "results": results}, f, indent=2)
        print(f"\nSaved to {RESULTS_PATH}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
