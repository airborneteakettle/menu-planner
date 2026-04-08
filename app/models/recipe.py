from app import db

recipe_tags = db.Table(
    "recipe_tags",
    db.Column("recipe_id", db.Integer, db.ForeignKey("recipe.id"), primary_key=True),
    db.Column("tag_id",    db.Integer, db.ForeignKey("tag.id"),    primary_key=True),
)


class Tag(db.Model):
    id     = db.Column(db.Integer, primary_key=True)
    name   = db.Column(db.String(50), unique=True, nullable=False)
    hidden = db.Column(db.Boolean, nullable=False, default=False, server_default='0')


class RecipeRating(db.Model):
    __tablename__ = 'recipe_rating'
    user_id   = db.Column(db.Integer, db.ForeignKey('user.id'),   primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipe.id'), primary_key=True)
    rating    = db.Column(db.Integer, nullable=False)


class Recipe(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    servings    = db.Column(db.Integer, default=1)

    # Nutrition per serving
    calories  = db.Column(db.Float)
    protein_g = db.Column(db.Float)
    carbs_g   = db.Column(db.Float)
    fat_g     = db.Column(db.Float)

    fiber_g          = db.Column(db.Float)
    meal_type        = db.Column(db.String(50))
    source_url       = db.Column(db.String(2048))
    nutrition_source = db.Column(db.String(20))
    instructions     = db.Column(db.Text)

    tags        = db.relationship("Tag", secondary=recipe_tags, lazy="subquery",
                                  backref=db.backref("recipes", lazy=True))
    ingredients = db.relationship("Ingredient", backref="recipe", lazy=True,
                                  cascade="all, delete-orphan")
    menu_entries = db.relationship("MenuEntry", backref="recipe", lazy=True,
                                   cascade="all, delete-orphan")
    ratings     = db.relationship("RecipeRating", backref="recipe", lazy="dynamic",
                                  cascade="all, delete-orphan")

    @property
    def avg_rating(self):
        vals = [r.rating for r in self.ratings]
        return round(sum(vals) / len(vals), 1) if vals else None

    def to_dict(self, my_rating=None):
        return {
            "id":               self.id,
            "name":             self.name,
            "description":      self.description,
            "servings":         self.servings,
            "calories":         self.calories,
            "protein_g":        self.protein_g,
            "carbs_g":          self.carbs_g,
            "fat_g":            self.fat_g,
            "fiber_g":          self.fiber_g,
            "meal_type":        self.meal_type,
            "source_url":       self.source_url,
            "nutrition_source": self.nutrition_source,
            "instructions":     self.instructions,
            "rating":           self.avg_rating,
            "my_rating":        my_rating,
            "tags":             [t.name for t in self.tags],
            "ingredients":      [i.to_dict() for i in self.ingredients],
        }


class Ingredient(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    recipe_id = db.Column(db.Integer, db.ForeignKey("recipe.id"), nullable=False)
    name      = db.Column(db.String(200), nullable=False)
    quantity  = db.Column(db.String(100))

    def to_dict(self):
        return {"id": self.id, "name": self.name, "quantity": self.quantity}
