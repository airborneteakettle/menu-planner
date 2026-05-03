"""
Unit tests for the shopping list aggregation service.

These tests use plain mock objects so no database or Flask app is needed.
"""
import math
import pytest
from types import SimpleNamespace

from app.services.shopping import generate_shopping_list, _parse_qty, _aggregate_qty, _fmt_number


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_ingredient(name, quantity="", is_header=False):
    return SimpleNamespace(name=name, quantity=quantity, is_header=is_header)


def make_recipe(name, servings, ingredients):
    r = SimpleNamespace(name=name, servings=servings, ingredients=ingredients)
    return r


def make_share():
    return SimpleNamespace()


def make_entry(recipe, servings=1.0, shares=None):
    e = SimpleNamespace(recipe_id=id(recipe), recipe=recipe, servings=servings,
                        shares=shares or [])
    return e


# ── Proportional scaling ──────────────────────────────────────────────────────

class TestBatchScaling:
    def _list(self, recipe, entries):
        """Run generate_shopping_list and flatten to {name: quantity}."""
        result = generate_shopping_list(entries)
        flat = {}
        for items in result.values():
            for item in items:
                flat[item["name"]] = item["quantity"]
        return flat

    def test_partial_serving_scales_down(self):
        """1 serving of a 4-serving recipe → scale ¼ → ½ cup from base 2 cup."""
        r = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        entries = [make_entry(r, servings=1)]
        flat = self._list(r, entries)
        assert flat["pasta"] == "½ cup"

    def test_full_recipe_yield_gives_base_qty(self):
        """4 servings planned for a 4-serving recipe → scale 1 → full base quantity."""
        r = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        entries = [make_entry(r, servings=1) for _ in range(4)]
        flat = self._list(r, entries)
        assert flat["pasta"] == "2 cup"

    def test_servings_exceed_yield_scales_proportionally(self):
        """
        5 servings planned, recipe yields 4 → scale 5/4 → 1¼ lb from base 1 lb.
        Previously this rounded up to 2 whole batches (2 lb); now it's exact.
        """
        r = make_recipe("Chicken Stir Fry", 4, [make_ingredient("chicken", "1 lb")])
        entries = [make_entry(r, servings=1) for _ in range(5)]
        flat = self._list(r, entries)
        assert flat["chicken"] == "1¼ lb"

    def test_double_yield_doubles_qty(self):
        """8 servings on a 4-serving recipe → scale 2 → exact double."""
        r = make_recipe("Soup", 4, [make_ingredient("broth", "4 cup")])
        entries = [make_entry(r, servings=1) for _ in range(8)]
        flat = self._list(r, entries)
        assert flat["broth"] == "8 cup"

    def test_nine_servings_of_four_serving_recipe(self):
        """9 servings, yield 4 → scale 9/4 → 9 cup from base 4 cup (not 12)."""
        r = make_recipe("Soup", 4, [make_ingredient("broth", "4 cup")])
        entries = [make_entry(r, servings=1) for _ in range(9)]
        flat = self._list(r, entries)
        assert flat["broth"] == "9 cup"

    def test_explicit_servings_per_entry(self):
        """3 entries × 2 servings = 6 total; scale 6/4 = 1½ → 3 cup from base 2 cup."""
        r = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        entries = [make_entry(r, servings=2) for _ in range(3)]
        flat = self._list(r, entries)
        assert flat["pasta"] == "3 cup"

    def test_recipe_servings_none_treated_as_one(self):
        """Recipe with no serving count defaults yield to 1; scale = total_planned."""
        r = make_recipe("Custom", None, [make_ingredient("egg", "2")])
        entries = [make_entry(r, servings=1) for _ in range(3)]
        flat = self._list(r, entries)
        assert flat["egg"] == "6"

    def test_two_recipes_scaled_independently(self):
        """Scale factor is per recipe-id; two recipes don't bleed into each other."""
        r1 = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        r2 = make_recipe("Salad", 2, [make_ingredient("lettuce", "1")])
        # r1: 5/4 = 1.25 → 2½ cup;  r2: 2/2 = 1 → 1
        entries = [make_entry(r1, servings=1) for _ in range(5)] + \
                  [make_entry(r2, servings=1) for _ in range(2)]
        flat = self._list(r1, entries)
        assert flat["pasta"] == "2½ cup"
        assert flat["lettuce"] == "1"

    # ── Household-specific scenarios ──────────────────────────────────────────

    def test_household_members_servings_all_summed(self):
        """
        Five household members each plan 1 serving of a 4-serving recipe.
        All entries share the same recipe_id (recipe is global).
        scale = 5/4 → 1¼ lb from base 1 lb.
        Servings from every member must be included, not just the current user's.
        """
        r = make_recipe("Chicken Stir Fry", 4, [make_ingredient("chicken", "1 lb")])
        entries = [make_entry(r, servings=1) for _ in range(5)]
        flat = self._list(r, entries)
        assert flat["chicken"] == "1¼ lb"

    def test_household_members_mixed_servings(self):
        """
        One member eating 2 portions, three eating 1 each → total 5.
        scale 5/4 → 2½ cup from base 2 cup.
        """
        r = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        entries = [make_entry(r, servings=2)] + [make_entry(r, servings=1) for _ in range(3)]
        flat = self._list(r, entries)
        assert flat["pasta"] == "2½ cup"

    def test_two_recipes_same_name_both_contributions_counted(self):
        """
        Regression: two recipe objects with the same name (different ids) both
        contribute their proportional quantities.
        r1: 4/4=1 scale → 2 cup;  r2: 3/2=1.5 scale → 1½ cup;  total 3½ cup.
        """
        r1 = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        r2 = make_recipe("Pasta", 2, [make_ingredient("pasta", "1 cup")])
        entries = [make_entry(r1, servings=1) for _ in range(4)] + \
                  [make_entry(r2, servings=1) for _ in range(3)]
        flat = self._list(r1, entries)
        assert flat["pasta"] == "3½ cup"

    def test_shared_entry_counts_owner_plus_shares(self):
        """
        One entry shared with 4 others → 5 effective servings.
        scale 5/4 → 2½ cup from base 2 cup.
        """
        r = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        shares = [make_share() for _ in range(4)]
        entries = [make_entry(r, servings=1, shares=shares)]
        flat = self._list(r, entries)
        assert flat["pasta"] == "2½ cup"

    def test_shared_entry_below_yield_scales_down(self):
        """Shared with 2 others → 3 effective servings; scale 3/4 → 3 cup from base 4 cup."""
        r = make_recipe("Soup", 4, [make_ingredient("broth", "4 cup")])
        shares = [make_share(), make_share()]
        entries = [make_entry(r, servings=1, shares=shares)]
        flat = self._list(r, entries)
        assert flat["broth"] == "3 cup"

    def test_unshared_single_serving_of_two_serving_recipe(self):
        """1 serving of a 2-serving recipe → scale ½ → ½ of each ingredient."""
        r = make_recipe("Salad", 2, [make_ingredient("lettuce", "1")])
        entries = [make_entry(r, servings=1)]
        flat = self._list(r, entries)
        assert flat["lettuce"] == "½"

    def test_shared_entry_plus_independent_entries(self):
        """
        User A shares with 1 other (2 effective) + User C has own entry (1).
        Total 3 servings; scale 3/4 → 3 tortillas from base 4.
        """
        r = make_recipe("Tacos", 4, [make_ingredient("tortilla", "4")])
        entry_shared = make_entry(r, servings=1, shares=[make_share()])
        entry_own    = make_entry(r, servings=1)
        flat = self._list(r, [entry_shared, entry_own])
        assert flat["tortilla"] == "3"

    def test_two_recipes_same_name_recipes_list_deduped(self):
        """The 'recipes' list in the output de-duplicates the name when two
        recipe objects share the same name."""
        r1 = make_recipe("Pasta", 4, [make_ingredient("pasta", "2 cup")])
        r2 = make_recipe("Pasta", 2, [make_ingredient("pasta", "1 cup")])
        entries = [make_entry(r1), make_entry(r2)]
        result = generate_shopping_list(entries)
        for items in result.values():
            for item in items:
                if item["name"] == "pasta":
                    assert item["recipes"].count("Pasta") == 1

    def test_header_ingredients_excluded(self):
        """Section headers in ingredient lists are not added to the shopping list."""
        r = make_recipe("Salad", 2, [
            make_ingredient("Dressing", is_header=True),
            make_ingredient("olive oil", "2 tablespoon"),
        ])
        entries = [make_entry(r, servings=1)]
        flat = self._list(r, entries)
        assert "Dressing" not in flat
        assert "olive oil" in flat


# ── Quantity parsing ──────────────────────────────────────────────────────────

class TestParseQty:
    def test_integer(self):
        assert _parse_qty("2") == (2.0, "")

    def test_integer_with_unit(self):
        assert _parse_qty("2 lb") == (2.0, "lb")

    def test_fraction(self):
        n, u = _parse_qty("1/2 cup")
        assert abs(n - 0.5) < 1e-9
        assert u == "cup"

    def test_mixed_number(self):
        n, u = _parse_qty("1 1/2 cups")
        assert abs(n - 1.5) < 1e-9
        assert u == "cup"

    def test_unicode_fraction(self):
        n, u = _parse_qty("½ cup")
        assert abs(n - 0.5) < 1e-9
        assert u == "cup"

    def test_unit_normalisation(self):
        _, u = _parse_qty("2 tablespoons")
        assert u == "tablespoon"

    def test_unparseable_returns_none(self):
        n, raw = _parse_qty("a handful")
        assert n is None
        assert raw == "a handful"


# ── Number formatting ─────────────────────────────────────────────────────────

class TestFmtNumber:
    def test_whole(self):
        assert _fmt_number(3.0) == "3"

    def test_half(self):
        assert _fmt_number(0.5) == "½"

    def test_mixed(self):
        assert _fmt_number(1.5) == "1½"

    def test_quarter(self):
        assert _fmt_number(0.25) == "¼"
