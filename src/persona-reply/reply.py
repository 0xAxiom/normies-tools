#!/usr/bin/env python3
"""Persona-reply for any awakened Normie.

Reads cached /agents/info payload from ../../data/agents-info-<tokenId>.json
(or ../../data/agent-cards/<tokenId>.json) and assembles a model-ready prompt.

Two modes:
    (default) print the assembled {system, user} prompt + meta as JSON.
    --llm     send the prompt to a local Ollama model and print the reply.

Usage:
    python3 reply.py                              # Normie #7593 (default)
    python3 reply.py --token-id 294               # Normie #294
    python3 reply.py --llm "Why monochrome?"      # call LLM with custom question
    python3 reply.py --token-id 294 --llm "hello" # another Normie via LLM
    OLLAMA_MODEL=gemma3:27b python3 reply.py --llm  # override model

Ollama HTTP API only (localhost:11434). No external network, no on-chain calls.
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))
DEFAULT_TOKEN_ID = 7593
DEFAULT_Q = "Introduce yourself in one sentence."
OLLAMA_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3.5:9b")  # best persona fidelity (24/25 checks, 99w avg); 2b is faster but verbose+drifty


def find_persona_file(token_id: int) -> str:
    """Locate the agents-info cache file for a given token ID.
    Checks agents-info-<id>.json first, then agent-cards/<id>.json."""
    primary = os.path.join(DATA_DIR, f"agents-info-{token_id}.json")
    if os.path.exists(primary):
        return primary
    fallback = os.path.join(DATA_DIR, "agent-cards", f"{token_id}.json")
    if os.path.exists(fallback):
        return fallback
    sys.exit(f"No persona file found for token {token_id}. "
             f"Checked:\n  {primary}\n  {fallback}\n"
             f"Run: python3 src/agent-tools/profile.py {token_id}")


def load_persona(path: str) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def assemble(persona: dict, question: str) -> dict:
    return {
        "model_input": {
            "system": persona["systemPrompt"],
            "user": question,
        },
        "meta": {
            "tokenId": persona["tokenId"],
            "agentId": persona["agentId"],
            "name": persona["name"],
            "type": persona["type"],
            "registeredAt": persona["registeredAt"],
            "system_prompt_chars": len(persona["systemPrompt"]),
        },
    }


def call_llm(system: str, user: str, model: str = DEFAULT_MODEL) -> str:
    """POST the prompt to a local Ollama instance and return the reply text."""
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
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = json.load(resp)
    return body.get("message", {}).get("content", "").strip()


def main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Persona reply for any awakened Normie")
    ap.add_argument("question", nargs="?", default=DEFAULT_Q)
    ap.add_argument("--llm", action="store_true", help="send to local Ollama")
    ap.add_argument("--token-id", type=int, default=DEFAULT_TOKEN_ID,
                    help=f"Normie token ID (default: {DEFAULT_TOKEN_ID})")
    args = ap.parse_args(argv[1:])

    cache_path = find_persona_file(args.token_id)
    persona = load_persona(cache_path)
    out = assemble(persona, args.question)

    if not args.llm:
        print(json.dumps(out, indent=2))
        return 0

    mi = out["model_input"]
    reply = call_llm(mi["system"], mi["user"], DEFAULT_MODEL)
    print(json.dumps({
        "meta": out["meta"],
        "model": DEFAULT_MODEL,
        "question": args.question,
        "reply": reply,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
