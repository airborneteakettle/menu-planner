from app import db


class CustomShoppingItem(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    name       = db.Column(db.String(200), nullable=False)
    quantity   = db.Column(db.String(50))
    category   = db.Column(db.String(100), nullable=False, server_default='Miscellaneous')
    created_at = db.Column(db.DateTime, server_default=db.func.now())

    def to_dict(self):
        return {
            "id":       self.id,
            "name":     self.name,
            "quantity": self.quantity or "",
            "category": self.category or "Miscellaneous",
        }
