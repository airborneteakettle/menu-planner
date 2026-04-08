import logging
from flask import Blueprint, jsonify, request
from flask_login import current_user
from app import db
from app.models.weight import WeightEntry
from datetime import date as date_type

bp = Blueprint('weight', __name__)
log = logging.getLogger(__name__)


@bp.route('/', methods=['GET'])
def list_entries():
    entries = WeightEntry.query\
        .filter_by(user_id=current_user.id)\
        .order_by(WeightEntry.date)\
        .all()
    return jsonify([e.to_dict() for e in entries])


@bp.route('/', methods=['POST'])
def log_entry():
    data = request.get_json()
    try:
        d = date_type.fromisoformat(data['date'])
        w = float(data['weight'])
    except (KeyError, ValueError, TypeError):
        return jsonify({'error': 'date and weight are required'}), 400
    if w <= 0:
        return jsonify({'error': 'Weight must be positive'}), 400

    # Upsert: one entry per user per date
    entry = WeightEntry.query.filter_by(user_id=current_user.id, date=d).first()
    if entry:
        entry.weight = w
    else:
        entry = WeightEntry(user_id=current_user.id, date=d, weight=w)
        db.session.add(entry)
    db.session.commit()
    log.info("WEIGHT_LOG: user=%s date=%s weight=%s", current_user.username, d, w)
    return jsonify(entry.to_dict()), 201


@bp.route('/<int:entry_id>', methods=['DELETE'])
def delete_entry(entry_id):
    entry = WeightEntry.query.filter_by(
        id=entry_id, user_id=current_user.id
    ).first_or_404()
    log.info("WEIGHT_DELETE: user=%s entry_id=%d date=%s", current_user.username, entry_id, entry.date)
    db.session.delete(entry)
    db.session.commit()
    return '', 204
