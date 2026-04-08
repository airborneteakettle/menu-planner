from flask import Blueprint, jsonify
from flask_login import current_user
from app.models.user import User

bp = Blueprint("users", __name__)


@bp.route("/", methods=["GET"])
def list_users():
    """Return all users except current — for share dropdowns."""
    users = User.query.filter(User.id != current_user.id).order_by(User.username).all()
    return jsonify([{"id": u.id, "username": u.username} for u in users])
