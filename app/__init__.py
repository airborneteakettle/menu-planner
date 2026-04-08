from flask import Flask, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from config import Config

db = SQLAlchemy()
migrate = Migrate()

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)

    from app.routes.recipes import bp as recipes_bp
    from app.routes.menu import bp as menu_bp
    from app.routes.goals import bp as goals_bp
    from app.routes.settings import bp as settings_bp

    app.register_blueprint(recipes_bp, url_prefix="/api/recipes")
    app.register_blueprint(menu_bp, url_prefix="/api/menu")
    app.register_blueprint(goals_bp, url_prefix="/api/goals")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")

    @app.route("/")
    def index():
        return render_template("index.html")

    with app.app_context():
        from app.models import shopping  # noqa: F401 – ensure table is registered
        db.create_all()

    return app
