from flask import Blueprint, jsonify
from flask_login import current_user
from app.models.user import User
from app.models.household import HouseholdMember

bp = Blueprint("users", __name__)


@bp.route("/", methods=["GET"])
def list_users():
    """Return other users in the same household — for share dropdowns."""
    member = HouseholdMember.query.filter_by(user_id=current_user.id).first()
    if not member:
        return jsonify([])
    peer_ids = [
        m.user_id for m in
        HouseholdMember.query.filter_by(household_id=member.household_id).all()
        if m.user_id != current_user.id
    ]
    users = User.query.filter(User.id.in_(peer_ids)).order_by(User.username).all()
    return jsonify([{"id": u.id, "username": u.username} for u in users])
