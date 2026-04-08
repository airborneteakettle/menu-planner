from datetime import datetime
from app import db


class WeightEntry(db.Model):
    __tablename__ = 'weight_entry'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date       = db.Column(db.Date, nullable=False)
    weight     = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'date', name='uq_we_user_date'),
    )

    def to_dict(self):
        return {
            'id':     self.id,
            'date':   self.date.isoformat(),
            'weight': self.weight,
        }
