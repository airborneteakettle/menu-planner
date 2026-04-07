import re
import requests

USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

NUTRIENT_IDS = {
    "calories":  1008,  # Energy (kcal)
    "protein_g": 1003,  # Protein
    "fat_g":     1004,  # Total lipid (fat)
    "carbs_g":   1005,  # Carbohydrate, by difference
}

# Strips leading quantities/units so "2 cups diced chicken breast" → "chicken breast"
_QUANTITY_RE = re.compile(
    r"^[\d\s/½¼¾⅓⅔⅛]+(?:cups?|tbsps?|tsps?|oz|lbs?|g|kg|ml|l|pounds?|ounces?|cloves?|slices?|cans?|pinch|dash)?\s*(?:of\s+)?",
    re.IGNORECASE,
)

def _extract_food_name(ingredient: str) -> str:
    name = _QUANTITY_RE.sub("", ingredient).strip()
    # Drop parenthetical notes like "(about 1 lb)"
    name = re.sub(r"\(.*?\)", "", name).strip()
    # Take the first meaningful chunk before a comma
    name = name.split(",")[0].strip()
    return name or ingredient


def _parse_nutrients(food_nutrients: list) -> dict:
    id_map = {v: k for k, v in NUTRIENT_IDS.items()}
    result = {k: 0.0 for k in NUTRIENT_IDS}
    for n in food_nutrients:
        nid = n.get("nutrientId") or (n.get("nutrient") or {}).get("id")
        if nid in id_map:
            result[id_map[nid]] = float(n.get("value") or 0)
    return result


def lookup_ingredient_nutrition(ingredient: str, api_key: str) -> dict | None:
    """
    Search USDA for an ingredient and return per-100g nutrition.
    Returns None if the lookup fails or returns no results.
    """
    food_name = _extract_food_name(ingredient)
    try:
        resp = requests.get(
            f"{USDA_BASE}/foods/search",
            params={"query": food_name, "pageSize": 1, "api_key": api_key},
            timeout=10,
        )
        resp.raise_for_status()
        foods = resp.json().get("foods", [])
        if not foods:
            return None
        return _parse_nutrients(foods[0].get("foodNutrients", []))
    except requests.RequestException:
        return None


def estimate_recipe_nutrition(ingredients: list[str], api_key: str) -> dict:
    """
    Estimate total recipe nutrition by summing per-100g values for each ingredient.
    This is a rough estimate — accurate only when ingredient quantities aren't parsed.
    """
    totals = {"calories": 0.0, "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 0.0}
    for ingredient in ingredients:
        nutrition = lookup_ingredient_nutrition(ingredient, api_key)
        if nutrition:
            for key in totals:
                totals[key] += nutrition.get(key, 0.0)
    return totals
