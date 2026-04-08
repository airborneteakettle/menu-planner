import logging
from flask import Blueprint, jsonify, request
from flask_login import current_user
from app import db
from app.models.recipe import Recipe
from app.services.auto_tags import apply_auto_tags

bp = Blueprint("settings", __name__)
log = logging.getLogger(__name__)


@bp.route("/account", methods=["GET"])
def get_account():
    return jsonify({"username": current_user.username, "email": current_user.email})


@bp.route("/account", methods=["POST"])
def update_account():
    from app.models.user import User
    data  = request.get_json() or {}
    email = data.get("email", "").strip().lower()

    if not email:
        return jsonify({"error": "Email is required"}), 400
    if "@" not in email:
        return jsonify({"error": "Invalid email address"}), 400

    conflict = User.query.filter(User.email == email, User.id != current_user.id).first()
    if conflict:
        return jsonify({"error": "That email is already in use"}), 400

    current_user.email = email
    db.session.commit()
    log.info("EMAIL_UPDATE: user=%s new_email=%s", current_user.username, email)
    return jsonify({"ok": True})


@bp.route("/change-password", methods=["POST"])
def change_password():
    data = request.get_json() or {}
    current_pw = data.get("current_password", "")
    new_pw     = data.get("new_password", "")

    if not current_pw or not new_pw:
        return jsonify({"error": "Both current and new password are required"}), 400
    if len(new_pw) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400
    if not current_user.check_password(current_pw):
        log.warning("PASSWORD_CHANGE_FAILED: user=%s (wrong current password)", current_user.username)
        return jsonify({"error": "Current password is incorrect"}), 400

    current_user.set_password(new_pw)
    db.session.commit()
    log.info("PASSWORD_CHANGE: user=%s", current_user.username)
    return jsonify({"ok": True})


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
    log.info("AUTO_TAG: user=%s recipes=%d tags_added=%d", current_user.username, len(recipes), total_added)
    return jsonify({
        "recipes_processed": len(recipes),
        "tags_added":        total_added,
        "results":           results,
    })
