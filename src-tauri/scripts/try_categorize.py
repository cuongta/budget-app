"""Try local Ollama models on categorizing bank transaction descriptions.

Usage:
    python3 scripts/try_categorize.py <statement.csv> <model> [<model> ...]

Example (from src-tauri/):
    python3 scripts/try_categorize.py bank-statements/stmt.csv gemma3:270m llama3.2

Reads a Bank of America CSV export, sends every description to each model in one
batched request (answers restricted to CATEGORIES via a JSON schema), and prints
each model's choices and timing. Needs Ollama running on localhost:11434.
"""

import csv
import io
import json
import sys
import time
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/chat"

CATEGORIES = [
    "Groceries", "Dining", "Transport", "Shopping", "Utilities", "Housing",
    "Subscriptions", "Health", "Income", "Transfers", "Credit Card Payment", "Other",
]

PROMPT = """Categorize each bank transaction description into exactly one category.
Categories: {cats}

Transactions:
{lines}

Answer with JSON: {{"results": [{{"id": <id>, "category": <category>}}, ...]}} covering every id."""

SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "category": {"type": "string", "enum": CATEGORIES},
                },
                "required": ["id", "category"],
            },
        }
    },
    "required": ["results"],
}


def load_descriptions(path):
    """Descriptions of real transactions; skips the summary block and balance-only rows."""
    text = open(path, encoding="utf-8-sig").read()
    start = text.find("Date,Description")
    if start < 0:
        sys.exit(f"{path}: no 'Date,Description' header found")
    rows = csv.DictReader(io.StringIO(text[start:]))
    return [r["Description"] for r in rows if (r.get("Amount") or "").strip()]


def categorize(model, descriptions):
    lines = "\n".join(f"{i}: {d}" for i, d in enumerate(descriptions))
    body = {
        "model": model,
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0},
        "messages": [{
            "role": "user",
            "content": PROMPT.format(cats=", ".join(CATEGORIES), lines=lines),
        }],
    }
    req = urllib.request.Request(
        OLLAMA_URL, json.dumps(body).encode(), {"Content-Type": "application/json"}
    )
    start = time.time()
    out = json.load(urllib.request.urlopen(req, timeout=600))
    elapsed = time.time() - start
    results = json.loads(out["message"]["content"])["results"]
    return {r["id"]: r["category"] for r in results}, elapsed


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    descriptions = load_descriptions(sys.argv[1])
    for model in sys.argv[2:]:
        got, elapsed = categorize(model, descriptions)
        print(f"\n== {model}: {len(descriptions)} descriptions in {elapsed:.1f}s")
        for i, d in enumerate(descriptions):
            print(f"  {d[:60]:60} -> {got.get(i, '<missing>')}")


if __name__ == "__main__":
    main()
