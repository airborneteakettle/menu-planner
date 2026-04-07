from flask import Blueprint, jsonify, request
from app import db
from app.models.menu import MenuEntry
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
    db.session.commit()
    return jsonify(entry.to_dict()), 201

@bp.route("/<int:entry_id>", methods=["DELETE"])
def remove_entry(entry_id):
    entry = MenuEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return "", 204
