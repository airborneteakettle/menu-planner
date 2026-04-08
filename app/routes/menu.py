from flask import Blueprint, jsonify, request
from app import db
from app.models.menu import MenuEntry
from app.models.recipe import Recipe, Tag
from app.models.goals import DietGoal
from app.models.shopping import CustomShoppingItem
from app.services.shopping import generate_shopping_list
from datetime import date, timedelta

bp = Blueprint("menu", __name__)


@bp.route("/", methods=["GET"])
def get_menu():
    """Get menu entries. Optionally filter by ?start=YYYY-MM-DD&end=YYYY-MM-DD"""
    start = request.args.get("start")
    end = request.args.get("end")
    query = MenuEntry.query
    if start:
        query = query.filter(MenuEntry.date >= date.fromisoformat(start))
    if end:
        query = query.filter(MenuEntry.date <= date.fromisoformat(end))
    entries = query.order_by(MenuEntry.date).all()
    return jsonify([e.to_dict() for e in entries])


@bp.route("/week", methods=["GET"])
def get_week():
    """Get this week's menu (Mon–Sun)."""
    today = date.today()
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    entries = MenuEntry.query.filter(
        MenuEntry.date >= start, MenuEntry.date <= end
    ).order_by(MenuEntry.date).all()
    return jsonify([e.to_dict() for e in entries])


@bp.route("/daily-summary", methods=["GET"])
def daily_summary():
    """
    GET /api/menu/daily-summary?date=YYYY-MM-DD
    Returns nutrition totals for the day and compares against current diet goal.
    """
    day_str = request.args.get("date", date.today().isoformat())
    day = date.fromisoformat(day_str)

    entries = MenuEntry.query.filter_by(date=day).all()

    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    for entry in entries:
        recipe = entry.recipe
        if not recipe:
            continue
        factor = (entry.servings or 1) / (recipe.servings or 1)
        totals["calories"]  += (recipe.calories  or 0) * factor
        totals["protein_g"] += (recipe.protein_g or 0) * factor
        totals["carbs_g"]   += (recipe.carbs_g   or 0) * factor
        totals["fat_g"]     += (recipe.fat_g     or 0) * factor

    goal = DietGoal.query.order_by(DietGoal.created_at.desc()).first()
    goal_dict = goal.to_dict() if goal else {}

    comparison = {}
    if goal:
        def _pct(actual, target):
            return round(actual / target * 100, 1) if target else None

        comparison = {
            "calories":  {"actual": round(totals["calories"],  1), "target": goal.calories_target,  "pct": _pct(totals["calories"],  goal.calories_target)},
            "protein_g": {"actual": round(totals["protein_g"], 1), "target": goal.protein_g_target, "pct": _pct(totals["protein_g"], goal.protein_g_target)},
            "carbs_g":   {"actual": round(totals["carbs_g"],   1), "target": goal.carbs_g_target,   "pct": _pct(totals["carbs_g"],   goal.carbs_g_target)},
            "fat_g":     {"actual": round(totals["fat_g"],     1), "target": goal.fat_g_target,     "pct": _pct(totals["fat_g"],     goal.fat_g_target)},
        }

    return jsonify({
        "date": day_str,
        "meals": [e.to_dict() for e in entries],
        "totals": {k: round(v, 1) for k, v in totals.items()},
        "goal": goal_dict,
        "vs_goal": comparison,
    })


@bp.route("/shopping-list", methods=["GET"])
def shopping_list():
    """
    GET /api/menu/shopping-list?start=YYYY-MM-DD&end=YYYY-MM-DD
    Defaults to the current week (Mon–Sun).
    Returns ingredients grouped by category.
    """
    today = date.today()
    default_start = today - timedelta(days=today.weekday())
    default_end = default_start + timedelta(days=6)

    start = date.fromisoformat(request.args.get("start", default_start.isoformat()))
    end   = date.fromisoformat(request.args.get("end",   default_end.isoformat()))

    entries = MenuEntry.query.filter(
        MenuEntry.date >= start, MenuEntry.date <= end
    ).all()

    grouped = generate_shopping_list(entries)

    total_items = sum(len(v) for v in grouped.values())
    return jsonify({
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "total_items": total_items,
        "list": grouped,
    })


@bp.route("/", methods=["POST"])
def add_entry():
    data = request.get_json()
    entry = MenuEntry(
        date=date.fromisoformat(data["date"]),
        meal_type=data["meal_type"],
        recipe_id=data["recipe_id"],
        servings=data.get("servings", 1.0),
    )
    db.session.add(entry)

    # Auto-tag the recipe with its meal type
    meal_type = data.get("meal_type")
    if meal_type:
        recipe = Recipe.query.get(data["recipe_id"])
        if recipe and meal_type not in [t.name for t in recipe.tags]:
            tag = Tag.query.filter_by(name=meal_type).first() or Tag(name=meal_type)
            db.session.add(tag)
            recipe.tags.append(tag)

    db.session.commit()
    return jsonify(entry.to_dict()), 201


@bp.route("/<int:entry_id>", methods=["DELETE"])
def remove_entry(entry_id):
    entry = MenuEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return "", 204


# ── Custom shopping items ──────────────────────────────────────────────────────

@bp.route("/custom-items", methods=["GET"])
def list_custom_items():
    items = CustomShoppingItem.query.order_by(CustomShoppingItem.created_at).all()
    return jsonify([i.to_dict() for i in items])


@bp.route("/custom-items", methods=["POST"])
def add_custom_item():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    qty = (data.get("quantity") or "").strip() or None
    category = (data.get("category") or "").strip() or "Miscellaneous"
    item = CustomShoppingItem(name=name, quantity=qty, category=category)
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@bp.route("/custom-items/<int:item_id>", methods=["DELETE"])
def delete_custom_item(item_id):
    item = CustomShoppingItem.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return "", 204
