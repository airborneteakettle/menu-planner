from flask import Blueprint, jsonify, request
from flask_login import current_user
from sqlalchemy import or_
from app import db
from app.models.menu import MenuEntry, MenuEntryShare
from app.models.recipe import Recipe, Tag
from app.models.goals import DietGoal
from app.models.shopping import CustomShoppingItem
from app.services.shopping import generate_shopping_list
from datetime import date, timedelta

bp = Blueprint("menu", __name__)


def _visible_entries(query):
    """Filter to entries owned by or shared with current_user."""
    return query.outerjoin(
        MenuEntryShare,
        MenuEntryShare.entry_id == MenuEntry.id
    ).filter(
        or_(
            MenuEntry.user_id == current_user.id,
            MenuEntryShare.user_id == current_user.id,
        )
    ).distinct()


@bp.route("/", methods=["GET"])
def get_menu():
    start = request.args.get("start")
    end   = request.args.get("end")
    query = _visible_entries(MenuEntry.query)
    if start:
        query = query.filter(MenuEntry.date >= date.fromisoformat(start))
    if end:
        query = query.filter(MenuEntry.date <= date.fromisoformat(end))
    entries = query.order_by(MenuEntry.date).all()
    return jsonify([e.to_dict(viewer_id=current_user.id) for e in entries])


@bp.route("/week", methods=["GET"])
def get_week():
    today = date.today()
    start = today - timedelta(days=today.weekday())
    end   = start + timedelta(days=6)
    entries = _visible_entries(MenuEntry.query).filter(
        MenuEntry.date >= start, MenuEntry.date <= end
    ).order_by(MenuEntry.date).all()
    return jsonify([e.to_dict(viewer_id=current_user.id) for e in entries])


@bp.route("/daily-summary", methods=["GET"])
def daily_summary():
    day_str = request.args.get("date", date.today().isoformat())
    day     = date.fromisoformat(day_str)
    entries = _visible_entries(MenuEntry.query).filter(MenuEntry.date == day).all()

    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    for entry in entries:
        recipe = entry.recipe
        if not recipe:
            continue
        factor = (entry.servings or 1) / (recipe.servings or 1)
        for k in totals:
            totals[k] += (getattr(recipe, k) or 0) * factor

    goal      = DietGoal.query.filter_by(user_id=current_user.id)\
                              .order_by(DietGoal.created_at.desc()).first()
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
        "date":    day_str,
        "meals":   [e.to_dict(viewer_id=current_user.id) for e in entries],
        "totals":  {k: round(v, 1) for k, v in totals.items()},
        "goal":    goal_dict,
        "vs_goal": comparison,
    })


@bp.route("/weekly-summary", methods=["GET"])
def weekly_summary():
    today         = date.today()
    default_start = today - timedelta(days=today.weekday())
    start = date.fromisoformat(request.args.get("start", default_start.isoformat()))
    end   = start + timedelta(days=6)

    entries = _visible_entries(MenuEntry.query).filter(
        MenuEntry.date >= start, MenuEntry.date <= end
    ).order_by(MenuEntry.date).all()

    MACROS  = ("calories", "protein_g", "carbs_g", "fat_g")
    day_map = {start + timedelta(days=i): {k: 0.0 for k in MACROS} for i in range(7)}

    for entry in entries:
        recipe = entry.recipe
        if not recipe:
            continue
        factor = (entry.servings or 1) / (recipe.servings or 1)
        for macro in MACROS:
            day_map[entry.date][macro] += (getattr(recipe, macro) or 0) * factor

    days = [
        {"date": d.isoformat(), "day": d.strftime("%a"),
         **{k: round(v, 1) for k, v in t.items()}}
        for d, t in sorted(day_map.items())
    ]

    weekly_totals = {k: round(sum(d[k] for d in days), 1) for k in MACROS}

    goal = DietGoal.query.filter_by(user_id=current_user.id)\
                         .order_by(DietGoal.created_at.desc()).first()
    weekly_targets = {}
    if goal:
        weekly_targets = {
            "calories":  (goal.calories_target  or 0) * 7,
            "protein_g": (goal.protein_g_target or 0) * 7,
            "carbs_g":   (goal.carbs_g_target   or 0) * 7,
            "fat_g":     (goal.fat_g_target     or 0) * 7,
        }

    return jsonify({
        "week_start":     start.isoformat(),
        "week_end":       end.isoformat(),
        "days":           days,
        "totals":         weekly_totals,
        "weekly_targets": weekly_targets,
        "has_goal":       goal is not None,
    })


@bp.route("/shopping-list", methods=["GET"])
def shopping_list():
    today         = date.today()
    default_start = today - timedelta(days=today.weekday())
    default_end   = default_start + timedelta(days=6)
    start = date.fromisoformat(request.args.get("start", default_start.isoformat()))
    end   = date.fromisoformat(request.args.get("end",   default_end.isoformat()))

    entries = _visible_entries(MenuEntry.query).filter(
        MenuEntry.date >= start, MenuEntry.date <= end
    ).all()

    grouped     = generate_shopping_list(entries)
    total_items = sum(len(v) for v in grouped.values())
    return jsonify({
        "week_start":  start.isoformat(),
        "week_end":    end.isoformat(),
        "total_items": total_items,
        "list":        grouped,
    })


@bp.route("/", methods=["POST"])
def add_entry():
    data  = request.get_json()
    entry = MenuEntry(
        user_id   = current_user.id,
        date      = date.fromisoformat(data["date"]),
        meal_type = data["meal_type"],
        recipe_id = data["recipe_id"],
        servings  = data.get("servings", 1.0),
    )
    db.session.add(entry)
    db.session.flush()

    # Share with requested user ids immediately
    for uid in (data.get("share_with") or []):
        if uid != current_user.id:
            db.session.add(MenuEntryShare(entry_id=entry.id, user_id=uid))

    # Auto-tag recipe with meal type
    meal_type = data.get("meal_type")
    if meal_type:
        recipe = Recipe.query.get(data["recipe_id"])
        if recipe and meal_type not in [t.name for t in recipe.tags]:
            tag = Tag.query.filter_by(name=meal_type).first() or Tag(name=meal_type)
            db.session.add(tag)
            recipe.tags.append(tag)

    db.session.commit()
    return jsonify(entry.to_dict(viewer_id=current_user.id)), 201


@bp.route("/<int:entry_id>", methods=["DELETE"])
def remove_entry(entry_id):
    entry = MenuEntry.query.get_or_404(entry_id)
    if entry.user_id == current_user.id:
        # Owner deletes the entry entirely
        db.session.delete(entry)
    else:
        # Shared user just removes themselves from the share
        share = MenuEntryShare.query.filter_by(
            entry_id=entry_id, user_id=current_user.id
        ).first()
        if share:
            db.session.delete(share)
    db.session.commit()
    return "", 204


# ── Sharing ────────────────────────────────────────────────────────────────────

@bp.route("/<int:entry_id>/share", methods=["POST"])
def share_entry(entry_id):
    """Share an entry with another user. Body: { "user_id": N }"""
    entry = MenuEntry.query.filter_by(id=entry_id, user_id=current_user.id).first_or_404()
    data  = request.get_json()
    uid   = data.get("user_id")
    if not uid or uid == current_user.id:
        return jsonify({"error": "Invalid user"}), 400
    existing = MenuEntryShare.query.filter_by(entry_id=entry_id, user_id=uid).first()
    if not existing:
        db.session.add(MenuEntryShare(entry_id=entry_id, user_id=uid))
        db.session.commit()
    return jsonify(entry.to_dict(viewer_id=current_user.id))


@bp.route("/<int:entry_id>/share/<int:uid>", methods=["DELETE"])
def unshare_entry(entry_id, uid):
    """Remove a share. Owner can remove any; shared user can remove themselves."""
    entry = MenuEntry.query.get_or_404(entry_id)
    if entry.user_id != current_user.id and uid != current_user.id:
        return jsonify({"error": "Forbidden"}), 403
    share = MenuEntryShare.query.filter_by(entry_id=entry_id, user_id=uid).first()
    if share:
        db.session.delete(share)
        db.session.commit()
    return "", 204


# ── Custom shopping items ──────────────────────────────────────────────────────

@bp.route("/custom-items", methods=["GET"])
def list_custom_items():
    items = CustomShoppingItem.query.filter_by(user_id=current_user.id)\
                                    .order_by(CustomShoppingItem.created_at).all()
    return jsonify([i.to_dict() for i in items])


@bp.route("/custom-items", methods=["POST"])
def add_custom_item():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    qty      = (data.get("quantity") or "").strip() or None
    category = (data.get("category") or "").strip() or "Miscellaneous"
    item     = CustomShoppingItem(user_id=current_user.id, name=name,
                                  quantity=qty, category=category)
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@bp.route("/custom-items/<int:item_id>", methods=["DELETE"])
def delete_custom_item(item_id):
    item = CustomShoppingItem.query.filter_by(id=item_id, user_id=current_user.id)\
                                   .first_or_404()
    db.session.delete(item)
    db.session.commit()
    return "", 204
