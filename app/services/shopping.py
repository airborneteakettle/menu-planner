from collections import defaultdict

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

    Returns:
        {
            "Produce": [{"name": "...", "recipes": ["..."]}],
            "Protein": [...],
            ...
        }
    """
    # ingredient_name → {categories, recipes it appears in}
    seen: dict[str, dict] = {}

    for entry in menu_entries:
        recipe = entry.recipe
        if not recipe:
            continue
        for ing in recipe.ingredients:
            key = ing.name.lower().strip()
            if key not in seen:
                seen[key] = {
                    "name": ing.name,
                    "category": _categorize(ing.name),
                    "recipes": [],
                }
            if recipe.name not in seen[key]["recipes"]:
                seen[key]["recipes"].append(recipe.name)

    grouped: dict[str, list] = defaultdict(list)
    category_order = ["Produce", "Protein", "Dairy", "Grains & Pantry", "Frozen", "Other"]

    for item in seen.values():
        grouped[item["category"]].append({
            "name": item["name"],
            "recipes": item["recipes"],
        })

    # Sort items within each category alphabetically
    for items in grouped.values():
        items.sort(key=lambda x: x["name"].lower())

    return {cat: grouped[cat] for cat in category_order if cat in grouped}
