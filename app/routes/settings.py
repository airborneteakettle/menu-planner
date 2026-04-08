from flask import Blueprint, jsonify
from app import db
from app.models.recipe import Recipe
from app.services.auto_tags import apply_auto_tags

bp = Blueprint("settings", __name__)


@bp.route("/auto-tag-recipes", methods=["POST"])
def auto_tag_recipes():
    """
    POST /api/settings/auto-tag-recipes
    Runs apply_auto_tags on every recipe and returns a summary of changes.
    """
    recipes = Recipe.query.order_by(Recipe.name).all()
    results = []

    for recipe in recipes:
        before = {t.name for t in recipe.tags}
        apply_auto_tags(recipe)
        after  = {t.name for t in recipe.tags}
        added  = sorted(after - before)
        results.append({
            "id":    recipe.id,
            "name":  recipe.name,
            "added": added,
        })

    db.session.commit()

    total_added = sum(len(r["added"]) for r in results)
    return jsonify({
        "recipes_processed": len(recipes),
        "tags_added":        total_added,
        "results":           results,
    })
