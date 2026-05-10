#!/usr/bin/env python3
"""
scrape_recipe.py — Scrape a recipe URL from your local machine and optionally
push it straight into the webapp.

Running locally uses your home IP rather than the server's, which sidesteps
blocks that many recipe sites place on cloud/datacenter addresses.

Usage
-----
# Print JSON to stdout:
  python scripts/scrape_recipe.py <url>

# Save JSON to a file (review before pushing):
  python scripts/scrape_recipe.py <url> -o recipe.json

# Push directly to the webapp (prompts for password):
  python scripts/scrape_recipe.py <url> --push https://your-server.com -u joe

# Site blocks automated requests? Save the page in your browser
# (Ctrl+S → "Webpage, Complete"), then pass the HTML file:
  python scripts/scrape_recipe.py <url> --html ~/Downloads/recipe.html --push ...

Dependencies (already in requirements.txt):
  pip install requests recipe-scrapers
"""

import argparse
import getpass
import json
import re
import sys
from fractions import Fraction

try:
    import requests
    from recipe_scrapers import scrape_html
except ImportError:
    sys.exit("Missing dependencies. Run: pip install requests recipe-scrapers")

# ── Constants ─────────────────────────────────────────────────────────────────

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

_FRAC_UNICODE = {
    "½": "1/2", "¼": "1/4", "¾": "3/4",
    "⅓": "1/3", "⅔": "2/3", "⅛": "1/8",
}

_UNITS = {
    "cup", "cups", "tablespoon", "tablespoons", "tbsp", "tbsps",
    "teaspoon", "teaspoons", "tsp", "tsps",
    "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
    "g", "gram", "grams", "kg", "kilogram", "kilograms",
    "ml", "milliliter", "milliliters", "l", "liter", "liters",
    "clove", "cloves", "can", "cans", "package", "packages", "pkg",
    "slice", "slices", "piece", "pieces", "bunch", "bunches",
    "sprig", "sprigs", "head", "heads", "stalk", "stalks",
    "pinch", "pinches", "dash", "dashes",
}

_UGLY_FLOAT_RE = re.compile(r"\d*\.\d{4,}")


# ── Quantity helpers ──────────────────────────────────────────────────────────

def _float_to_frac(f: float) -> str:
    frac = Fraction(f).limit_denominator(8)
    whole = int(frac)
    remainder = frac - whole
    if remainder == 0:
        return str(whole)
    frac_str = f"{remainder.numerator}/{remainder.denominator}"
    return f"{whole} {frac_str}" if whole else frac_str


def _prettify_quantity(qty: str | None) -> str | None:
    if not qty:
        return qty
    return _UGLY_FLOAT_RE.sub(lambda m: _float_to_frac(float(m.group())), qty)


def _parse_ingredient(raw: str) -> tuple[str | None, str]:
    """Split a raw ingredient string into (quantity, name)."""
    s = raw.strip()
    for ch, rep in _FRAC_UNICODE.items():
        s = s.replace(ch, rep)

    tokens = s.split()
    qty_tokens: list[str] = []
    i = 0

    # Collect leading numeric tokens (integer, decimal, or fraction like "1/2")
    while i < len(tokens) and re.match(r"^\d+([./]\d+)?$", tokens[i]):
        qty_tokens.append(tokens[i])
        i += 1

    # Optional unit immediately after the number(s)
    if i < len(tokens) and tokens[i].lower().rstrip(".,") in _UNITS:
        qty_tokens.append(tokens[i])
        i += 1

    qty  = _prettify_quantity(" ".join(qty_tokens)) if qty_tokens else None
    name = " ".join(tokens[i:]).strip() or raw
    return qty, name


def _parse_numeric(value) -> float | None:
    if not value:
        return None
    m = re.search(r"[\d.]+", str(value))
    return float(m.group()) if m else None


def _parse_servings(yields_str) -> int:
    if not yields_str:
        return 1
    m = re.search(r"\d+", str(yields_str))
    return int(m.group()) if m else 1


# ── Scraping ──────────────────────────────────────────────────────────────────

def scrape(url: str, html_file: str | None = None) -> dict:
    """Fetch and parse a recipe page. Returns a payload dict for the webapp."""
    if html_file:
        with open(html_file, encoding="utf-8", errors="replace") as f:
            html = f.read()
        _log(f"Loaded HTML from {html_file} ({len(html):,} bytes)")
    else:
        _log(f"Fetching {url} ...")
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=20, allow_redirects=True)
        except requests.RequestException as exc:
            sys.exit(f"Network error: {exc}")

        if resp.status_code == 403:
            sys.exit(
                "Blocked (403). The site is rejecting automated requests.\n\n"
                "Fix: open the page in your browser, save it (Ctrl+S → Webpage, Complete),\n"
                "then re-run with:  --html /path/to/saved.html"
            )
        try:
            resp.raise_for_status()
        except requests.HTTPError as exc:
            sys.exit(f"HTTP error: {exc}")

        html = resp.text
        _log(f"Fetched {len(html):,} bytes (HTTP {resp.status_code})")

    scraper = scrape_html(html, org_url=url)

    name = ""
    try:
        name = scraper.title() or ""
    except Exception:
        pass

    servings = 1
    try:
        servings = _parse_servings(scraper.yields())
    except Exception:
        pass

    raw_ingredients: list[str] = []
    try:
        raw_ingredients = scraper.ingredients() or []
    except Exception:
        pass

    page_nutrition: dict = {}
    try:
        page_nutrition = scraper.nutrients() or {}
    except Exception:
        pass

    instructions = None
    try:
        steps = scraper.instructions_list()
        if steps:
            instructions = "\n".join(
                f"{i + 1}. {step.strip()}"
                for i, step in enumerate(steps)
                if step.strip()
            )
    except Exception:
        pass
    if not instructions:
        try:
            instructions = scraper.instructions() or None
        except Exception:
            pass

    ingredients = []
    for raw in raw_ingredients:
        qty, food_name = _parse_ingredient(raw)
        ingredients.append({"name": food_name, "quantity": qty})

    if not name:
        _warn("Could not extract recipe name — edit the JSON before pushing.")
    if not ingredients:
        _warn("No ingredients found — the scraper may not support this site.")

    _log(
        f"Parsed: {name!r} | {servings} servings | "
        f"{len(ingredients)} ingredients | "
        f"nutrition={'page' if page_nutrition else 'none'}"
    )

    return {
        "name":             name,
        "servings":         servings,
        "calories":         _parse_numeric(page_nutrition.get("calories")),
        "protein_g":        _parse_numeric(page_nutrition.get("proteinContent")),
        "fat_g":            _parse_numeric(page_nutrition.get("fatContent")),
        "carbs_g":          _parse_numeric(page_nutrition.get("carbohydrateContent")),
        "fiber_g":          _parse_numeric(page_nutrition.get("fiberContent")),
        "instructions":     instructions,
        "ingredients":      ingredients,
        "source_url":       url,
        "nutrition_source": "page" if page_nutrition else None,
    }


# ── Push ──────────────────────────────────────────────────────────────────────

def push(payload: dict, webapp_url: str, username: str, password: str) -> dict:
    """Login and POST the payload to the webapp's import-payload endpoint."""
    base = webapp_url.rstrip("/")
    session = requests.Session()

    _log(f"Logging in to {base} as {username!r} ...")
    login_resp = session.post(
        f"{base}/login",
        data={"username": username, "password": password},
        allow_redirects=True,
        timeout=15,
    )
    # On failure Flask re-renders /login; on success it redirects away from it
    if "/login" in login_resp.url:
        sys.exit("Login failed — check your username and password.")
    _log("Logged in successfully.")

    _log(f"Pushing '{payload['name']}' ...")
    push_resp = session.post(
        f"{base}/api/recipes/import-payload",
        json=payload,
        timeout=30,
    )
    if not push_resp.ok:
        sys.exit(
            f"Push failed (HTTP {push_resp.status_code}):\n{push_resp.text[:400]}"
        )

    result = push_resp.json()
    action = "Updated existing" if result.get("_updated") else "Created new"
    _log(f"{action} recipe: {result['name']!r} (id={result['id']})")
    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _warn(msg: str) -> None:
    print(f"Warning: {msg}", file=sys.stderr)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape a recipe locally and optionally push it to the webapp.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("url", help="Recipe URL to scrape")
    parser.add_argument(
        "-o", "--output", metavar="FILE",
        help="Save JSON to a file instead of printing to stdout",
    )
    parser.add_argument(
        "--html", metavar="FILE",
        help="Parse from a saved HTML file instead of fetching the URL",
    )
    parser.add_argument(
        "--push", metavar="URL",
        help="Webapp base URL to push the recipe to (e.g. https://your-server.com)",
    )
    parser.add_argument("-u", "--username", help="Webapp username (required with --push)")
    parser.add_argument("-p", "--password", help="Webapp password (prompted if omitted)")
    args = parser.parse_args()

    if args.push and not args.username:
        parser.error("--username is required when using --push")

    payload = scrape(args.url, html_file=args.html)

    json_out = json.dumps(payload, indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(json_out)
        _log(f"Saved to {args.output}")
    elif not args.push:
        # Default: print JSON to stdout so it can be piped or reviewed
        print(json_out)

    if args.push:
        password = args.password or getpass.getpass(f"Password for {args.username}: ")
        result = push(payload, args.push, args.username, password)
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
