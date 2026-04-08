import re
from recipe_scrapers import scrape_me
from app.services.usda import estimate_recipe_nutrition, parse_ingredient


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
    scraper = scrape_me(url)

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

    # --- USDA fallback if any macro is missing ---
    if None in (calories, protein_g, fat_g, carbs_g) and ingredients:
        usda = estimate_recipe_nutrition(ingredients, usda_api_key)
        calories  = calories  or usda.get("calories")
        protein_g = protein_g or usda.get("protein_g")
        fat_g     = fat_g     or usda.get("fat_g")
        carbs_g   = carbs_g   or usda.get("carbs_g")

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
        "instructions": instructions,
        "ingredients": parsed_ingredients,
        "source_url": url,
        "nutrition_source": "page" if page_nutrition else "usda_estimate",
    }
