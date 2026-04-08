"""
Automatically apply hidden system tags (protein type, vegan, vegetarian)
to a recipe based on its name and ingredient list.
"""
import re


def _has(texts, *keywords):
    """Return True if any keyword appears as a whole word in any of the texts."""
    for text in texts:
        for kw in keywords:
            if re.search(r'\b' + re.escape(kw) + r'\b', text, re.IGNORECASE):
                return True
    return False


# Protein tag → keywords that identify it
_PROTEINS = {
    'chicken':  ('chicken',),
    'beef':     ('beef', 'steak', 'brisket', 'ribeye', 'sirloin'),
    'pork':     ('pork', 'bacon', 'ham', 'prosciutto', 'pancetta',
                 'salami', 'pepperoni', 'sausage', 'chorizo'),
    'turkey':   ('turkey',),
    'lamb':     ('lamb',),
    # Individual fish species — each gets its own tag + the umbrella "fish" tag
    'salmon':   ('salmon',),
    'tuna':     ('tuna',),
    'cod':      ('cod',),
    'tilapia':  ('tilapia',),
    'halibut':  ('halibut',),
    'bass':     ('bass',),
    'trout':    ('trout',),
    'mahi':     ('mahi', 'mahi-mahi'),
    'catfish':  ('catfish',),
    'flounder': ('flounder',),
    'snapper':  ('snapper',),
    'grouper':  ('grouper',),
    'sardine':  ('sardine', 'sardines'),
    'herring':  ('herring',),
    'anchovy':  ('anchovy', 'anchovies'),
    'shrimp':   ('shrimp', 'prawn'),
    'crab':     ('crab',),
    'lobster':  ('lobster',),
    'shellfish': ('scallop', 'clam', 'mussel', 'oyster'),
    'tofu':     ('tofu', 'tempeh', 'seitan'),
    'egg':      ('egg',),
    'beans':    ('bean', 'lentil', 'chickpea', 'edamame', 'legume'),
}

# Fish species tags — any detection also adds the umbrella "fish" tag
_FISH_SPECIES = {
    'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'bass', 'trout',
    'mahi', 'catfish', 'flounder', 'snapper', 'grouper', 'sardine',
    'herring', 'anchovy',
}

# Protein tags that disqualify vegetarian (major meat/fish only)
_MEAT_FISH = {
    'chicken', 'beef', 'pork', 'turkey', 'lamb',
    'fish', 'shrimp', 'crab', 'lobster', 'shellfish',
} | _FISH_SPECIES

# Additional keywords that disqualify vegetarian but aren't covered by _PROTEINS
_EXTRA_MEAT_FISH = (
    'duck', 'goose', 'veal', 'venison', 'bison', 'rabbit',
    'fish sauce',
)

# Ingredients that disqualify vegan (animal by-products, dairy, eggs, honey)
# Lard, gelatin etc. are here — they block vegan but not vegetarian
_NON_VEGAN_EXTRAS = (
    'lard', 'gelatin', 'anchovies', 'anchovy',
    'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt',
    'whey', 'ghee', 'kefir', 'mayo', 'mayonnaise', 'honey',
)


def apply_auto_tags(recipe):
    """
    Detect protein, vegan, and vegetarian tags and apply them as hidden tags.
    Call this after recipe.ingredients are populated and the session is active
    (but before commit).
    """
    from app import db
    from app.models.recipe import Tag

    # Search recipe name + all ingredient names
    texts = [recipe.name] + [i.name for i in recipe.ingredients]

    current_names = {t.name for t in recipe.tags}

    def _ensure(name):
        if name in current_names:
            return
        tag = Tag.query.filter_by(name=name).first()
        if not tag:
            tag = Tag(name=name, hidden=True)
            db.session.add(tag)
        elif not tag.hidden:
            # A visible user tag with this name already exists — don't shadow it
            return
        recipe.tags.append(tag)
        current_names.add(name)

    # ── Protein tags ──────────────────────────────────────────────────────────
    detected = set()
    for protein, keywords in _PROTEINS.items():
        if _has(texts, *keywords):
            _ensure(protein)
            detected.add(protein)

    # Any specific fish species also gets the umbrella "fish" tag
    if detected & _FISH_SPECIES:
        _ensure('fish')
        detected.add('fish')

    # ── Vegetarian / vegan ────────────────────────────────────────────────────
    # Vegetarian: no major meat/fish protein
    is_meat_fish = bool(detected & _MEAT_FISH) or _has(texts, *_EXTRA_MEAT_FISH)

    if not is_meat_fish:
        _ensure('vegetarian')
        # Vegan: also no animal by-products, dairy, eggs, or honey
        has_non_vegan = (
            'egg' in detected
            or _has(texts, *_NON_VEGAN_EXTRAS)
        )
        if not has_non_vegan:
            _ensure('vegan')
