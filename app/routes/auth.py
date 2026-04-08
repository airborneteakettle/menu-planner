from flask import (Blueprint, request, redirect, url_for,
                   render_template, flash, current_app)
from flask_login import login_user, logout_user, login_required
from app import db
from app.models.user import User
from app.services.mail import send_password_reset

bp = Blueprint('auth', __name__)


@bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        identifier = request.form.get('username', '').strip()
        password   = request.form.get('password', '')
        # Accept username or email
        user = (
            User.query.filter_by(username=identifier).first()
            or User.query.filter_by(email=identifier).first()
        )
        if user and user.check_password(password):
            login_user(user, remember=True)
            return redirect(request.args.get('next') or url_for('index'))
        return render_template('login.html', error='Invalid username or password.')
    return render_template('login.html')


@bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('auth.login'))


@bp.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        user  = User.query.filter_by(email=email).first()
        # Always show the same message to avoid user enumeration
        if user:
            token     = user.generate_reset_token()
            db.session.commit()
            reset_url = url_for('auth.reset_password', token=token, _external=True)
            try:
                send_password_reset(user.email, user.username, reset_url)
            except Exception as e:
                current_app.logger.error(f'Reset email failed: {e}')
        return render_template('forgot_password.html', sent=True)
    return render_template('forgot_password.html', sent=False)


@bp.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    user = User.query.filter_by(reset_token=token).first()
    if not user or not user.reset_token_valid:
        return render_template('reset_password.html', invalid=True)

    if request.method == 'POST':
        password = request.form.get('password', '')
        confirm  = request.form.get('confirm', '')
        if len(password) < 8:
            return render_template('reset_password.html',
                                   token=token, error='Password must be at least 8 characters.')
        if password != confirm:
            return render_template('reset_password.html',
                                   token=token, error='Passwords do not match.')
        user.set_password(password)
        user.clear_reset_token()
        db.session.commit()
        return render_template('reset_password.html', success=True)

    return render_template('reset_password.html', token=token)
