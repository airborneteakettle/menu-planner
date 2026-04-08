import requests
from flask import current_app


def send_password_reset(to_email: str, to_username: str, reset_url: str):
    """Send a password reset email via Resend."""
    api_key  = current_app.config['RESEND_API_KEY']
    mail_from = current_app.config['MAIL_FROM']

    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1b5e20;margin-bottom:8px">Menu Planner</h2>
      <p>Hi {to_username},</p>
      <p>We received a request to reset your password. Click the button below —
         this link expires in <strong>1 hour</strong>.</p>
      <p style="margin:28px 0">
        <a href="{reset_url}"
           style="background:#1b5e20;color:#fff;padding:12px 24px;
                  border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
      </p>
      <p style="font-size:13px;color:#666">
        Or copy this link into your browser:<br>
        <a href="{reset_url}" style="color:#1b5e20;word-break:break-all">{reset_url}</a>
      </p>
      <p style="font-size:12px;color:#999;margin-top:32px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    """

    resp = requests.post(
        'https://api.resend.com/emails',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type':  'application/json',
        },
        json={
            'from':    mail_from,
            'to':      [to_email],
            'subject': 'Reset your Menu Planner password',
            'html':    html,
        },
        timeout=10,
    )
    resp.raise_for_status()
