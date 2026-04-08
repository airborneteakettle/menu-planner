from flask import Blueprint, jsonify, request, current_app
from app import db
from app.models.recipe import Recipe, Ingredient, Tag
from app.models.goals import DietGoal
from app.services.recipe_importer import import_recipe_from_url

bp = Blueprint("recipes", __name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

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
    """Replace the recipe's tags with the given list of names (created if missing)."""
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

@bp.route("/tags/", methods=["GET"])
def list_tags():
    tags = Tag.query.order_by(Tag.name).all()
    return jsonify([t.name for t in tags])


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

    return jsonify([r.to_dict() for r in query.order_by(Recipe.name).all()])


@bp.route("/<int:recipe_id>", methods=["GET"])
def get_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    return jsonify(_attach_goal_comparison(recipe.to_dict()))


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
        return jsonify({"error": f"Failed to scrape recipe: {e}"}), 422

    recipe = Recipe(
        name             = scraped["name"],
        servings         = scraped.get("servings", 1),
        calories         = scraped.get("calories"),
        protein_g        = scraped.get("protein_g"),
        fat_g            = scraped.get("fat_g"),
        carbs_g          = scraped.get("carbs_g"),
        instructions     = scraped.get("instructions"),
        source_url       = scraped.get("source_url"),
        nutrition_source = scraped.get("nutrition_source"),
        # meal_type intentionally not set — user sets this manually
    )
    for ing in scraped.get("ingredients", []):
        recipe.ingredients.append(Ingredient(name=ing["name"], quantity=ing.get("quantity")))

    db.session.add(recipe)
    db.session.commit()
    return jsonify(_attach_goal_comparison(recipe.to_dict())), 201


@bp.route("/", methods=["POST"])
def create_recipe():
    data   = request.get_json()
    recipe = Recipe(
        name        = data["name"],
        description = data.get("description"),
        servings    = data.get("servings", 1),
        calories    = data.get("calories"),
        protein_g   = data.get("protein_g"),
        carbs_g     = data.get("carbs_g"),
        fat_g       = data.get("fat_g"),
        meal_type   = data.get("meal_type"),
        rating      = data.get("rating"),
    )
    for ing in data.get("ingredients", []):
        recipe.ingredients.append(Ingredient(name=ing["name"], quantity=ing.get("quantity")))
    if "tags" in data:
        _sync_tags(recipe, data["tags"])
    db.session.add(recipe)
    db.session.commit()
    return jsonify(recipe.to_dict()), 201


@bp.route("/<int:recipe_id>", methods=["PUT"])
def update_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    data   = request.get_json()
    for field in ("name", "description", "servings", "calories",
                  "protein_g", "carbs_g", "fat_g", "meal_type", "rating"):
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
    recipe.rating = rating
    db.session.commit()
    return jsonify(recipe.to_dict())


@bp.route("/<int:recipe_id>", methods=["DELETE"])
def delete_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    db.session.delete(recipe)
    db.session.commit()
    return "", 204
