from app import db


class ShoppingCheckedItem(db.Model):
    __tablename__ = 'shopping_checked_item'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    week_start = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    item_key   = db.Column(db.String(300), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'week_start', 'item_key',
                            name='uq_shopping_checked'),
    )


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
