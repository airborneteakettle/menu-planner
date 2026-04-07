from flask import Blueprint, jsonify, request
from app import db
from app.models.goals import DietGoal

bp = Blueprint("goals", __name__)

@bp.route("/", methods=["GET"])
def get_goals():
    goals = DietGoal.query.order_by(DietGoal.created_at.desc()).all()
    return jsonify([g.to_dict() for g in goals])

@bp.route("/current", methods=["GET"])
def get_current_goal():
    goal = DietGoal.query.order_by(DietGoal.created_at.desc()).first()
    if not goal:
        return jsonify({}), 404
    return jsonify(goal.to_dict())

@bp.route("/", methods=["POST"])
def create_goal():
    data = request.get_json()
    goal = DietGoal(
        calories_target=data.get("calories_target"),
        protein_g_target=data.get("protein_g_target"),
        carbs_g_target=data.get("carbs_g_target"),
        fat_g_target=data.get("fat_g_target"),
        fiber_g_target=data.get("fiber_g_target"),
        notes=data.get("notes"),
    )
    db.session.add(goal)
    db.session.commit()
    return jsonify(goal.to_dict()), 201
