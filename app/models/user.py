import secrets
from datetime import datetime, timedelta
from app import db
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash


class User(db.Model):
    id                   = db.Column(db.Integer, primary_key=True)
    username             = db.Column(db.String(80),  unique=True, nullable=False)
    email                = db.Column(db.String(254), unique=True, nullable=True)
    password_hash        = db.Column(db.String(256), nullable=False)
    reset_token          = db.Column(db.String(64),  unique=True, nullable=True)
    reset_token_expires  = db.Column(db.DateTime,    nullable=True)

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def generate_reset_token(self) -> str:
        token = secrets.token_urlsafe(32)
        self.reset_token = token
        self.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
        return token

    def clear_reset_token(self):
        self.reset_token = None
        self.reset_token_expires = None

    @property
    def reset_token_valid(self) -> bool:
        return (
            self.reset_token is not None
            and self.reset_token_expires is not None
            and self.reset_token_expires > datetime.utcnow()
        )

    # Flask-Login interface
    @property
    def is_active(self):        return True
    @property
    def is_authenticated(self): return True
    @property
    def is_anonymous(self):     return False
    def get_id(self):           return str(self.id)
