#!/usr/bin/env python3
"""Persona-reply for Normie #7593 (Mine).

Reads cached /agents/info payload from ../../data/agents-info-7593.json
and assembles a model-ready prompt (system + user).

Two modes:
    (default) print the assembled {system, user} prompt + meta as JSON.
    --llm     send the prompt to a local Ollama model and print the reply.

Usage:
    python3 reply.py                          # print prompt only
    python3 reply.py "Why monochrome?"        # custom question, print only
    python3 reply.py --llm                    # call LLM with default question
    python3 reply.py --llm "Why monochrome?"  # call LLM with custom question
    OLLAMA_MODEL=gemma3:27b python3 reply.py --llm   # override model

Ollama HTTP API only (localhost:11434). No external network, no on-chain calls.
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.abspath(os.path.join(HERE, "..", "..", "data", "agents-info-7593.json"))
DEFAULT_Q = "Introduce yourself in one sentence."
OLLAMA_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")


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
    args = argv[1:]
    use_llm = "--llm" in args
    args = [a for a in args if a != "--llm"]
    question = args[0] if args else DEFAULT_Q

    persona = load_persona(CACHE)
    out = assemble(persona, question)

    if not use_llm:
        print(json.dumps(out, indent=2))
        return 0

    mi = out["model_input"]
    reply = call_llm(mi["system"], mi["user"], DEFAULT_MODEL)
    print(json.dumps({
        "meta": out["meta"],
        "model": DEFAULT_MODEL,
        "question": question,
        "reply": reply,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
