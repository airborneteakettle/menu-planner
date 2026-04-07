from app import db

class Recipe(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    servings = db.Column(db.Integer, default=1)

    # Nutrition per serving
    calories = db.Column(db.Float)
    protein_g = db.Column(db.Float)
    carbs_g = db.Column(db.Float)
    fat_g = db.Column(db.Float)

    # e.g. "breakfast", "lunch", "dinner", "snack"
    meal_type = db.Column(db.String(50))
    source_url = db.Column(db.String(2048))
    nutrition_source = db.Column(db.String(20))  # "page" or "usda_estimate"

    ingredients = db.relationship("Ingredient", backref="recipe", lazy=True, cascade="all, delete-orphan")
    menu_entries = db.relationship("MenuEntry", backref="recipe", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "servings": self.servings,
            "calories": self.calories,
            "protein_g": self.protein_g,
            "carbs_g": self.carbs_g,
            "fat_g": self.fat_g,
            "meal_type": self.meal_type,
            "source_url": self.source_url,
            "nutrition_source": self.nutrition_source,
            "ingredients": [i.to_dict() for i in self.ingredients],
        }


class Ingredient(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey("recipe.id"), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    quantity = db.Column(db.String(100))  # e.g. "2 cups", "100g"

    def to_dict(self):
        return {"id": self.id, "name": self.name, "quantity": self.quantity}
