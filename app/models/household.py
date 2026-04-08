from datetime import datetime
from app import db


class Household(db.Model):
    __tablename__ = 'household'
    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(100), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    members = db.relationship('HouseholdMember', backref='household',
                              cascade='all, delete-orphan', lazy='joined')

    def member_ids(self):
        return [m.user_id for m in self.members]

    def to_dict(self):
        from app.models.user import User
        members = []
        for m in self.members:
            u = User.query.get(m.user_id)
            if u:
                members.append({'id': u.id, 'username': u.username})
        return {
            'id':         self.id,
            'name':       self.name,
            'created_by': self.created_by,
            'members':    members,
        }


class HouseholdMember(db.Model):
    __tablename__ = 'household_member'
    household_id = db.Column(db.Integer, db.ForeignKey('household.id'), primary_key=True)
    user_id      = db.Column(db.Integer, db.ForeignKey('user.id'),      primary_key=True)
    joined_at    = db.Column(db.DateTime, default=datetime.utcnow)
