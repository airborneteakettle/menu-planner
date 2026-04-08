import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-prod")
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{os.path.join(BASE_DIR, 'data', 'menu_planner.db')}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Register for a free key at https://fdc.nal.usda.gov/api-guide.html
    # DEMO_KEY works but is rate-limited (30 req/hr, 50/day)
    USDA_API_KEY  = os.environ.get("USDA_API_KEY", "DEMO_KEY")
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
    MAIL_FROM      = os.environ.get("MAIL_FROM", "accounts@menu-planner.charaska.com")
