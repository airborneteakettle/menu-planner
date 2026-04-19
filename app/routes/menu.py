import logging
from flask import Blueprint, jsonify, request
from flask_login import current_user
from sqlalchemy import or_
from app import db
from app.models.menu import MenuEntry, MenuEntryShare
from app.models.recipe import Recipe, Tag
from app.models.goals import DietGoal
from app.models.shopping import CustomShoppingItem, ShoppingCheckedItem
from app.models.household import HouseholdMember
from app.services.shopping import generate_shopping_list, _categorize
from datetime import date, timedelta

bp = Blueprint("menu", __name__)
log = logging.getLogger(__name__)


def _household_user_ids():
    """All user_ids in the same household as current_user (including self)."""
    member = HouseholdMember.query.filter_by(user_id=current_user.id).first()
    if not member:
        return [current_user.id]
    return [m.user_id for m in
            HouseholdMember.query.filter_by(household_id=member.household_id).all()]


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

    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "fiber_g": 0.0}
    for entry in entries:
        recipe = entry.recipe
        factor = entry.servings or 1
        if recipe:
            # Nutrition values are stored per-serving; multiply by how many servings eaten
            for k in totals:
                totals[k] += (getattr(recipe, k) or 0) * factor
        elif entry.is_adhoc:
            # Ad hoc entries store absolute nutrition (not per-serving)
            totals["calories"]  += (entry.adhoc_calories  or 0) * factor
            totals["protein_g"] += (entry.adhoc_protein_g or 0) * factor
            totals["carbs_g"]   += (entry.adhoc_carbs_g   or 0) * factor
            totals["fat_g"]     += (entry.adhoc_fat_g     or 0) * factor
            totals["fiber_g"]   += (entry.adhoc_fiber_g   or 0) * factor

    goal      = DietGoal.query.filter_by(user_id=current_user.id)\
                              .order_by(DietGoal.id.desc()).first()
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

    MACROS  = ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g")
    day_map = {start + timedelta(days=i): {k: 0.0 for k in MACROS} for i in range(7)}

    for entry in entries:
        recipe = entry.recipe
        factor = entry.servings or 1
        if recipe:
            for macro in MACROS:
                day_map[entry.date][macro] += (getattr(recipe, macro) or 0) * factor
        elif entry.is_adhoc:
            day_map[entry.date]["calories"]  += (entry.adhoc_calories  or 0) * factor
            day_map[entry.date]["protein_g"] += (entry.adhoc_protein_g or 0) * factor
            day_map[entry.date]["carbs_g"]   += (entry.adhoc_carbs_g   or 0) * factor
            day_map[entry.date]["fat_g"]     += (entry.adhoc_fat_g     or 0) * factor
            day_map[entry.date]["fiber_g"]   += (entry.adhoc_fiber_g   or 0) * factor

    days = [
        {"date": d.isoformat(), "day": d.strftime("%a"),
         **{k: round(v, 1) for k, v in t.items()}}
        for d, t in sorted(day_map.items())
    ]

    weekly_totals = {k: round(sum(d[k] for d in days), 1) for k in MACROS}

    goal = DietGoal.query.filter_by(user_id=current_user.id)\
                         .order_by(DietGoal.id.desc()).first()
    weekly_targets = {}
    if goal:
        weekly_targets = {
            "calories":  (goal.calories_target  or 0) * 7,
            "protein_g": (goal.protein_g_target or 0) * 7,
            "carbs_g":   (goal.carbs_g_target   or 0) * 7,
            "fat_g":     (goal.fat_g_target     or 0) * 7,
            "fiber_g":   (goal.fiber_g_target   or 0) * 7,
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

    # Include every entry from every household member (not just shared ones)
    member_ids = _household_user_ids()
    entries = MenuEntry.query.filter(
        MenuEntry.user_id.in_(member_ids),
        MenuEntry.date >= start,
        MenuEntry.date <= end,
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
    data      = request.get_json()
    recipe_id = data.get("recipe_id")
    entry = MenuEntry(
        user_id   = current_user.id,
        date      = date.fromisoformat(data["date"]),
        meal_type = data["meal_type"],
        recipe_id = recipe_id,
        servings  = data.get("servings", 1.0),
    )
    if not recipe_id:
        # Ad hoc meal — store label + nutrition directly on the entry
        entry.adhoc_name      = (data.get("adhoc_name") or "").strip() or "Ad hoc meal"
        entry.adhoc_calories  = data.get("adhoc_calories")
        entry.adhoc_protein_g = data.get("adhoc_protein_g")
        entry.adhoc_carbs_g   = data.get("adhoc_carbs_g")
        entry.adhoc_fat_g     = data.get("adhoc_fat_g")
        entry.adhoc_fiber_g   = data.get("adhoc_fiber_g")

    db.session.add(entry)
    db.session.flush()

    for uid in (data.get("share_with") or []):
        if uid != current_user.id:
            db.session.add(MenuEntryShare(entry_id=entry.id, user_id=uid))

    # Auto-tag recipe with meal type (only for recipe-backed entries)
    if recipe_id:
        meal_type = data.get("meal_type")
        recipe    = Recipe.query.get(recipe_id)
        if recipe and meal_type and meal_type not in [t.name for t in recipe.tags]:
            tag = Tag.query.filter_by(name=meal_type).first() or Tag(name=meal_type)
            db.session.add(tag)
            recipe.tags.append(tag)

    db.session.commit()
    if recipe_id:
        log.info("MENU_ADD: user=%s entry_id=%d recipe_id=%d date=%s meal=%s",
                 current_user.username, entry.id, recipe_id, entry.date, entry.meal_type)
    else:
        log.info("MENU_ADD_ADHOC: user=%s entry_id=%d name=%r date=%s meal=%s",
                 current_user.username, entry.id, entry.adhoc_name, entry.date, entry.meal_type)
    return jsonify(entry.to_dict(viewer_id=current_user.id)), 201


@bp.route("/<int:entry_id>", methods=["PATCH"])
def update_entry(entry_id):
    entry = MenuEntry.query.filter_by(id=entry_id, user_id=current_user.id).first_or_404()
    data  = request.get_json() or {}
    if "adhoc_name" in data:
        entry.adhoc_name      = (data.get("adhoc_name") or "").strip() or "Ad hoc meal"
    if "adhoc_calories" in data:
        entry.adhoc_calories  = data.get("adhoc_calories")
    if "adhoc_protein_g" in data:
        entry.adhoc_protein_g = data.get("adhoc_protein_g")
    if "adhoc_carbs_g" in data:
        entry.adhoc_carbs_g   = data.get("adhoc_carbs_g")
    if "adhoc_fat_g" in data:
        entry.adhoc_fat_g     = data.get("adhoc_fat_g")
    if "adhoc_fiber_g" in data:
        entry.adhoc_fiber_g   = data.get("adhoc_fiber_g")
    if "date" in data:
        entry.date = date.fromisoformat(data["date"])
    if "meal_type" in data:
        entry.meal_type = data["meal_type"]
    if "servings" in data:
        entry.servings = max(0.5, float(data["servings"] or 1))
    db.session.commit()
    log.info("MENU_UPDATE_ADHOC: user=%s entry_id=%d", current_user.username, entry.id)
    return jsonify(entry.to_dict(viewer_id=current_user.id))


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
    log.info("MENU_REMOVE: user=%s entry_id=%d", current_user.username, entry_id)
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


# ── Add recipe ingredients directly to shopping list ─────────────────────────

@bp.route("/shopping-from-recipe", methods=["POST"])
def shopping_from_recipe():
    """Add a recipe's ingredients as custom shopping items for a given week."""
    data       = request.get_json() or {}
    recipe_id  = data.get("recipe_id")
    week_start = (data.get("week_start") or "").strip()
    servings   = max(0.5, float(data.get("servings") or 1))

    if not recipe_id:
        return jsonify({"error": "recipe_id is required"}), 400
    if not week_start:
        return jsonify({"error": "week_start is required"}), 400

    recipe = Recipe.query.get_or_404(recipe_id)

    # Scale factor: how many times the full recipe to make
    recipe_yield = max(recipe.servings or 1, 1)
    import math
    batches = math.ceil(servings / recipe_yield)

    created = []
    for ing in recipe.ingredients:
        if ing.is_header:
            continue
        name = ing.name.strip()
        if not name:
            continue
        qty  = (ing.quantity or "").strip() or None
        # Scale quantity by batch count if it starts with a number
        if qty and batches > 1:
            import re
            m = re.match(r'^(\d+(?:[./]\d+)?(?:\s+\d+/\d+)?)\s*(.*)', qty)
            if m:
                try:
                    from fractions import Fraction
                    amount = float(sum(Fraction(p) for p in m.group(1).split()))
                    unit   = m.group(2).strip()
                    scaled = amount * batches
                    whole  = int(scaled)
                    frac   = scaled - whole
                    frac_str = {0.5: '½', 0.25: '¼', 0.75: '¾',
                                round(1/3, 6): '⅓', round(2/3, 6): '⅔'}.get(round(frac, 6))
                    num_str = (f"{whole}{frac_str}" if frac_str else
                               f"{whole}" if frac == 0 else f"{scaled:g}")
                    qty = f"{num_str} {unit}".strip() if unit else num_str
                except Exception:
                    pass  # leave qty unscaled if parsing fails

        item = CustomShoppingItem(
            user_id    = current_user.id,
            week_start = week_start,
            name       = name,
            quantity   = qty,
            category   = _categorize(name),
        )
        db.session.add(item)
        created.append(item)

    db.session.commit()
    log.info("SHOPPING_FROM_RECIPE: user=%s recipe=%r week=%s items=%d",
             current_user.username, recipe.name, week_start, len(created))
    return jsonify({"added": len(created), "recipe": recipe.name}), 201


# ── Custom shopping items ──────────────────────────────────────────────────────

@bp.route("/custom-items", methods=["GET"])
def list_custom_items():
    week_start = request.args.get("week_start", "")
    member_ids = _household_user_ids()
    items = CustomShoppingItem.query\
        .filter(
            CustomShoppingItem.user_id.in_(member_ids),
            CustomShoppingItem.week_start == week_start,
        )\
        .order_by(CustomShoppingItem.created_at).all()
    return jsonify([i.to_dict() for i in items])


@bp.route("/custom-items", methods=["POST"])
def add_custom_item():
    data       = request.get_json()
    name       = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    week_start = (data.get("week_start") or "").strip()
    if not week_start:
        return jsonify({"error": "week_start is required"}), 400
    qty        = (data.get("quantity") or "").strip() or None
    category   = (data.get("category") or "").strip() or "Miscellaneous"
    item       = CustomShoppingItem(user_id=current_user.id, week_start=week_start,
                                    name=name, quantity=qty, category=category)
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@bp.route("/custom-items/<int:item_id>", methods=["DELETE"])
def delete_custom_item(item_id):
    member_ids = _household_user_ids()
    item = CustomShoppingItem.query.filter(
        CustomShoppingItem.id == item_id,
        CustomShoppingItem.user_id.in_(member_ids),
    ).first_or_404()
    db.session.delete(item)
    db.session.commit()
    return "", 204


# ── Shopping checkmarks ────────────────────────────────────────────────────────
# Checkmarks are household-scoped: any member checking an item marks it for
# everyone; any member unchecking it (or clearing) removes it for everyone.

@bp.route("/shopping-checked", methods=["GET"])
def get_shopping_checked():
    week_start = request.args.get("week_start", "")
    member_ids = _household_user_ids()
    rows = ShoppingCheckedItem.query.filter(
        ShoppingCheckedItem.user_id.in_(member_ids),
        ShoppingCheckedItem.week_start == week_start,
    ).all()
    # Return deduplicated keys — any member's check counts for all
    return jsonify(list({r.item_key for r in rows}))


@bp.route("/shopping-checked", methods=["POST"])
def set_shopping_checked():
    data       = request.get_json() or {}
    week_start = data.get("week_start", "")
    item_key   = (data.get("item_key") or "").strip()
    checked    = data.get("checked", True)
    if not item_key:
        return jsonify({"error": "item_key required"}), 400

    member_ids = _household_user_ids()
    if checked:
        # Only insert if no household member already has this checked
        existing = ShoppingCheckedItem.query.filter(
            ShoppingCheckedItem.user_id.in_(member_ids),
            ShoppingCheckedItem.week_start == week_start,
            ShoppingCheckedItem.item_key == item_key,
        ).first()
        if not existing:
            db.session.add(ShoppingCheckedItem(
                user_id=current_user.id, week_start=week_start, item_key=item_key
            ))
    else:
        # Uncheck for ALL household members so everyone sees it unchecked
        ShoppingCheckedItem.query.filter(
            ShoppingCheckedItem.user_id.in_(member_ids),
            ShoppingCheckedItem.week_start == week_start,
            ShoppingCheckedItem.item_key == item_key,
        ).delete(synchronize_session=False)
    db.session.commit()
    return "", 204


@bp.route("/shopping-checked", methods=["DELETE"])
def clear_shopping_checked():
    week_start = request.args.get("week_start", "")
    member_ids = _household_user_ids()
    ShoppingCheckedItem.query.filter(
        ShoppingCheckedItem.user_id.in_(member_ids),
        ShoppingCheckedItem.week_start == week_start,
    ).delete(synchronize_session=False)
    db.session.commit()
    return "", 204
