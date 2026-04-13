import json
import logging
import re
import sqlite3
import threading
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

# ── Persistent cache (SQLite) + in-memory L1 ─────────────────────────────────

_DB_PATH: str | None = None          # set by init_cache() at app startup
_CACHE_TTL = timedelta(days=30)

_search_cache: dict[str, list] = {}  # L1: food_name → foods list
_portion_cache: dict[int, list] = {} # L1: fdcId     → foodPortions list
_cache_lock = threading.Lock()


def init_cache(db_uri: str) -> None:
    """
    Called once at app startup.  Strips the sqlite:/// prefix, stores the
    path, and creates the usda_cache table if it doesn't already exist.
    """
    global _DB_PATH
    if db_uri.startswith("sqlite:///"):
        db_uri = db_uri[len("sqlite:///"):]
    _DB_PATH = db_uri
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS usda_cache (
                    key       TEXT PRIMARY KEY,
                    data      TEXT NOT NULL,
                    cached_at TEXT NOT NULL
                )
            """)
            conn.commit()
        log.info("USDA_CACHE_INIT: db=%s ttl=%s", _DB_PATH, _CACHE_TTL)
    except Exception as e:
        log.warning("USDA_CACHE_INIT_ERROR: %s", e)


def _db_get(key: str) -> list | None:
    """Read from SQLite cache; returns None if missing or expired."""
    if not _DB_PATH:
        return None
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            row = conn.execute(
                "SELECT data, cached_at FROM usda_cache WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return None
        cached_at = datetime.fromisoformat(row[1])
        if datetime.now(timezone.utc) - cached_at > _CACHE_TTL:
            return None  # expired — will be refreshed and overwritten
        return json.loads(row[0])
    except Exception as e:
        log.warning("USDA_CACHE_READ_ERROR: key=%r error=%s", key, e)
        return None


def _db_set(key: str, data: list) -> None:
    """Write to SQLite cache."""
    if not _DB_PATH:
        return
    try:
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO usda_cache (key, data, cached_at) VALUES (?, ?, ?)",
                (key, json.dumps(data), now),
            )
            conn.commit()
    except Exception as e:
        log.warning("USDA_CACHE_WRITE_ERROR: key=%r error=%s", key, e)

USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

NUTRIENT_IDS = {
    "calories":  1008,  # Energy (kcal)
    "protein_g": 1003,  # Protein
    "fat_g":     1004,  # Total lipid (fat)
    "carbs_g":   1005,  # Carbohydrate, by difference
    "fiber_g":   1079,  # Fiber, total dietary
}

# USDA nutrientNumber strings (used by Foundation foods in search snippets)
# instead of the integer nutrientId used by SR Legacy.
NUTRIENT_NUMBERS = {
    "calories":  "208",
    "protein_g": "203",
    "fat_g":     "204",
    "carbs_g":   "205",
    "fiber_g":   "291",
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
    r"frozen|canned|dried|ground|whole|baked|roasted|boiled|steamed|grilled|"
    r"sauteed|saut\xe9ed|fried|broiled|blanched|braised|poached|smoked|"
    r"low[- ]fat|fat[- ]free|"
    r"sharp|smooth|plain|greek[- ]?style)\s+",
    re.IGNORECASE,
)

# Strips a leading cooking-method word followed by a comma:
# "Baked, Sweet potato" → "Sweet potato"
_LEADING_PREP_COMMA_RE = re.compile(
    r"^(?:baked|roasted|boiled|steamed|grilled|sauteed|saut\xe9ed|fried|broiled|"
    r"blanched|braised|poached|smoked|cooked|raw|sliced|chopped|diced|minced|"
    r"crushed|grated|shredded|dried|ground|whole|frozen|canned|seasoned),\s+",
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
    # Strip leading "PrepMethod, " prefix e.g. "Baked, Sweet potato" → "Sweet potato"
    food_name = _LEADING_PREP_COMMA_RE.sub("", food_name)
    # Strip leading preparation/size adjectives (up to 3 passes for stacked adjectives)
    for _ in range(3):
        cleaned = _LEADING_ADJ_RE.sub("", food_name)
        if cleaned == food_name:
            break
        food_name = cleaned
    food_name = re.sub(r"\s{2,}", " ", food_name).strip(" \t.,;:-")
    return quantity, food_name or ingredient_str


def _parse_nutrients(food_nutrients: list) -> dict:
    id_map  = {v: k for k, v in NUTRIENT_IDS.items()}
    num_map = {v: k for k, v in NUTRIENT_NUMBERS.items()}
    result  = {k: 0.0 for k in NUTRIENT_IDS}
    for n in food_nutrients:
        # SR Legacy / branded: integer nutrientId at top level or nested under "nutrient"
        nid = n.get("nutrientId") or (n.get("nutrient") or {}).get("id")
        if nid in id_map:
            result[id_map[nid]] = float(n.get("value") or 0)
            continue
        # Foundation foods in search snippets: string nutrientNumber field
        num = str(n.get("nutrientNumber") or (n.get("nutrient") or {}).get("number") or "")
        if num in num_map:
            result[num_map[num]] = float(n.get("value") or 0)
    # Fallback: if calories are missing but macros are present, derive from Atwater factors
    if result["calories"] == 0 and any(result[k] > 0 for k in ("protein_g", "carbs_g", "fat_g")):
        result["calories"] = (
            result["protein_g"] * 4 +
            result["carbs_g"]   * 4 +
            result["fat_g"]     * 9
        )
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


def _fetch_portion_grams(fdc_id: int, amount: float, unit: str, api_key: str, food_name: str = '') -> float | None:
    """
    Fetch USDA food portions and return gram weight for the given volume measure.
    Matches on measureUnit.name/abbr OR on the modifier field when the unit is
    listed as 'undetermined' (common in SR Legacy / Foundation data).
    When multiple cup portions exist (whole, sliced, slivered…) prefers the one
    whose modifier best matches the ingredient description.
    """
    target = _UNIT_TO_USDA.get(unit)
    if not target:
        log.debug("USDA_PORTION_SKIP: unit=%r not in _UNIT_TO_USDA — no portion lookup", unit)
        return None
    log.info("USDA_PORTION_FETCH: fdcId=%d amount=%s unit=%r target=%r food_name=%r",
             fdc_id, amount, unit, target, food_name)
    try:
        # L1 check
        with _cache_lock:
            portions = _portion_cache.get(fdc_id)

        # L2 check (SQLite)
        if portions is None:
            portions = _db_get(f"portion:{fdc_id}")
            if portions is not None:
                log.info("USDA_DB_CACHE_HIT: portions fdcId=%d count=%d", fdc_id, len(portions))
                with _cache_lock:
                    _portion_cache[fdc_id] = portions

        if portions is None:
            resp = requests.get(
                f"{USDA_BASE}/food/{fdc_id}",
                params={"api_key": api_key},
                timeout=8,
            )
            log.info("USDA_PORTION_STATUS: fdcId=%d status=%s", fdc_id, resp.status_code)
            if not resp.ok:
                log.warning("USDA_PORTION_ERROR: fdcId=%d status=%s", fdc_id, resp.status_code)
                with _cache_lock:
                    _portion_cache[fdc_id] = []
                _db_set(f"portion:{fdc_id}", [])  # cache the miss so we don't retry
                return None
            portions = resp.json().get("foodPortions", [])
            _db_set(f"portion:{fdc_id}", portions)
            with _cache_lock:
                _portion_cache[fdc_id] = portions
        else:
            log.info("USDA_PORTION_CACHE_HIT: fdcId=%d portions=%d", fdc_id, len(portions))
        log.info("USDA_PORTION_COUNT: fdcId=%d portions=%d available=%s",
                 fdc_id, len(portions),
                 [(p.get("amount"),
                   (p.get("measureUnit") or {}).get("name"),
                   p.get("modifier"),
                   p.get("gramWeight"))
                  for p in portions])

        candidates = []
        for p in portions:
            mu       = p.get("measureUnit") or {}
            name     = (mu.get("name")         or "").lower().strip()
            abbr     = (mu.get("abbreviation") or "").lower().strip()
            modifier = (p.get("modifier")      or "").lower().strip()
            gram_weight = float(p.get("gramWeight") or 0)
            p_amount    = float(p.get("amount")     or 1)
            if gram_weight <= 0:
                continue
            # Direct name/abbr match OR modifier starts with the target unit
            # (SR Legacy uses name='undetermined' and stores the unit in modifier)
            if target in (name, abbr) or (name == 'undetermined' and modifier.startswith(target)):
                candidates.append((modifier, gram_weight, p_amount))

        if not candidates:
            log.warning("USDA_PORTION_NO_MATCH: fdcId=%d target=%r not found in portions", fdc_id, target)
            return None

        log.info("USDA_PORTION_CANDIDATES: %s", candidates)

        # If multiple candidates, prefer the one whose modifier contains a word
        # from the ingredient name (e.g. "sliced almonds" → "cup, sliced" = 92g)
        chosen = candidates[0]
        if len(candidates) > 1 and food_name:
            keywords = [w for w in food_name.lower().split() if len(w) > 3]
            for candidate in candidates:
                if any(kw in candidate[0] for kw in keywords):
                    chosen = candidate
                    break

        modifier, gram_weight, p_amount = chosen
        result = gram_weight * amount / p_amount
        log.info("USDA_PORTION_MATCH: chosen modifier=%r gramWeight=%s p_amount=%s → %.1fg",
                 modifier, gram_weight, p_amount, result)
        return result
    except Exception as e:
        log.exception("USDA_PORTION_EXCEPTION: fdcId=%d error=%s", fdc_id, e)
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
    log.info("USDA_LOOKUP: ingredient=%r", ingredient)

    # Seasonings / garnishes added "to taste" or with no measured quantity
    if re.search(r"\bto\s+taste\b|\bas\s+needed\b", ingredient, re.IGNORECASE):
        log.info("USDA_SKIP_TO_TASTE: %r", ingredient)
        return None

    quantity_str_check, _ = parse_ingredient(ingredient)
    if quantity_str_check is None and re.search(
        r"\b(salt|pepper|seasoning|spice|flakes)\b", ingredient, re.IGNORECASE
    ):
        log.info("USDA_SKIP_SEASONING: %r (no quantity)", ingredient)
        return None

    quantity_str, food_name = parse_ingredient(ingredient)
    log.info("USDA_PARSED: quantity=%r food_name=%r", quantity_str, food_name)

    try:
        # Search with cache — same food_name won't hit USDA twice in a session.
        # L1 check
        with _cache_lock:
            cached = _search_cache.get(food_name)

        # L2 check (SQLite)
        if cached is None:
            cached = _db_get(f"search:{food_name}")
            if cached is not None:
                log.info("USDA_DB_CACHE_HIT: search food_name=%r results=%d", food_name, len(cached))
                with _cache_lock:
                    _search_cache[food_name] = cached

        if cached is not None:
            foods = cached
            log.info("USDA_CACHE_HIT: food_name=%r results=%d", food_name, len(foods))
        else:
            def _search(data_type: str) -> list:
                r = requests.get(
                    f"{USDA_BASE}/foods/search",
                    params=[
                        ("query",    food_name),
                        ("pageSize", 10),
                        ("api_key",  api_key),
                        ("dataType", data_type),
                    ],
                    timeout=10,
                )
                r.raise_for_status()
                return r.json().get("foods", [])

            # Foundation first (sequential within this thread — the outer
            # ThreadPoolExecutor already parallelises across ingredients, so
            # a nested pool here just creates too many simultaneous connections).
            foundation_foods = _search("Foundation")
            remaining        = max(0, 10 - len(foundation_foods))
            sr_foods         = _search("SR Legacy") if remaining > 0 else []
            foods            = foundation_foods + sr_foods[:remaining]

            # Branded fallback: only query when Foundation + SR Legacy are empty.
            # Branded foods are last-resort because they have inconsistent naming.
            if not foods:
                branded = _search("Branded")
                foods   = branded
                log.info("USDA_BRANDED_FALLBACK: food_name=%r branded_count=%d", food_name, len(branded))

            _db_set(f"search:{food_name}", foods)
            with _cache_lock:
                _search_cache[food_name] = foods
        log.info("USDA_SEARCH_RESULTS: food_name=%r count=%d ids=%s",
                 food_name, len(foods),
                 [(f.get("fdcId"), f.get("dataType"), f.get("description")) for f in foods])
        if not foods:
            log.warning("USDA_NO_RESULTS: food_name=%r", food_name)
            return None
        # Rank: Foundation first, SR Legacy second, Branded last; within each
        # prefer results whose description closely matches the query.
        _DT_RANK = {'Foundation': 0, 'SR Legacy': 1, 'Branded': 2}

        def _has_calories(f):
            return any(
                float(n.get("value") or 0) > 0 and (
                    n.get("nutrientId") == 1008 or
                    (n.get("nutrient") or {}).get("id") == 1008 or
                    str(n.get("nutrientNumber") or
                        (n.get("nutrient") or {}).get("number") or "") == "208"
                )
                for n in f.get("foodNutrients", [])
            )

        def _desc_match(desc: str, name: str) -> int:
            """Lower score = better match."""
            d = desc.lower()
            n = name.lower().strip()
            first_seg = d.split(',')[0].strip()
            if first_seg == n:
                return 0  # "Milk, whole…" for query "milk"
            if d.startswith(n + ',') or d.startswith(n + ' '):
                return 1  # description starts with exact name
            if re.search(r'\b' + re.escape(n) + r'\b', d[:40]):
                return 2  # name appears as a word near the start
            return 3

        # Rank by: data type quality first, then description match.
        # _has_calories is intentionally excluded — Foundation search snippets
        # omit calorie data for many foods, causing spurious tiebreaker losses.
        food = min(foods, key=lambda f: (
            _DT_RANK.get(f.get("dataType", ""), 99),
            _desc_match(f.get("description", ""), food_name),
        ))
        per_100g = _parse_nutrients(food.get("foodNutrients", []))
        log.info("USDA_FOOD_MATCH: fdcId=%s dataType=%s description=%r per100g_cal=%.1f",
                 food.get("fdcId"), food.get("dataType"),
                 food.get("description"), per_100g.get("calories", 0))
        log.debug("USDA_RAW_NUTRIENTS: fdcId=%s nutrients=%s",
                  food.get("fdcId"), food.get("foodNutrients", []))
    except requests.RequestException as e:
        log.error("USDA_REQUEST_ERROR: food_name=%r error=%s", food_name, e)
        return None

    grams = quantity_to_grams(quantity_str)
    log.info("USDA_QTY_TO_GRAMS: quantity_str=%r → grams=%s (water-density)", quantity_str, grams)

    # For non-liquid volume units (cup, tbsp, tsp), water density is wrong for
    # dry ingredients. Use the USDA food's own portion data when available.
    # Try each search-result food in order until one returns valid portion data
    # (some fdcIds — e.g. Survey/FNDDS foods — return 404 from the detail endpoint).
    if grams is not None and quantity_str:
        parts = _parse_qty_parts(quantity_str)
        if parts:
            qty_amount, qty_unit = parts
            log.info("USDA_QTY_PARTS: amount=%s unit=%r", qty_amount, qty_unit)
            if qty_unit in _UNIT_TO_USDA and qty_unit not in _LIQUID_UNITS:
                portion_g = None
                for candidate_food in foods[:3]:
                    portion_g = _fetch_portion_grams(
                        candidate_food["fdcId"], qty_amount, qty_unit, api_key, food_name)
                    if portion_g is not None:
                        if candidate_food["fdcId"] != food["fdcId"]:
                            log.info("USDA_PORTION_ALT_FOOD: used fdcId=%s %r instead of primary",
                                     candidate_food["fdcId"], candidate_food.get("description"))
                            # Recompute per_100g from the food that had portion data
                            per_100g = _parse_nutrients(candidate_food.get("foodNutrients", []))
                        break
                if portion_g is not None:
                    log.info("USDA_PORTION_OVERRIDE: %.1fg (was %.1fg water-density)", portion_g, grams)
                    grams = portion_g
                else:
                    log.warning("USDA_PORTION_FALLBACK: no portion data found in any of %d results, using water-density %.1fg",
                                len(foods), grams)
            else:
                log.info("USDA_QTY_UNIT_SKIP: unit=%r — not a volume unit or is liquid, keeping %.1fg", qty_unit, grams)

    # ── Branded RACC override ────────────────────────────────────────────
    # For Branded foods, scale by servingSize (RACC) rather than 100 g/item.
    # Applies when:
    #   • quantity is a bare count ("2") — overrides the 100g-per-item default
    #   • quantity unit is unrecognised (e.g. "2 pieces") — grams is None
    #   • no quantity at all — default to 1 × RACC instead of returning per-100g
    if food.get("dataType") == "Branded":
        racc_g = _usda_serving_grams(food)
        if racc_g:
            if quantity_str:
                parts = _parse_qty_parts(quantity_str)
                if parts:
                    qty_amount, qty_unit = parts
                    # bare count (qty_unit == '') OR unrecognised count unit
                    if qty_unit == '' or (qty_unit and qty_unit not in _UNIT_GRAMS
                                          and qty_unit not in _UNIT_TO_USDA):
                        new_grams = qty_amount * racc_g
                        log.info("USDA_BRANDED_RACC: qty=%s × racc=%.1fg → %.1fg",
                                 qty_amount, racc_g, new_grams)
                        grams = new_grams
            elif grams is None:
                # no quantity at all → default to 1 RACC
                grams = racc_g
                log.info("USDA_BRANDED_RACC_DEFAULT: no qty → 1 × racc=%.1fg", racc_g)

    # Bare-count fallback for non-branded foods: "1 apple", "2 shallots" — use the
    # food's own serving size rather than the 100 g default.
    if grams is None and quantity_str:
        bare = re.match(r"^([\d\s./½¼¾⅓⅔⅛]+)$", quantity_str.strip())
        if bare:
            serving_g = _usda_serving_grams(food)
            if serving_g:
                grams = _parse_amount(bare.group(1)) * serving_g
                log.info("USDA_SERVING_SIZE: bare count × usda_serving=%.1fg → %.1fg", serving_g, grams)

    if grams is not None:
        scale = grams / 100.0
        result = {k: v * scale for k, v in per_100g.items()}
        log.info("USDA_RESULT: grams=%.1f scale=%.3f cal=%.1f protein=%.1f carbs=%.1f fat=%.1f",
                 grams, scale, result["calories"], result["protein_g"], result["carbs_g"], result["fat_g"])
        return result

    log.info("USDA_RESULT_PER100G: no quantity, returning per-100g cal=%.1f", per_100g.get("calories", 0))
    return per_100g


def search_ingredient_candidates(
    ingredient: str,
    api_key: str,
    offset: int = 0,
    limit: int = 10,
) -> dict:
    """
    Return USDA food candidates for an ingredient with pre-scaled nutrition.
    Used by the override picker in the UI.

    - offset=0  → uses existing search cache if available (Foundation-priority order)
    - offset>0  → fetches page 2+ from USDA in parallel (Foundation + SR Legacy + Branded)

    Result order: Foundation → SR Legacy → Branded (least preferred last).
    """
    quantity_str, food_name = parse_ingredient(ingredient)
    grams = quantity_to_grams(quantity_str)

    # Separate "all-results" cache so the nutrition-estimation cache is unaffected
    all_cache_key = f"search_all:{food_name}"

    with _cache_lock:
        all_foods = _search_cache.get(all_cache_key)
    if all_foods is None:
        all_foods = _db_get(all_cache_key)
        if all_foods is not None:
            with _cache_lock:
                _search_cache[all_cache_key] = all_foods

    if all_foods is None or offset + limit > len(all_foods):
        # Need to fetch from USDA.  pageNumber starts at 1; page 2 = items 10-19, etc.
        page_num = max(1, offset // 10 + 1)

        def _search(data_type: str) -> list:
            try:
                r = requests.get(
                    f"{USDA_BASE}/foods/search",
                    params=[
                        ("query",      food_name),
                        ("pageSize",   10),
                        ("pageNumber", page_num),
                        ("api_key",    api_key),
                        ("dataType",   data_type),
                    ],
                    timeout=10,
                )
                r.raise_for_status()
                return r.json().get("foods", [])
            except Exception as e:
                log.warning("USDA_SEARCH_CANDIDATE_ERROR: data_type=%s error=%s", data_type, e)
                return []

        with ThreadPoolExecutor(max_workers=3) as pool:
            f_fut  = pool.submit(_search, "Foundation")
            sr_fut = pool.submit(_search, "SR Legacy")
            br_fut = pool.submit(_search, "Branded")
            f_foods  = f_fut.result()
            sr_foods = sr_fut.result()
            br_foods = br_fut.result()

        seen_ids = {f.get("fdcId") for f in f_foods}
        unique_sr = [f for f in sr_foods if f.get("fdcId") not in seen_ids]
        seen_ids.update(f.get("fdcId") for f in unique_sr)
        unique_br = [f for f in br_foods if f.get("fdcId") not in seen_ids]
        # Foundation first → SR Legacy → Branded (least preferred)
        fresh = f_foods + unique_sr + unique_br

        if offset == 0:
            all_foods = fresh
        else:
            all_foods = (all_foods or []) + fresh

        _db_set(all_cache_key, all_foods)
        with _cache_lock:
            _search_cache[all_cache_key] = all_foods

    page_foods = all_foods[offset:offset + limit]

    candidates = []
    for food in page_foods:
        per_100g = _parse_nutrients(food.get("foodNutrients", []))
        food_grams = grams  # ingredient-level grams (may be overridden per food)
        racc_g = None

        # For Branded foods, prefer RACC (servingSize) over 100g-per-item default
        if food.get("dataType") == "Branded":
            racc_g = _usda_serving_grams(food)
            if racc_g:
                if food_grams is None:
                    # No recognised quantity → show nutrition per 1 RACC
                    food_grams = racc_g
                elif quantity_str:
                    parts = _parse_qty_parts(quantity_str)
                    if parts:
                        qty_amount, qty_unit = parts
                        # bare count or unrecognised count unit
                        if qty_unit == '' or (qty_unit and qty_unit not in _UNIT_GRAMS
                                              and qty_unit not in _UNIT_TO_USDA):
                            food_grams = qty_amount * racc_g

        if food_grams is not None:
            scale = food_grams / 100.0
            nutrition = {k: round(v * scale, 1) for k, v in per_100g.items()}
        else:
            nutrition = {k: round(v, 1) for k, v in per_100g.items()}

        candidates.append({
            "fdcId":        food.get("fdcId"),
            "description":  food.get("description", ""),
            "dataType":     food.get("dataType", ""),
            "serving_size_g": round(racc_g, 1) if racc_g else None,
            "calories":     nutrition.get("calories"),
            "protein_g":    nutrition.get("protein_g"),
            "carbs_g":      nutrition.get("carbs_g"),
            "fat_g":        nutrition.get("fat_g"),
            "fiber_g":      nutrition.get("fiber_g"),
        })

    return {
        "food_name":    food_name,
        "quantity_str": quantity_str,
        "grams":        round(grams, 1) if grams else None,
        "offset":       offset,
        "total":        len(all_foods),
        "has_more":     len(all_foods) > offset + limit,
        "candidates":   candidates,
    }


def estimate_recipe_nutrition(ingredients: list[str], api_key: str) -> dict:
    """
    Sum scaled nutrition across all ingredient strings.
    Lookups run in parallel (up to 8 concurrent USDA requests) so a
    12-ingredient recipe takes ~2s instead of ~20s.
    """
    totals = {"calories": 0.0, "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 0.0, "fiber_g": 0.0}
    if not ingredients:
        return totals

    max_workers = min(8, len(ingredients))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(lookup_ingredient_nutrition, ing, api_key): ing
                   for ing in ingredients}
        for future in as_completed(futures):
            try:
                nutrition = future.result()
                if nutrition:
                    for key in totals:
                        totals[key] += nutrition.get(key, 0.0)
            except Exception as e:
                log.warning("USDA_ESTIMATE_ERROR: ingredient=%r error=%s", futures[future], e)

    return totals
