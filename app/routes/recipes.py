from flask import Blueprint, jsonify, request, current_app
from flask_login import current_user
from app import db
from app.models.recipe import Recipe, Ingredient, Tag, RecipeRating
from app.models.goals import DietGoal
from app.services.recipe_importer import import_recipe_from_url
from app.services.auto_tags import apply_auto_tags
from app.services.usda import estimate_recipe_nutrition, lookup_ingredient_nutrition, parse_ingredient

bp = Blueprint("recipes", __name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _my_rating(recipe_id: int) -> int | None:
    row = RecipeRating.query.filter_by(
        user_id=current_user.id, recipe_id=recipe_id
    ).first()
    return row.rating if row else None


def _attach_goal_comparison(recipe_dict: dict) -> dict:
    goal = DietGoal.query.order_by(DietGoal.created_at.desc()).first()
    if not goal:
        return recipe_dict
    recipe_dict["vs_goal"] = {
        "calories":  {"recipe": recipe_dict.get("calories"),  "target": goal.calories_target},
        "protein_g": {"recipe": recipe_dict.get("protein_g"), "target": goal.protein_g_target},
        "carbs_g":   {"recipe": recipe_dict.get("carbs_g"),   "target": goal.carbs_g_target},
        "fat_g":     {"recipe": recipe_dict.get("fat_g"),     "target": goal.fat_g_target},
    }
    return recipe_dict


def _sync_tags(recipe: Recipe, tag_names: list[str]):
    """Replace all of the recipe's tags with the given list of names."""
    tags = []
    for raw in tag_names:
        name = raw.strip().lower()
        if not name:
            continue
        tag = Tag.query.filter_by(name=name).first() or Tag(name=name)
        db.session.add(tag)
        tags.append(tag)
    recipe.tags = tags


# ── Tag listing ───────────────────────────────────────────────────────────────

@bp.route("/estimate-nutrition", methods=["POST"])
def estimate_nutrition():
    """
    POST /api/recipes/estimate-nutrition
    Body: { "ingredients": [{"name": "...", "quantity": "..."}] }
    Returns per-ingredient breakdown + totals.
    """
    data        = request.get_json() or {}
    ingredients = data.get("ingredients", [])
    api_key     = current_app.config.get("USDA_API_KEY", "DEMO_KEY")

    KEYS = ("calories", "protein_g", "fat_g", "carbs_g")
    totals    = {k: 0.0 for k in KEYS}
    breakdown = []

    for i in ingredients:
        name = (i.get("name") or "").strip()
        if not name:
            continue
        qty_str = (i.get("quantity") or "").strip()
        ing_str = f"{qty_str} {name}".strip()

        nutrition = lookup_ingredient_nutrition(ing_str, api_key)
        row = {
            "name":     name,
            "quantity": qty_str or None,
            "found":    nutrition is not None,
        }
        for k in KEYS:
            v = round(nutrition.get(k, 0.0), 1) if nutrition else None
            row[k] = v
            if v:
                totals[k] += v
        breakdown.append(row)

    return jsonify({
        "totals":    {k: round(v, 1) for k, v in totals.items()},
        "breakdown": breakdown,
    })


@bp.route("/tags/", methods=["GET"])
def list_tags():
    include_hidden = request.args.get("include_hidden", "false").lower() == "true"
    q = Tag.query if include_hidden else Tag.query.filter_by(hidden=False)
    return jsonify([t.name for t in q.order_by(Tag.name).all()])


# ── Recipe CRUD ───────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
def list_recipes():
    query = Recipe.query

    if meal_type := request.args.get("meal_type"):
        query = query.filter_by(meal_type=meal_type)

    if tag := request.args.get("tag"):
        query = query.join(Recipe.tags).filter(Tag.name == tag).distinct()

    if tags_csv := request.args.get("tags"):
        names = [t.strip() for t in tags_csv.split(",") if t.strip()]
        if names:
            query = query.join(Recipe.tags).filter(Tag.name.in_(names)).distinct()

    if min_rating := request.args.get("min_rating", type=int):
        query = query.filter(Recipe.rating >= min_rating)

    recipes = query.order_by(Recipe.name).all()
    # Build a map of this user's ratings in one query
    my_ratings = {
        rr.recipe_id: rr.rating
        for rr in RecipeRating.query.filter_by(user_id=current_user.id).all()
    }
    return jsonify([r.to_dict(my_rating=my_ratings.get(r.id)) for r in recipes])


@bp.route("/<int:recipe_id>", methods=["GET"])
def get_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    return jsonify(_attach_goal_comparison(recipe.to_dict(my_rating=_my_rating(recipe_id))))


@bp.route("/import", methods=["POST"])
def import_recipe():
    data = request.get_json()
    url  = (data or {}).get("url", "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400

    api_key = current_app.config.get("USDA_API_KEY", "DEMO_KEY")
    try:
        scraped = import_recipe_from_url(url, api_key)
    except Exception as e:
        msg = str(e)
        if "403" in msg or "Forbidden" in msg:
            return jsonify({"error": (
                "This site blocked the import (Cloudflare protection). "
                "Try adding the recipe manually instead."
            )}), 422
        return jsonify({"error": f"Failed to scrape recipe: {e}"}), 422

    recipe = Recipe(
        name             = scraped["name"],
        servings         = scraped.get("servings", 1),
        calories         = scraped.get("calories"),
        protein_g        = scraped.get("protein_g"),
        fat_g            = scraped.get("fat_g"),
        carbs_g          = scraped.get("carbs_g"),
        fiber_g          = scraped.get("fiber_g"),
        instructions     = scraped.get("instructions"),
        source_url       = scraped.get("source_url"),
        nutrition_source = scraped.get("nutrition_source"),
        # meal_type intentionally not set — user sets this manually
    )
    for ing in scraped.get("ingredients", []):
        recipe.ingredients.append(Ingredient(name=ing["name"], quantity=ing.get("quantity")))

    db.session.add(recipe)
    db.session.flush()          # assign recipe.id so tags can reference it
    apply_auto_tags(recipe)
    db.session.commit()
    return jsonify(_attach_goal_comparison(recipe.to_dict())), 201


@bp.route("/", methods=["POST"])
def create_recipe():
    data   = request.get_json()
    recipe = Recipe(
        name             = data["name"],
        description      = data.get("description"),
        servings         = data.get("servings", 1),
        calories         = data.get("calories"),
        protein_g        = data.get("protein_g"),
        carbs_g          = data.get("carbs_g"),
        fat_g            = data.get("fat_g"),
        fiber_g          = data.get("fiber_g"),
        meal_type        = data.get("meal_type"),
        nutrition_source = data.get("nutrition_source"),
    )
    for ing in data.get("ingredients", []):
        recipe.ingredients.append(Ingredient(name=ing["name"], quantity=ing.get("quantity")))
    if "tags" in data:
        _sync_tags(recipe, data["tags"])
    db.session.add(recipe)
    db.session.flush()
    apply_auto_tags(recipe)
    db.session.commit()
    return jsonify(recipe.to_dict()), 201


@bp.route("/<int:recipe_id>", methods=["PUT"])
def update_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    data   = request.get_json()
    for field in ("name", "description", "servings", "calories",
                  "protein_g", "carbs_g", "fat_g", "fiber_g", "meal_type"):
        if field in data:
            setattr(recipe, field, data[field])
    if "tags" in data:
        _sync_tags(recipe, data["tags"])
    db.session.commit()
    return jsonify(recipe.to_dict())


@bp.route("/<int:recipe_id>/rating", methods=["PATCH"])
def set_rating(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    data   = request.get_json()
    rating = data.get("rating")
    if rating is not None and rating not in (1, 2, 3, 4, 5):
        return jsonify({"error": "Rating must be 1–5 or null"}), 400

    row = RecipeRating.query.filter_by(
        user_id=current_user.id, recipe_id=recipe_id
    ).first()
    if rating is None:
        if row:
            db.session.delete(row)
    else:
        if row:
            row.rating = rating
        else:
            db.session.add(RecipeRating(
                user_id=current_user.id, recipe_id=recipe_id, rating=rating
            ))
    db.session.commit()
    return jsonify(recipe.to_dict(my_rating=rating))


@bp.route("/<int:recipe_id>", methods=["DELETE"])
def delete_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    db.session.delete(recipe)
    db.session.commit()
    return "", 204
