from flask import Blueprint, jsonify, request, current_app
from app import db
from app.models.recipe import Recipe, Ingredient
from app.models.goals import DietGoal
from app.services.recipe_importer import import_recipe_from_url

bp = Blueprint("recipes", __name__)


def _attach_goal_comparison(recipe_dict: dict) -> dict:
    """Add a 'vs_goal' block showing how this recipe's macros compare to the current goal."""
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


@bp.route("/", methods=["GET"])
def list_recipes():
    meal_type = request.args.get("meal_type")
    query = Recipe.query
    if meal_type:
        query = query.filter_by(meal_type=meal_type)
    return jsonify([r.to_dict() for r in query.all()])


@bp.route("/<int:recipe_id>", methods=["GET"])
def get_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    return jsonify(_attach_goal_comparison(recipe.to_dict()))


@bp.route("/import", methods=["POST"])
def import_recipe():
    """
    POST /api/recipes/import
    Body: {"url": "https://..."}
    Scrapes the recipe and stores it. Falls back to USDA for nutrition.
    """
    data = request.get_json()
    url = (data or {}).get("url", "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400

    api_key = current_app.config.get("USDA_API_KEY", "DEMO_KEY")
    try:
        scraped = import_recipe_from_url(url, api_key)
    except Exception as e:
        return jsonify({"error": f"Failed to scrape recipe: {e}"}), 422

    recipe = Recipe(
        name=scraped["name"],
        servings=scraped.get("servings", 1),
        calories=scraped.get("calories"),
        protein_g=scraped.get("protein_g"),
        fat_g=scraped.get("fat_g"),
        carbs_g=scraped.get("carbs_g"),
        meal_type=scraped.get("meal_type"),
        source_url=scraped.get("source_url"),
        nutrition_source=scraped.get("nutrition_source"),
    )
    for ing in scraped.get("ingredients", []):
        recipe.ingredients.append(Ingredient(name=ing["name"], quantity=ing.get("quantity")))

    db.session.add(recipe)
    db.session.commit()
    return jsonify(_attach_goal_comparison(recipe.to_dict())), 201


@bp.route("/", methods=["POST"])
def create_recipe():
    data = request.get_json()
    recipe = Recipe(
        name=data["name"],
        description=data.get("description"),
        servings=data.get("servings", 1),
        calories=data.get("calories"),
        protein_g=data.get("protein_g"),
        carbs_g=data.get("carbs_g"),
        fat_g=data.get("fat_g"),
        meal_type=data.get("meal_type"),
    )
    for ing in data.get("ingredients", []):
        recipe.ingredients.append(Ingredient(name=ing["name"], quantity=ing.get("quantity")))
    db.session.add(recipe)
    db.session.commit()
    return jsonify(recipe.to_dict()), 201


@bp.route("/<int:recipe_id>", methods=["PUT"])
def update_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    data = request.get_json()
    for field in ("name", "description", "servings", "calories", "protein_g", "carbs_g", "fat_g", "meal_type"):
        if field in data:
            setattr(recipe, field, data[field])
    db.session.commit()
    return jsonify(recipe.to_dict())


@bp.route("/<int:recipe_id>", methods=["DELETE"])
def delete_recipe(recipe_id):
    recipe = Recipe.query.get_or_404(recipe_id)
    db.session.delete(recipe)
    db.session.commit()
    return "", 204
