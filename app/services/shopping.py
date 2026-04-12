import math
from collections import defaultdict
import re


# ── Quantity parsing & aggregation ───────────────────────────────────────────

_FRAC_CHARS = {'½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8'}

# Size descriptors that are not real units and should be ignored
_SIZE_WORDS = {'small', 'medium', 'large', 'extra-large', 'extra large', 'mini', 'big'}

# Normalize plural / abbreviated units to a canonical singular form
_UNIT_NORM = {
    'lbs': 'lb', 'pound': 'lb', 'pounds': 'lb',
    'ounces': 'oz', 'ounce': 'oz',
    'cups': 'cup',
    'tablespoons': 'tablespoon', 'tbsps': 'tablespoon', 'tbsp': 'tablespoon',
    'teaspoons': 'teaspoon', 'tsps': 'teaspoon', 'tsp': 'teaspoon',
    'cloves': 'clove', 'slices': 'slice', 'cans': 'can',
    'sprigs': 'sprig', 'stalks': 'stalk', 'heads': 'head', 'bunches': 'bunch',
    'pinches': 'pinch', 'dashes': 'dash',
}

# Leading size prefix in ingredient names
_SIZE_PREFIX_RE = re.compile(
    r'^(?:small|medium|large|extra[- ]?large|mini|big)\s+', re.IGNORECASE
)

# Citrus usage: "… from/of N lemon/lime/…" anywhere in qty or name
_CITRUS_RE = re.compile(
    r'(?:from|of)\s+(\d+)\s+(lemon|lime|orange|grapefruit)s?\b',
    re.IGNORECASE,
)


def _resolve_citrus(qty: str, name: str) -> tuple[str, str]:
    """
    If the combined qty+name contains a 'from/of N lemon' pattern, collapse the
    whole thing to (count, fruit_name).  This handles both newly-imported and
    previously-imported complex strings like
    '2 tablespoon fresh lemon juice plus 1/4 teaspoon grated zest from 1 lemon'.
    """
    m = _CITRUS_RE.search(name) or _CITRUS_RE.search(qty)
    if m:
        return m.group(1), m.group(2).lower()
    return qty, name


def _clean_name(name: str) -> str:
    """
    Strip noise from an ingredient name so variants collapse to the same thing:
      - Leading size words ("small", "large", …)
      - Leading "fresh" (fresh lemon ≡ lemon for shopping purposes)
      - Trailing "juice", "zest", "peel" (lemon juice ≡ lemon)
    """
    n = _SIZE_PREFIX_RE.sub('', name).strip()
    n = re.sub(r'^fresh\s+', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+(?:juice|zest|peel)$', '', n, flags=re.IGNORECASE)
    return n.strip()


def _normalize_key(name: str) -> str:
    """Canonical key for grouping: clean name, lowercase, singularize."""
    s = _clean_name(name).lower()
    # Simple singularization — skip endings that are typically not plurals
    if s.endswith('s') and not re.search(r'(ss|us|is|as|ous)$', s) and len(s) > 3:
        s = s[:-1]
    return s


def _parse_qty(qty_str: str) -> tuple[float | None, str]:
    """Parse a quantity string → (number, unit).  Returns (None, original) on failure.
    Size descriptors ('small', 'large', etc.) are stripped from the unit."""
    s = qty_str.strip()
    for ch, rep in _FRAC_CHARS.items():
        s = s.replace(ch, rep)

    def _clean_unit(raw: str) -> str:
        raw = raw.strip().rstrip('.,')
        # Remove size words from the unit token
        parts = [w for w in raw.split() if w.lower() not in _SIZE_WORDS]
        unit = ' '.join(parts)
        return _UNIT_NORM.get(unit.lower(), unit.lower())

    # mixed number: "1 1/2 cups"
    m = re.match(r'^(\d+)\s+(\d+)/(\d+)\s*(.*)', s)
    if m:
        number = int(m.group(1)) + int(m.group(2)) / int(m.group(3))
        return number, _clean_unit(m.group(4))

    # plain fraction: "1/2 cup"
    m = re.match(r'^(\d+)/(\d+)\s*(.*)', s)
    if m:
        number = int(m.group(1)) / int(m.group(2))
        return number, _clean_unit(m.group(3))

    # decimal or integer: "2", "1.5", "2 lbs", "2 small"
    m = re.match(r'^(\d+(?:\.\d+)?)\s*(.*)', s)
    if m:
        number = float(m.group(1))
        return number, _clean_unit(m.group(2))

    return None, qty_str


def _fmt_number(n: float) -> str:
    """Format a float cleanly: 1.0 → "1", 1.5 → "1½"."""
    whole = int(n)
    frac  = round(n - whole, 6)
    sym = {0.5: '½', 0.25: '¼', 0.75: '¾',
           round(1/3, 6): '⅓', round(2/3, 6): '⅔', 0.125: '⅛'}.get(frac)
    if sym:
        return f"{whole}{sym}" if whole else sym
    return str(whole) if frac == 0 else f"{n:g}"


def _aggregate_qty(per_recipe: dict) -> str | None:
    """
    Sum quantities across all recipe occurrences.
    If all parseable with the same unit, returns a single total (e.g. "2", "1½ cups").
    If units differ, lists each separately.
    Falls back to listing raw strings for unparseable entries.
    """
    numeric: list[tuple[float, str]] = []
    raw: list[str] = []

    for info in per_recipe.values():
        qty   = info["qty"]
        count = info["count"]
        if not qty:
            continue
        number, unit = _parse_qty(qty)
        if number is not None:
            numeric.append((number * count, unit))
        else:
            raw.append(qty + (f" ×{count}" if count > 1 else ""))

    if not numeric and not raw:
        return None

    if numeric:
        # Sum quantities per unit
        by_unit: dict[str, float] = {}
        for n, u in numeric:
            by_unit[u] = by_unit.get(u, 0.0) + n

        if len(by_unit) == 1:
            unit, total = next(iter(by_unit.items()))
            result = f"{_fmt_number(total)} {unit}".strip() if unit else _fmt_number(total)
        else:
            # Multiple units: put the unitless count first (it's the physical item count)
            parts = []
            if '' in by_unit:
                parts.append(_fmt_number(by_unit['']))
            parts += [f"{_fmt_number(n)} {u}" for u, n in by_unit.items() if u]
            result = ", ".join(parts)
        return (result + (", " + ", ".join(raw)) if raw else result)

    return ", ".join(raw)

# Keyword → category mapping (checked in order; first match wins)
_CATEGORY_KEYWORDS = {
    "Produce": [
        "tomato", "lettuce", "spinach", "kale", "arugula", "onion", "garlic",
        "shallot", "pepper", "bell pepper", "jalapeño", "jalapen", "carrot",
        "celery", "cucumber", "zucchini", "squash", "broccoli", "cauliflower",
        "cabbage", "mushroom", "asparagus", "green bean", "pea", "corn",
        "potato", "sweet potato", "yam", "beet", "radish", "turnip", "leek",
        "scallion", "green onion", "chive", "herb", "basil", "parsley",
        "cilantro", "thyme", "rosemary", "sage", "mint", "dill", "oregano",
        "apple", "banana", "berry", "strawberr", "blueberr", "raspberr",
        "lemon", "lime", "orange", "grapefruit", "mango", "peach", "pear",
        "grape", "avocado", "fig", "date", "watermelon", "cantaloupe",
    ],
    "Protein": [
        "chicken", "turkey", "beef", "steak", "pork", "lamb", "veal",
        "bacon", "sausage", "ham", "prosciutto", "salami", "pepperoni",
        "salmon", "tuna", "tilapia", "cod", "shrimp", "scallop", "lobster",
        "crab", "fish", "seafood", "egg", "tofu", "tempeh", "edamame",
        "lentil", "chickpea", "black bean", "kidney bean", "pinto bean",
        "bean", "legume",
    ],
    "Dairy": [
        "milk", "cream", "half-and-half", "half and half", "butter",
        "ghee", "cheese", "cheddar", "mozzarella", "parmesan", "feta",
        "ricotta", "brie", "gouda", "provolone", "swiss", "gruyere",
        "yogurt", "sour cream", "cream cheese", "cottage cheese",
        "whipping cream", "heavy cream",
    ],
    "Frozen": [
        "frozen", "ice cream",
    ],
    "Grains & Pantry": [
        "flour", "bread", "roll", "baguette", "tortilla", "pita", "naan",
        "rice", "pasta", "noodle", "spaghetti", "linguine", "fettuccine",
        "penne", "orzo", "couscous", "quinoa", "oat", "oatmeal", "granola",
        "cereal", "cracker", "chip", "oil", "olive oil", "vegetable oil",
        "coconut oil", "sesame oil", "vinegar", "balsamic", "soy sauce",
        "worcestershire", "hot sauce", "ketchup", "mustard", "mayonnaise",
        "mayo", "ranch", "dressing", "broth", "stock", "bouillon",
        "tomato sauce", "tomato paste", "canned", "can of", "sugar",
        "brown sugar", "honey", "maple syrup", "salt", "pepper", "spice",
        "cumin", "paprika", "turmeric", "cinnamon", "nutmeg", "cayenne",
        "chili powder", "garlic powder", "onion powder", "baking soda",
        "baking powder", "yeast", "cocoa", "chocolate", "vanilla",
        "almond", "walnut", "pecan", "cashew", "peanut", "pine nut",
        "seed", "chia", "flax", "sesame",
    ],
}


def _categorize(ingredient_name: str) -> str:
    lower = ingredient_name.lower()
    for category, keywords in _CATEGORY_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return category
    return "Other"


def generate_shopping_list(menu_entries) -> dict:
    """
    Given a list of MenuEntry ORM objects, aggregate all ingredients
    and return them grouped by category.

    Ingredient quantities are scaled by the number of *batches* needed for
    each recipe — not the raw number of menu entries.  One batch covers up to
    recipe.servings planned servings.  If the household plans more servings
    than a single batch yields, a second batch (and its ingredients) is added.

    Example: recipe yields 4 servings, needs 1 lb chicken.
      • 4 entries × 1 serving each  → 4 total servings → 1 batch → 1 lb chicken
      • 5 entries × 1 serving each  → 5 total servings → 2 batches → 2 lb chicken

    Returns:
        {
            "Produce": [{"name": "...", "quantity": "...", "recipes": ["..."]}],
            ...
        }
    """
    # ── Step 1: compute batches needed per recipe ─────────────────────────────
    # Group entries by recipe_id and sum planned servings.
    entries_by_recipe: dict[int, list] = defaultdict(list)
    for entry in menu_entries:
        if entry.recipe_id:
            entries_by_recipe[entry.recipe_id].append(entry)

    batches_for: dict[int, int] = {}
    for recipe_id, entries in entries_by_recipe.items():
        recipe = entries[0].recipe
        total_planned  = sum(e.servings or 1 for e in entries)
        recipe_yield   = max(recipe.servings or 1, 1)
        batches_for[recipe_id] = math.ceil(total_planned / recipe_yield)

    # ── Step 2: build ingredient list scaled by batch count ───────────────────
    # ingredient_key → {name, category, per_recipe: {recipe_name: {qty, count}}}
    seen: dict[str, dict] = {}

    for recipe_id, entries in entries_by_recipe.items():
        recipe  = entries[0].recipe
        batches = batches_for[recipe_id]

        for ing in recipe.ingredients:
            if ing.is_header:
                continue
            qty  = (ing.quantity or "").strip()
            name = ing.name.strip()

            # Repair: old regex incorrectly consumed a single 'g' or 'l' from the
            # start of an ingredient name (e.g. qty="3 g", name="reen onions").
            # Only fix when the number is small (≤20) to avoid touching "500 g beef".
            _broken = re.match(r'^(\d+)\s+([gl])$', qty, re.IGNORECASE)
            if _broken and int(_broken.group(1)) <= 20:
                qty  = _broken.group(1)
                name = _broken.group(2) + name

            # Collapse citrus compound strings → (count, fruit)
            qty, name = _resolve_citrus(qty, name)

            display_name = _clean_name(name)
            key = _normalize_key(name)

            if key not in seen:
                seen[key] = {
                    "name":     display_name,
                    "category": _categorize(name),
                    "per_recipe": {},
                }
            else:
                # Prefer the shorter / size-prefix-free name for display
                if len(display_name) < len(seen[key]["name"]):
                    seen[key]["name"] = display_name

            pr = seen[key]["per_recipe"]
            # Set once per recipe using the pre-computed batch count
            if recipe.name not in pr:
                pr[recipe.name] = {"qty": qty, "count": batches}

    grouped: dict[str, list] = defaultdict(list)
    category_order = ["Produce", "Protein", "Dairy", "Grains & Pantry", "Frozen", "Other"]

    for item in seen.values():
        grouped[item["category"]].append({
            "name":     item["name"],
            "quantity": _aggregate_qty(item["per_recipe"]),
            "recipes":  list(item["per_recipe"].keys()),
        })

    for items in grouped.values():
        items.sort(key=lambda x: x["name"].lower())

    return {cat: grouped.get(cat, []) for cat in category_order}
