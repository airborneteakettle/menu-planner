from app import db
from datetime import date


class MenuEntryShare(db.Model):
    """An entry owned by one user that is also visible to another user."""
    __tablename__ = 'menu_entry_share'
    entry_id = db.Column(db.Integer, db.ForeignKey('menu_entry.id'), primary_key=True)
    user_id  = db.Column(db.Integer, db.ForeignKey('user.id'),       primary_key=True)


class MenuEntry(db.Model):
    """A single meal slot on a specific date."""
    id        = db.Column(db.Integer, primary_key=True)
    user_id   = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    date      = db.Column(db.Date, nullable=False, default=date.today)
    meal_type = db.Column(db.String(50), nullable=False)
    recipe_id = db.Column(db.Integer, db.ForeignKey("recipe.id"), nullable=False)
    servings  = db.Column(db.Float, default=1.0)

    shares = db.relationship('MenuEntryShare', backref='entry',
                             cascade='all, delete-orphan', lazy='joined')

    def shared_with_ids(self):
        return [s.user_id for s in self.shares]

    def to_dict(self, viewer_id=None):
        from app.models.user import User
        owner = User.query.get(self.user_id)
        shared_users = [
            User.query.get(s.user_id)
            for s in self.shares
        ]
        return {
            "id":           self.id,
            "date":         self.date.isoformat(),
            "meal_type":    self.meal_type,
            "recipe_id":    self.recipe_id,
            "recipe_name":  self.recipe.name if self.recipe else None,
            "servings":     self.servings,
            "owner_id":     self.user_id,
            "owner":        owner.username if owner else None,
            "is_mine":      self.user_id == viewer_id,
            "shared_with":  [u.username for u in shared_users if u],
            "nutrition":    self._nutrition(),
        }

    def _nutrition(self):
        r = self.recipe
        if not r:
            return None
        s = self.servings or 1
        def v(val):
            return round(val * s, 1) if val is not None else None
        return {
            "calories":  v(r.calories),
            "protein_g": v(r.protein_g),
            "carbs_g":   v(r.carbs_g),
            "fat_g":     v(r.fat_g),
            "fiber_g":   v(r.fiber_g),
        }
