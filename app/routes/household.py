import logging
from flask import Blueprint, jsonify, request
from flask_login import current_user
from sqlalchemy import or_
from app import db
from app.models.household import Household, HouseholdMember
from app.models.user import User

bp = Blueprint('household', __name__)
log = logging.getLogger(__name__)


def _current_household():
    """Return the Household the current user belongs to, or None."""
    member = HouseholdMember.query.filter_by(user_id=current_user.id).first()
    return member.household if member else None


@bp.route('/', methods=['GET'])
def get_household():
    h = _current_household()
    return jsonify(h.to_dict() if h else None)


@bp.route('/', methods=['POST'])
def create_household():
    if HouseholdMember.query.filter_by(user_id=current_user.id).first():
        return jsonify({'error': 'You are already in a household'}), 400
    data = request.get_json() or {}
    h = Household(name=(data.get('name') or '').strip() or None,
                  created_by=current_user.id)
    db.session.add(h)
    db.session.flush()
    db.session.add(HouseholdMember(household_id=h.id, user_id=current_user.id))
    db.session.commit()
    log.info("HOUSEHOLD_CREATE: user=%s household_id=%d name=%r", current_user.username, h.id, h.name)
    return jsonify(h.to_dict()), 201


@bp.route('/invite', methods=['POST'])
def invite_member():
    h = _current_household()
    if not h:
        return jsonify({'error': 'Create a household first'}), 400

    data       = request.get_json() or {}
    identifier = (data.get('identifier') or '').strip()
    if not identifier:
        return jsonify({'error': 'Username or email required'}), 400

    user = User.query.filter(
        or_(User.username == identifier, User.email == identifier)
    ).first()
    if not user:
        return jsonify({'error': 'No account found with that username or email'}), 404
    if user.id == current_user.id:
        return jsonify({'error': 'Cannot invite yourself'}), 400

    existing = HouseholdMember.query.filter_by(user_id=user.id).first()
    if existing:
        if existing.household_id == h.id:
            return jsonify({'error': f'{user.username} is already in this household'}), 400
        return jsonify({'error': f'{user.username} is already in another household'}), 400

    db.session.add(HouseholdMember(household_id=h.id, user_id=user.id))
    db.session.commit()
    log.info("HOUSEHOLD_INVITE: by=%s added=%s household_id=%d", current_user.username, user.username, h.id)
    return jsonify({'id': user.id, 'username': user.username}), 201


@bp.route('/members/<int:user_id>', methods=['DELETE'])
def remove_member(user_id):
    h = _current_household()
    if not h:
        return jsonify({'error': 'Not in a household'}), 400
    # Only creator can remove others; anyone can remove themselves
    if user_id != current_user.id and h.created_by != current_user.id:
        return jsonify({'error': 'Forbidden'}), 403

    member = HouseholdMember.query.filter_by(
        household_id=h.id, user_id=user_id
    ).first()
    if member:
        db.session.delete(member)
        db.session.flush()
        # If household is now empty, delete it
        remaining = HouseholdMember.query.filter_by(household_id=h.id).count()
        if remaining == 0:
            db.session.delete(h)
            log.info("HOUSEHOLD_DELETE: household_id=%d (empty after member removal)", h.id)
        db.session.commit()
        log.info("HOUSEHOLD_REMOVE_MEMBER: by=%s removed_user_id=%d household_id=%d",
                 current_user.username, user_id, h.id)
    return '', 204
