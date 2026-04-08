import logging
import click
from flask import Flask, render_template, redirect, url_for, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from flask_login import LoginManager, current_user
from config import Config

db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    logging.basicConfig(level=logging.INFO)

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'

    @login_manager.user_loader
    def load_user(user_id):
        from app.models.user import User
        return User.query.get(int(user_id))

    # ── Auth blueprint (login/logout — unprotected) ───────────────────────────
    from app.routes.auth import bp as auth_bp
    app.register_blueprint(auth_bp)

    # ── API blueprints ────────────────────────────────────────────────────────
    from app.routes.recipes   import bp as recipes_bp
    from app.routes.menu      import bp as menu_bp
    from app.routes.goals     import bp as goals_bp
    from app.routes.settings  import bp as settings_bp
    from app.routes.users     import bp as users_bp
    from app.routes.household import bp as household_bp
    from app.routes.weight    import bp as weight_bp

    app.register_blueprint(recipes_bp,   url_prefix="/api/recipes")
    app.register_blueprint(menu_bp,      url_prefix="/api/menu")
    app.register_blueprint(goals_bp,     url_prefix="/api/goals")
    app.register_blueprint(settings_bp,  url_prefix="/api/settings")
    app.register_blueprint(users_bp,     url_prefix="/api/users")
    app.register_blueprint(household_bp, url_prefix="/api/household")
    app.register_blueprint(weight_bp,    url_prefix="/api/weight")

    # ── Main SPA route ────────────────────────────────────────────────────────
    @app.route("/")
    def index():
        return render_template("index.html")

    # ── Global auth gate ──────────────────────────────────────────────────────
    OPEN_ENDPOINTS = {'auth.login', 'auth.logout',
                      'auth.forgot_password', 'auth.reset_password', 'static'}

    @app.before_request
    def require_auth():
        if request.endpoint in OPEN_ENDPOINTS:
            return
        if current_user.is_authenticated:
            return
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Authentication required'}), 401
        return redirect(url_for('auth.login', next=request.path))

    # ── Add a logout link to the nav (injected via template context) ──────────
    @app.context_processor
    def inject_user():
        return {'current_user': current_user}

    # ── CLI: flask create-user <username> ─────────────────────────────────────
    @app.cli.command('create-user')
    @click.argument('username')
    @click.option('--email', prompt=True, help='Email address for the account.')
    @click.password_option(help='Password for the new user.')
    def create_user(username, email, password):
        """Provision a new login account."""
        from app.models.user import User
        with app.app_context():
            if User.query.filter_by(username=username).first():
                click.echo(f'Error: user "{username}" already exists.', err=True)
                return
            if User.query.filter_by(email=email.strip().lower()).first():
                click.echo(f'Error: email "{email}" is already registered.', err=True)
                return
            user = User(username=username, email=email.strip().lower())
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            click.echo(f'User "{username}" ({email}) created.')

    with app.app_context():
        from app.models import shopping   # noqa: F401
        from app.models import user       # noqa: F401
        from app.models import household  # noqa: F401
        from app.models import weight     # noqa: F401

    return app
