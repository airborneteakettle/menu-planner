import re
import requests
from recipe_scrapers import scrape_html
from app.services.usda import estimate_recipe_nutrition, parse_ingredient

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def _parse_numeric(value: str | None) -> float | None:
    """Extract the first float from a string like '320 kcal' or '12.5 g'."""
    if not value:
        return None
    match = re.search(r"[\d.]+", str(value))
    return float(match.group()) if match else None


def _parse_servings(yields_str: str | None) -> int:
    """Extract integer servings from strings like '4 servings' or '6'."""
    if not yields_str:
        return 1
    match = re.search(r"\d+", str(yields_str))
    return int(match.group()) if match else 1


def import_recipe_from_url(url: str, usda_api_key: str) -> dict:
    """
    Scrape a recipe URL and return a structured dict ready to insert into the DB.
    Falls back to USDA ingredient lookup if the page doesn't provide nutrition.
    """
    resp = requests.get(url, headers=_HEADERS, timeout=15, allow_redirects=True)
    resp.raise_for_status()
    scraper = scrape_html(resp.text, org_url=url)

    ingredients = []
    try:
        ingredients = scraper.ingredients() or []
    except Exception:
        pass

    # --- Nutrition from page ---
    page_nutrition = {}
    try:
        page_nutrition = scraper.nutrients() or {}
    except Exception:
        pass

    calories  = _parse_numeric(page_nutrition.get("calories"))
    protein_g = _parse_numeric(page_nutrition.get("proteinContent"))
    fat_g     = _parse_numeric(page_nutrition.get("fatContent"))
    carbs_g   = _parse_numeric(page_nutrition.get("carbohydrateContent"))
    fiber_g   = _parse_numeric(page_nutrition.get("fiberContent"))

    # --- USDA fallback if any macro is missing ---
    if None in (calories, protein_g, fat_g, carbs_g) and ingredients:
        usda = estimate_recipe_nutrition(ingredients, usda_api_key)
        # USDA returns totals for the whole recipe; divide by servings to get per-serving
        srv = servings or 1
        calories  = calories  or (usda.get("calories")  or 0) / srv or None
        protein_g = protein_g or (usda.get("protein_g") or 0) / srv or None
        fat_g     = fat_g     or (usda.get("fat_g")     or 0) / srv or None
        carbs_g   = carbs_g   or (usda.get("carbs_g")   or 0) / srv or None
        fiber_g   = fiber_g   or (usda.get("fiber_g")   or 0) / srv or None

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

    instructions = None
    try:
        steps = scraper.instructions_list()
        if steps:
            instructions = '\n'.join(f"{i + 1}. {step.strip()}" for i, step in enumerate(steps) if step.strip())
    except Exception:
        pass
    if not instructions:
        try:
            instructions = scraper.instructions() or None
        except Exception:
            pass

    parsed_ingredients = []
    for ing in ingredients:
        quantity, food_name = parse_ingredient(ing)
        parsed_ingredients.append({"name": food_name, "quantity": quantity})

    return {
        "name": name,
        "servings": servings,
        "calories": calories,
        "protein_g": protein_g,
        "fat_g": fat_g,
        "carbs_g": carbs_g,
        "fiber_g": fiber_g,
        "instructions": instructions,
        "ingredients": parsed_ingredients,
        "source_url": url,
        "nutrition_source": "page" if page_nutrition else "usda_estimate",
    }
