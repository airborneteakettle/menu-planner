import re
import requests

USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

NUTRIENT_IDS = {
    "calories":  1008,  # Energy (kcal)
    "protein_g": 1003,  # Protein
    "fat_g":     1004,  # Total lipid (fat)
    "carbs_g":   1005,  # Carbohydrate, by difference
    "fiber_g":   1079,  # Fiber, total dietary
}

# Strips leading quantities/units so "2 cups diced chicken breast" → "chicken breast"
_QUANTITY_RE = re.compile(
    r"^[\d\s./½¼¾⅓⅔⅛]+"
    r"(?:tablespoons?|teaspoons?|fluid\s+ounces?|fluid\s+oz|"
    r"cups?|pounds?|ounces?|"
    r"tbsps?|tsps?|lbs?|oz|"
    r"stalks?|sprigs?|heads?|bunches?|cloves?|slices?|cans?|"
    r"pinch(?:es)?|dash(?:es)?"
    r"|kg|mg|ml|g\b|l\b)?"
    r"\s*(?:of\s+)?",
    re.IGNORECASE,
)

_CITRUS_RE = re.compile(
    r'(?:from|of)\s+(\d+)\s+(lemon|lime|orange|grapefruit)s?\b',
    re.IGNORECASE,
)

# ── Quantity → grams conversion ───────────────────────────────────────────────
# Volume units use approximate water density; dry ingredients will be off but
# it's better than ignoring the quantity entirely.
_UNIT_GRAMS: dict[str, float] = {
    # Weight
    'g': 1.0, 'gram': 1.0, 'grams': 1.0,
    'mg': 0.001,
    'kg': 1000.0,
    'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
    'lb': 453.59, 'lbs': 453.59, 'pound': 453.59, 'pounds': 453.59,
    # Volume
    'ml': 1.0, 'milliliter': 1.0, 'milliliters': 1.0,
    'l': 1000.0, 'liter': 1000.0, 'liters': 1000.0,
    'fl oz': 29.57, 'fluid oz': 29.57, 'fluid ounce': 29.57, 'fluid ounces': 29.57,
    'tsp': 5.0, 'teaspoon': 5.0, 'teaspoons': 5.0,
    'tbsp': 15.0, 'tablespoon': 15.0, 'tablespoons': 15.0,
    'cup': 240.0, 'cups': 240.0,
    # Approximate counts
    'clove': 3.0,  'cloves': 3.0,
    'slice': 25.0, 'slices': 25.0,
    'pinch': 0.3,  'pinches': 0.3,
    'dash':  0.6,  'dashes':  0.6,
    'can':   400.0, 'cans':   400.0,
    'bunch': 100.0, 'bunches': 100.0,
    'sprig': 5.0,  'sprigs':  5.0,
    'stalk': 40.0, 'stalks':  40.0,
    'head':  500.0, 'heads':  500.0,
}

_FRAC_CHARS = {'½': '.5', '¼': '.25', '¾': '.75', '⅓': '.333', '⅔': '.667', '⅛': '.125'}


def _parse_amount(s: str) -> float:
    """Parse '2', '1/2', '1 1/2', '1½' etc. → float."""
    for char, val in _FRAC_CHARS.items():
        s = s.replace(char, ' ' + val)
    total = 0.0
    for part in s.split():
        try:
            if '/' in part:
                num, den = part.split('/', 1)
                total += float(num) / float(den)
            else:
                total += float(part)
        except (ValueError, ZeroDivisionError):
            pass
    return total


def quantity_to_grams(quantity_str: str | None) -> float | None:
    """
    Convert a quantity string like "2 tbsp" or "1/2 cup" to grams.
    Returns None when the unit is unrecognised or no quantity is present.
    """
    if not quantity_str:
        return None
    s = quantity_str.strip()
    # Sort units longest-first so "fl oz" matches before "oz"
    for unit, gperu in sorted(_UNIT_GRAMS.items(), key=lambda x: -len(x[0])):
        m = re.match(
            r'^([\d\s./½¼¾⅓⅔⅛]+)\s*' + re.escape(unit) + r'\b',
            s, re.IGNORECASE,
        )
        if m:
            amount = _parse_amount(m.group(1))
            return amount * gperu if amount > 0 else None
    # Bare number with no unit → treat each "whole" item as 100 g
    m = re.match(r'^([\d\s./½¼¾⅓⅔⅛]+)$', s)
    if m:
        amount = _parse_amount(m.group(1))
        return amount * 100.0 if amount > 0 else None
    return None


# ── Core ingredient parsing ───────────────────────────────────────────────────

_LEADING_ADJ_RE = re.compile(
    r"^(?:fresh(?:ly)?|very\s+ripe|ripe|crisp|small|medium|large|extra[- ]?large|"
    r"coarsely|finely|thinly|roughly|lightly|loosely\s+packed|packed|"
    r"frozen|canned|dried|ground|whole|"
    r"low[- ]fat|fat[- ]free|"
    r"sharp|smooth|plain|greek[- ]?style)\s+",
    re.IGNORECASE,
)


def parse_ingredient(ingredient_str: str) -> tuple[str | None, str]:
    """
    Split a raw ingredient string into (quantity, food_name).
    e.g. "2 cups diced chicken breast, boneless" → ("2 cups", "chicken breast")
    """
    m = _CITRUS_RE.search(ingredient_str)
    if m:
        return m.group(1), m.group(2).lower()

    match = _QUANTITY_RE.match(ingredient_str)
    if match:
        quantity  = match.group().strip() or None
        food_name = ingredient_str[match.end():].strip()
    else:
        quantity  = None
        food_name = ingredient_str

    food_name = re.sub(r"\(.*?\)", "", food_name)
    food_name = re.sub(r"[*†‡§#@~^`|\\]", "", food_name)
    food_name = re.sub(r"\$[\d.,]+", "", food_name)
    food_name = re.sub(
        r",\s*(diced|chopped|sliced|minced|crushed|grated|shredded|beaten|"
        r"softened|melted|cooked|frozen|thawed|peeled|seeded|cored|trimmed|"
        r"halved|quartered|divided|at room temperature|optional|for serving|to taste|"
        r"thinly|coarsely|finely|roughly|freshly|loosely packed|cut into.*).*$",
        "", food_name, flags=re.IGNORECASE,
    )
    # Strip "or [alternative]" — keep only the first option
    food_name = re.sub(r"\s+or\s+\S.*$", "", food_name, flags=re.IGNORECASE)
    # Strip leading preparation/size adjectives (up to 3 passes for stacked adjectives)
    for _ in range(3):
        cleaned = _LEADING_ADJ_RE.sub("", food_name)
        if cleaned == food_name:
            break
        food_name = cleaned
    food_name = re.sub(r"\s{2,}", " ", food_name).strip(" \t.,;:-")
    return quantity, food_name or ingredient_str


def _parse_nutrients(food_nutrients: list) -> dict:
    id_map = {v: k for k, v in NUTRIENT_IDS.items()}
    result = {k: 0.0 for k in NUTRIENT_IDS}
    for n in food_nutrients:
        nid = n.get("nutrientId") or (n.get("nutrient") or {}).get("id")
        if nid in id_map:
            result[id_map[nid]] = float(n.get("value") or 0)
    return result


# ── Volume-unit → grams via USDA portion data ─────────────────────────────────

# Units where water density (240 g/cup) is reliable (liquids/thin liquids)
_LIQUID_UNITS = frozenset([
    'ml', 'l', 'liter', 'liters',
    'fl oz', 'fluid oz', 'fluid ounce', 'fluid ounces',
])

# Canonical names used in USDA measureUnit records
_UNIT_TO_USDA = {
    'cup': 'cup',   'cups': 'cup',
    'tbsp': 'tablespoon', 'tablespoon': 'tablespoon', 'tablespoons': 'tablespoon',
    'tsp':  'teaspoon',   'teaspoon':  'teaspoon',    'teaspoons':   'teaspoon',
}


def _parse_qty_parts(quantity_str: str) -> tuple[float, str] | None:
    """Return (amount, unit_lowercase) from a quantity string, or None."""
    s = quantity_str.strip()
    for char, val in _FRAC_CHARS.items():
        s = s.replace(char, ' ' + val)
    m = re.match(r'^([\d\s./]+)\s*([a-zA-Z].*)$', s)
    if m:
        return _parse_amount(m.group(1)), m.group(2).strip().lower()
    m = re.match(r'^([\d\s./]+)$', s)
    if m:
        return _parse_amount(m.group(1)), ''
    return None


def _fetch_portion_grams(fdc_id: int, amount: float, unit: str, api_key: str) -> float | None:
    """
    Fetch USDA food portions and return gram weight for the given volume measure.
    E.g. "1 cup almonds" → looks up "cup" in foodPortions → returns ~143 g.
    Returns None if no matching portion is found.
    """
    target = _UNIT_TO_USDA.get(unit)
    if not target:
        return None
    try:
        resp = requests.get(
            f"{USDA_BASE}/food/{fdc_id}",
            params={"api_key": api_key},
            timeout=10,
        )
        if not resp.ok:
            return None
        portions = resp.json().get("foodPortions", [])
        for p in portions:
            mu   = p.get("measureUnit") or {}
            name = (mu.get("name") or "").lower().strip()
            abbr = (mu.get("abbreviation") or "").lower().strip()
            gram_weight = float(p.get("gramWeight") or 0)
            p_amount    = float(p.get("amount")     or 1)
            if target in (name, abbr) and gram_weight > 0:
                return gram_weight * amount / p_amount
    except Exception:
        pass
    return None


# ── Public lookup ─────────────────────────────────────────────────────────────

def _usda_serving_grams(food: dict) -> float | None:
    """Return the serving size in grams from a USDA food record, if available."""
    size = food.get("servingSize")
    unit = (food.get("servingSizeUnit") or "").lower().strip()
    if not size:
        return None
    if unit in ("g", "gram", "grams"):
        return float(size)
    if unit in ("oz", "ounce", "ounces"):
        return float(size) * 28.35
    return None


def lookup_ingredient_nutrition(ingredient: str, api_key: str) -> dict | None:
    """
    Search USDA for an ingredient and return nutrition scaled to the actual
    quantity in the string.

    - "to taste" / "as needed" items return None (negligible nutrition).
    - Searches Foundation + SR Legacy only to avoid weird branded results.
    - Uses the food's own serving size when the quantity is a bare count (e.g. "1 apple").
    - Falls back to per-100 g when no quantity or unit is recognised.
    """
    # Seasonings / garnishes added "to taste" or with no measured quantity
    if re.search(r"\bto\s+taste\b|\bas\s+needed\b", ingredient, re.IGNORECASE):
        return None

    quantity_str_check, _ = parse_ingredient(ingredient)
    if quantity_str_check is None and re.search(
        r"\b(salt|pepper|seasoning|spice|flakes)\b", ingredient, re.IGNORECASE
    ):
        return None

    quantity_str, food_name = parse_ingredient(ingredient)
    try:
        resp = requests.get(
            f"{USDA_BASE}/foods/search",
            params={
                "query":    food_name,
                "pageSize": 5,
                "api_key":  api_key,
                "dataType": "Foundation,SR Legacy",
            },
            timeout=10,
        )
        resp.raise_for_status()
        foods = resp.json().get("foods", [])
        if not foods:
            return None
        # Prefer the first result that has non-zero calories
        def _has_calories(f):
            return any(
                float(n.get("value") or 0) > 0 and
                (n.get("nutrientId") == 1008 or (n.get("nutrient") or {}).get("id") == 1008)
                for n in f.get("foodNutrients", [])
            )
        food = next((f for f in foods if _has_calories(f)), foods[0])
        per_100g = _parse_nutrients(food.get("foodNutrients", []))
    except requests.RequestException:
        return None

    grams = quantity_to_grams(quantity_str)

    # For non-liquid volume units (cup, tbsp, tsp), water density is wrong for
    # dry ingredients. Use the USDA food's own portion data when available.
    if grams is not None and quantity_str:
        parts = _parse_qty_parts(quantity_str)
        if parts:
            qty_amount, qty_unit = parts
            if qty_unit in _UNIT_TO_USDA and qty_unit not in _LIQUID_UNITS:
                portion_g = _fetch_portion_grams(food["fdcId"], qty_amount, qty_unit, api_key)
                if portion_g is not None:
                    grams = portion_g

    # Bare-count fallback: "1 apple", "2 shallots" — use the food's own serving size
    # rather than the 100 g default so whole items aren't wildly over-estimated.
    if grams is None and quantity_str:
        bare = re.match(r"^([\d\s./½¼¾⅓⅔⅛]+)$", quantity_str.strip())
        if bare:
            serving_g = _usda_serving_grams(food)
            if serving_g:
                grams = _parse_amount(bare.group(1)) * serving_g

    if grams is not None:
        scale = grams / 100.0
        return {k: v * scale for k, v in per_100g.items()}
    # No quantity at all → return per-100 g as a rough estimate
    return per_100g


def estimate_recipe_nutrition(ingredients: list[str], api_key: str) -> dict:
    """Sum scaled nutrition across all ingredient strings."""
    totals = {"calories": 0.0, "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 0.0, "fiber_g": 0.0}
    for ingredient in ingredients:
        nutrition = lookup_ingredient_nutrition(ingredient, api_key)
        if nutrition:
            for key in totals:
                totals[key] += nutrition.get(key, 0.0)
    return totals
