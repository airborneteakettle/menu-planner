from app import db
from datetime import date

class MenuEntry(db.Model):
    """A single meal slot on a specific date."""
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, default=date.today)
    meal_type = db.Column(db.String(50), nullable=False)  # breakfast/lunch/dinner/snack
    recipe_id = db.Column(db.Integer, db.ForeignKey("recipe.id"), nullable=False)
    servings = db.Column(db.Float, default=1.0)

    def to_dict(self):
        return {
            "id": self.id,
            "date": self.date.isoformat(),
            "meal_type": self.meal_type,
            "recipe_id": self.recipe_id,
            "recipe_name": self.recipe.name if self.recipe else None,
            "servings": self.servings,
        }
