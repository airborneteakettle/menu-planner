from flask import Blueprint, jsonify, request
from app import db
from app.models.recipe import Recipe, Ingredient

bp = Blueprint("recipes", __name__)

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
    return jsonify(recipe.to_dict())

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
