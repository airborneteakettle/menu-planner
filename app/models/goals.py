from app import db
from datetime import date

class DietGoal(db.Model):
    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    calories_target = db.Column(db.Float)
    protein_g_target = db.Column(db.Float)
    carbs_g_target = db.Column(db.Float)
    fat_g_target = db.Column(db.Float)
    fiber_g_target = db.Column(db.Float)  # optional
    goal_weight    = db.Column(db.Float)  # optional, unitless (user's chosen unit)
    created_at = db.Column(db.Date, default=date.today)
    notes = db.Column(db.Text)

    def to_dict(self):
        return {
            "id": self.id,
            "calories_target": self.calories_target,
            "protein_g_target": self.protein_g_target,
            "carbs_g_target": self.carbs_g_target,
            "fat_g_target": self.fat_g_target,
            "fiber_g_target": self.fiber_g_target,
            "goal_weight": self.goal_weight,
            "created_at": self.created_at.isoformat(),
            "notes": self.notes,
        }
