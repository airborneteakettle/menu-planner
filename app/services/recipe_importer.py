import logging
import re
import requests
from fractions import Fraction
from recipe_scrapers import scrape_html
from app.services.usda import estimate_recipe_nutrition, parse_ingredient

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def _fetch_html(url: str, browserless_key: str | None = None, scrapingbee_key: str | None = None) -> str:
    """Fetch page HTML directly, falling back to Browserless then ScrapingBee on 403."""
    log.info("IMPORT direct fetch: %s", url)
    resp = requests.get(url, headers=_HEADERS, timeout=15, allow_redirects=True)
    log.info("IMPORT direct fetch status: %s", resp.status_code)

    if resp.status_code != 403:
        resp.raise_for_status()
        log.info("IMPORT using direct fetch result")
        return resp.text

    log.warning("IMPORT direct fetch blocked (403) for %s", url)

    # First fallback: Browserless.io (JS rendering)
    if browserless_key:
        log.info("IMPORT trying Browserless.io for %s", url)
        bl_resp = requests.post(
            f"https://production-sfo.browserless.io/content?token={browserless_key}",
            json={"url": url},
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        log.info("IMPORT Browserless.io status: %s", bl_resp.status_code)
        if bl_resp.ok:
            log.info("IMPORT using Browserless.io result (%d bytes)", len(bl_resp.text))
            return bl_resp.text
        log.warning("IMPORT Browserless.io failed: %s — %s", bl_resp.status_code, bl_resp.text[:200])
    else:
        log.warning("IMPORT no Browserless API key configured — skipping")

    # Second fallback: ScrapingBee
    if scrapingbee_key:
        log.info("IMPORT trying ScrapingBee for %s", url)
        sb_resp = requests.get(
            "https://app.scrapingbee.com/api/v1/",
            params={
                "api_key":       scrapingbee_key,
                "url":           url,
                "render_js":     "true",
                "wait":          "2000",
                "premium_proxy": "true",
            },
            timeout=60,
        )
        log.info("IMPORT ScrapingBee status: %s", sb_resp.status_code)
        if sb_resp.ok:
            log.info("IMPORT using ScrapingBee result (%d bytes)", len(sb_resp.text))
            return sb_resp.text
        log.warning("IMPORT ScrapingBee failed: %s — %s", sb_resp.status_code, sb_resp.text[:200])
    else:
        log.warning("IMPORT no ScrapingBee API key configured — skipping")

    raise ValueError(
        "This site is protected by Cloudflare and could not be imported. "
        "Try adding the recipe manually instead."
    )


_UGLY_FLOAT_RE = re.compile(r'\d*\.\d{4,}')  # 4+ decimal places = scraper artifact


def _float_to_frac(f: float) -> str:
    """Convert a float like 1.3333... to a human-readable string like '1 1/3'."""
    frac = Fraction(f).limit_denominator(8)
    whole     = int(frac)
    remainder = frac - whole
    if remainder == 0:
        return str(whole)
    frac_str = f'{remainder.numerator}/{remainder.denominator}'
    return f'{whole} {frac_str}' if whole else frac_str


def _prettify_quantity(qty: str | None) -> str | None:
    """Replace ugly floats in a quantity string with cooking-friendly fractions."""
    if not qty:
        return qty
    return _UGLY_FLOAT_RE.sub(lambda m: _float_to_frac(float(m.group())), qty)


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


def import_recipe_from_url(url: str, usda_api_key: str, browserless_key: str | None = None, scrapingbee_key: str | None = None) -> dict:
    """
    Scrape a recipe URL and return a structured dict ready to insert into the DB.
    Falls back to Browserless then ScrapingBee on 403, then USDA for missing nutrition.
    """
    html = _fetch_html(url, browserless_key, scrapingbee_key)
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
        srv = servings or 1
        calories  = calories  or (usda.get("calories")  or 0) / srv or None
        protein_g = protein_g or (usda.get("protein_g") or 0) / srv or None
        fat_g     = fat_g     or (usda.get("fat_g")     or 0) / srv or None
        carbs_g   = carbs_g   or (usda.get("carbs_g")   or 0) / srv or None
        fiber_g   = fiber_g   or (usda.get("fiber_g")   or 0) / srv or None

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
        parsed_ingredients.append({"name": food_name, "quantity": _prettify_quantity(quantity)})

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
